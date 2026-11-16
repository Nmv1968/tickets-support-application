import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Priority, TicketStatus } from '@prisma/client';
import { ASSIGNEES, ASSIGNEE_NAME_MAX, meansNobody } from '../assignees/assignees.service';
import type { AuthUser } from '../common/auth';
import { PRIORITIES, PRIORITY_LABEL, formatDateOnly, noteSearchKey, parseDateOnly, searchKey, ticketSearchKey, todayDateOnly } from '../common/labels';
import { tidyName } from '../common/named-catalog';
import { COMPANIES, COMPANY_NAME_MAX } from '../companies/companies.service';
import type { PrismaService } from '../prisma.service';
import { SUPPORT_TYPES, SUPPORT_TYPE_NAME_MAX, meansNoType } from '../support-types/support-types.service';
import { MAX_SUPPORT_TYPES, TEXT_MAX } from '../tickets/ticket-input';
import { activityStamp, slaDueAt } from '../tickets/ticket-update';
import { ModuleCatalog, NameCatalog, moduleKey } from './name-catalogs';
import type { CatalogEntry } from './name-catalogs';
import { HEADER_ROWS, MAX_IMPORT_ROWS, cellText, readTable, timeOfDateCell, toDateOnly, toStatus, toTimeOnly } from './sheet-reading';
import type { DateOrder, SheetFile } from './sheet-reading';

// The import of a sheet of cases: what each row says, checked against the catalogs, and the cases
// stored in one transaction. The file itself is read by sheet-reading.ts.

export type ColumnKey = 'date' | 'time' | 'company' | 'description' | 'status' | 'priority' | 'module' | 'assignee' | 'supportTypes' | 'note';

/** A case of the sheet as it will be stored. What comes from a catalog carries the name the catalog gives it. */
interface ParsedRow {
  date: string;
  /** Time of day of the case, `HH:mm`. Null when the sheet does not give one. */
  time: string | null;
  company: string;
  description: string;
  status: TicketStatus;
  priority: Priority | null;
  /** Full name of the module: "Ventas > Facturas". Null for a case without one. */
  module: string | null;
  /** Name of the responsible. Null for a case nobody is responsible for. */
  assignee: string | null;
  supportTypes: string[];
  note: string | null;
}

/** Values of the sheet that are in no catalog, by catalog. One entry per value, as it is first written. */
export interface ImportUnknown {
  companies: string[];
  assignees: string[];
  supportTypes: string[];
  modules: string[];
  priorities: string[];
  /** What the "Estado" column says that is none of the three statuses. */
  statuses: string[];
}

export interface ImportResult {
  dryRun: boolean;
  /** The import was asked to add the companies, responsibles and support types the catalogs lack. */
  createMissing: boolean;
  /** Spreadsheet header found for each field, or null when the column is missing. Several "tipo" columns go together, separated by commas. */
  columns: Record<ColumnKey, string | null>;
  totalRows: number;
  skippedEmpty: number;
  duplicates: number;
  /** Rows that will be (dry run) or were created. The rejected ones are not among them. */
  toCreate: number;
  /** Rows that are not imported because of a value of theirs: almost always, one that is in no catalog. */
  rejected: number;
  /** The first rejected rows: the number each has in the sheet, and why it was left out. */
  rejectedSample: { row: number; reasons: string[] }[];
  unknown: ImportUnknown;
  /**
   * What `createMissing` adds to the catalogs, or would add in a dry run: of the unknown values,
   * the ones that rows to import name. Empty without `createMissing`.
   */
  created: Pick<ImportUnknown, 'companies' | 'assignees' | 'supportTypes'>;
  /** The first rows to import. */
  sample: ParsedRow[];
}

/** What the person chose for an import: see `importSheet`. */
export interface ImportOptions {
  dryRun: boolean;
  dateOrder: DateOrder;
  createMissing: boolean;
}

const HEADER_PATTERNS: Record<ColumnKey, RegExp> = {
  date: /^fecha/,
  time: /^hora/,
  company: /^(empresa|cliente|compania)/,
  description: /^(descrip|detalle|problema|caso)/,
  status: /^estado/,
  priority: /^priorid/,
  module: /^modulo/,
  assignee: /^(respons|asignad|tecnico)/,
  // Every column that matches is read, not only the first: the template has a second one, "Otro tipo de soporte".
  supportTypes: /^(otros? )?tipo/,
  note: /^(observ|nota|comentario)/,
};

/** Rejected rows the answer of the import lists with their reasons. The count covers them all. */
const REJECTED_SAMPLE = 20;
/** Colour of a support type the import creates. A person gives it its own in Configuración. */
export const NEW_SUPPORT_TYPE_COLOR = '#64748b';

/**
 * Time limits of the transaction that stores an import. Prisma gives an interactive transaction 5 s
 * by default, and a large sheet can take longer than that, above all on a slow server: with the
 * default, such an import would fail at its end every time, having stored nothing. Measured on
 * PostgreSQL 17 on a development machine, the heaviest sheet there can be, `MAX_IMPORT_ROWS` rows
 * each with an observation, two support types and a priority, adding 500 companies, took under
 * 5 s from upload to answer, because the cases are written in a few statements for the whole sheet
 * (see `storeCases`); one `create` per case took 5 s for 2,000. The limit is some twenty times
 * that, for a slow disk or a busy server. Whoever adds by hand, meanwhile, a name that the import
 * has just added waits that long at most: the unique index of the catalog holds the name until the
 * import ends. `maxWait` is the wait for a free connection of the pool.
 */
export const IMPORT_TRANSACTION = { maxWait: 10_000, timeout: 120_000 } as const;

/** The priorities by the `searchKey` of their label, which is how a sheet writes them: "Crítica", "critica". */
const PRIORITY_BY_LABEL = new Map(PRIORITIES.map((priority) => [searchKey(PRIORITY_LABEL[priority]), priority]));

/** Why a row is rejected: it names something that is in no catalog. */
const notFound = (what: string, value: string): string => `${what} «${value}» no existe`;

/**
 * The support types a row names in its "tipo" cells, each once. A cell may hold several, separated
 * by commas or semicolons, which is how the export writes them. `isType` says whether a text is
 * the name of a type: a cell that is one is not split, so a name with a comma in it can be written.
 */
function typesWritten(cells: string[], isType: (text: string) => boolean): string[] {
  const written = new Map<string, string>();
  for (const cell of cells) {
    const names = isType(cell) ? [cell] : cell.split(/[,;]/);
    for (const name of names.map((text) => tidyName(text).slice(0, SUPPORT_TYPE_NAME_MAX))) {
      if (name && !written.has(searchKey(name))) written.set(searchKey(name), name);
    }
  }
  return [...written.values()];
}

/** How the cases of an import get the ids of what they name, and the deadline of their priority. */
interface CaseLinks {
  company: (name: string) => number;
  assignee: (name: string) => number;
  supportType: (name: string) => number;
  /** By the full name of the module: "Ventas > Facturas". */
  module: (fullName: string) => number | null;
  /** Hours the SLA gives a priority, or null when it gives none. */
  slaHours: (priority: Priority) => number | null;
}

/**
 * Stores the cases of an import in `tx`: three statements for the whole sheet, the cases, their
 * support types and their observations, where one `create` per case took several for each. A case
 * with support types or an observation cannot go in a `createMany` with them, so its rows in those
 * tables point at it by an id it gets beforehand: one taken from the sequence of the table, in a
 * single query, the same way the database numbers a case it is given without one. The ids go to
 * the cases in the order of the sheet, so their codes follow it, as they did case by case.
 */
async function storeCases(tx: Prisma.TransactionClient, rows: ParsedRow[], createdById: number, links: CaseLinks): Promise<void> {
  const reserved = await tx.$queryRaw<{ id: number }[]>`
    SELECT nextval(pg_get_serial_sequence('"Ticket"', 'id'))::int AS id FROM generate_series(1, ${rows.length}::int)`;
  const ids = reserved.map((row) => row.id).sort((a, b) => a - b);
  if (ids.length !== rows.length) throw new Error(`The import reserved ${ids.length} ids for ${rows.length} cases`);
  // As in a case registered by hand, the deadline of the priority runs from the registration: from now.
  const now = new Date();
  // Midday UTC keeps the calendar day of the case stable in any time zone.
  const reportedAt = (row: ParsedRow): Date => new Date(`${row.date}T12:00:00.000Z`);

  await tx.ticket.createMany({
    // The registration moment (`createdAt`) is left to the database: it is now, the time of the import.
    data: rows.map((row, index) => ({
      id: ids[index],
      date: parseDateOnly(row.date),
      time: row.time,
      companyId: links.company(row.company),
      description: row.description,
      searchText: ticketSearchKey(row.company, row.description),
      status: row.status,
      assigneeId: row.assignee ? links.assignee(row.assignee) : null,
      priority: row.priority,
      dueAt: slaDueAt(now, row.priority ? links.slaHours(row.priority) : null),
      moduleId: row.module ? links.module(row.module) : null,
      createdById,
      // Last activity is the day of the case, so old open cases show up as forgotten.
      ...activityStamp(reportedAt(row)),
    })),
  });
  const supportTypes = rows.flatMap((row, index) => row.supportTypes.map((type) => ({ ticketId: ids[index], supportTypeId: links.supportType(type) })));
  if (supportTypes.length) await tx.ticketSupportType.createMany({ data: supportTypes });
  // The sheet does not date its observations; the day of the case is the closest known date.
  const notes = rows.flatMap((row, index) =>
    row.note ? [{ ticketId: ids[index], text: row.note, searchText: noteSearchKey(row.note), createdAt: reportedAt(row) }] : [],
  );
  if (notes.length) await tx.ticketNote.createMany({ data: notes });
}

/**
 * Reads a sheet of cases and stores them. A row that names a company, a responsible, a support
 * type, a module, a priority or a status that does not exist is rejected: it is not imported,
 * and the answer says which row it is and why. `createMissing` adds to the catalogs the
 * companies, responsibles and support types they lack instead of rejecting those rows; a module,
 * a priority or a status is never created from a sheet. `dryRun` writes nothing: it reports what
 * would happen.
 */
export async function importSheet(prisma: PrismaService, file: SheetFile, options: ImportOptions, user: AuthUser): Promise<ImportResult> {
  const table = await readTable(file);

  const headerIndex = table.findIndex((row) => {
    const cells = row.cells.map((cell) => searchKey(cellText(cell)));
    return cells.some((c) => HEADER_PATTERNS.company.test(c)) && cells.some((c) => HEADER_PATTERNS.description.test(c));
  });
  if (headerIndex < 0 || headerIndex >= HEADER_ROWS) {
    throw new BadRequestException('No se encontró la fila de encabezados. Se necesitan al menos las columnas "Empresa" y "Descripción".');
  }

  const headers = table[headerIndex].cells.map((cell) => cellText(cell));
  /** Where each field is in a row. Only the support types are read from every column that matches. */
  const positions = {} as Record<ColumnKey, number[]>;
  const columns = {} as Record<ColumnKey, string | null>;
  for (const key of Object.keys(HEADER_PATTERNS) as ColumnKey[]) {
    const matching = headers.flatMap((header, index) => (HEADER_PATTERNS[key].test(searchKey(header)) ? [index] : []));
    positions[key] = key === 'supportTypes' ? matching : matching.slice(0, 1);
    columns[key] = positions[key].map((index) => headers[index]).join(', ') || null;
  }

  const named = { select: { id: true, name: true } } as const;
  const [existing, companyRows, personRows, typeRows, moduleRows] = await Promise.all([
    prisma.ticket.findMany({ select: { date: true, company: { select: { name: true } }, description: true } }),
    prisma.company.findMany(named),
    prisma.assignee.findMany(named),
    prisma.supportType.findMany(named),
    prisma.systemModule.findMany({
      select: { id: true, name: true, parent: { select: { name: true } } },
      // Of two modules with the same name, a sheet means the active one.
      orderBy: [{ active: 'desc' }, { id: 'asc' }],
    }),
  ]);
  const seen = new Set(existing.map((t) => `${formatDateOnly(t.date)}|${searchKey(t.company.name)}|${searchKey(t.description)}`));
  const companies = new NameCatalog(companyRows);
  const people = new NameCatalog(personRows);
  const types = new NameCatalog(typeRows);
  const modules = new ModuleCatalog(moduleRows);
  /** Modules, priorities and statuses of the sheet that do not exist, by key, as first written. */
  const unknownModules = new Map<string, string>();
  const unknownPriorities = new Map<string, string>();
  const unknownStatuses = new Map<string, string>();

  const rows: ParsedRow[] = [];
  const rejectedSample: ImportResult['rejectedSample'] = [];
  let rejected = 0;
  let skippedEmpty = 0;
  let duplicates = 0;
  let lastDate = formatDateOnly(todayDateOnly());
  const dataRows = table.slice(headerIndex + 1);
  // Refused in the preview too: it is where a person learns that the file has to be split.
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new BadRequestException(
      `El archivo tiene ${dataRows.length} filas debajo de los encabezados y se pueden importar hasta ${MAX_IMPORT_ROWS} a la vez. Divídelo en varios archivos.`,
    );
  }

  for (const { number, cells } of dataRows) {
    const at = (key: ColumnKey): unknown => (positions[key].length ? cells[positions[key][0]] : null);
    const company = tidyName(cellText(at('company'))).slice(0, COMPANY_NAME_MAX);
    const description = cellText(at('description'));
    if (!company || !description) {
      skippedEmpty++;
      continue;
    }
    // A blank date cell repeats the date of the row above, as people do in spreadsheets.
    lastDate = toDateOnly(at('date'), options.dateOrder) ?? lastDate;

    // Before anything else: a case that is already stored is left alone, whatever else its row says.
    const key = `${lastDate}|${searchKey(company)}|${searchKey(description)}`;
    if (seen.has(key)) {
      duplicates++;
      continue;
    }

    const reasons: string[] = [];
    /** The names of this row that their catalogs lack, to add if the row is imported. */
    const toAdd: [NameCatalog, string][] = [];
    /** The name the case gets for a name of the sheet. One the catalog lacks rejects the row, unless the import adds it. */
    const nameIn = (catalog: NameCatalog, written: string, what: string): string => {
      const { name, known } = catalog.read(written);
      if (!known && options.createMissing) toAdd.push([catalog, name]);
      else if (!known) reasons.push(notFound(what, written));
      return name;
    };

    const companyName = nameIn(companies, company, 'La empresa');
    const assignee = tidyName(cellText(at('assignee'))).slice(0, ASSIGNEE_NAME_MAX);
    // "Sin asignar" in the cell is the same as leaving it empty: it is not a person to look for, or to add.
    const assigneeName = assignee && !meansNobody(assignee) ? nameIn(people, assignee, 'El responsable') : null;
    const typeNames: string[] = [];
    const typesOfRow = typesWritten(
      positions.supportTypes.map((index) => cellText(cells[index])),
      (text) => types.has(text),
    );
    for (const type of typesOfRow) {
      // "Sin tipo" is how the reports name the cases without a type. It is no type to look for,
      // and it cannot become one: the catalog refuses that name, whoever asks for it.
      if (meansNoType(type) && !types.has(type)) reasons.push(`«${type}» no es un tipo de soporte: deja la celda vacía si el caso no tiene ninguno`);
      else typeNames.push(nameIn(types, type, 'El tipo de soporte'));
    }
    if (typesOfRow.length > MAX_SUPPORT_TYPES) reasons.push(`Un caso no puede tener más de ${MAX_SUPPORT_TYPES} tipos de soporte`);

    const moduleText = cellText(at('module'));
    const module = moduleText ? modules.find(moduleText) : null;
    if (moduleText && module === null) {
      if (!unknownModules.has(moduleKey(moduleText))) unknownModules.set(moduleKey(moduleText), moduleText);
      reasons.push(notFound('El módulo', moduleText));
    }
    if (Array.isArray(module)) {
      reasons.push(`Hay más de un módulo llamado «${moduleText}»: escribe su nombre completo, por ejemplo «${module[0]}»`);
    }

    const priorityText = cellText(at('priority'));
    const priority = PRIORITY_BY_LABEL.get(searchKey(priorityText)) ?? null;
    if (priorityText && !priority) {
      if (!unknownPriorities.has(searchKey(priorityText))) unknownPriorities.set(searchKey(priorityText), priorityText);
      reasons.push(notFound('La prioridad', priorityText));
    }

    const statusText = cellText(at('status'));
    const status = toStatus(statusText);
    if (status === null) {
      if (!unknownStatuses.has(searchKey(statusText))) unknownStatuses.set(searchKey(statusText), statusText);
      reasons.push(notFound('El estado', statusText));
    }

    // (A status that is not one is among the reasons already: it is named again for the compiler.)
    if (reasons.length || status === null) {
      rejected++;
      if (rejectedSample.length < REJECTED_SAMPLE) rejectedSample.push({ row: number, reasons });
      continue;
    }
    // Only now: a rejected row does not make a later one, with the same case, a duplicate of it.
    seen.add(key);
    for (const [catalog, name] of toAdd) catalog.want(name);

    rows.push({
      date: lastDate,
      // A column of its own, or the time written in the date cell. Unlike the date, it is not
      // taken from the row above.
      time: toTimeOnly(at('time')) ?? timeOfDateCell(at('date')),
      company: companyName,
      description: description.slice(0, TEXT_MAX),
      status,
      priority,
      module: module && !Array.isArray(module) ? module.fullName : null,
      assignee: assigneeName,
      supportTypes: typeNames,
      note: cellText(at('note')).slice(0, TEXT_MAX) || null,
    });
  }

  const result: ImportResult = {
    dryRun: options.dryRun,
    createMissing: options.createMissing,
    columns,
    totalRows: dataRows.length,
    skippedEmpty,
    duplicates,
    toCreate: rows.length,
    rejected,
    rejectedSample,
    unknown: {
      companies: companies.unknown,
      assignees: people.unknown,
      supportTypes: types.unknown,
      modules: [...unknownModules.values()],
      priorities: [...unknownPriorities.values()],
      statuses: [...unknownStatuses.values()],
    },
    created: { companies: companies.toCreate, assignees: people.toCreate, supportTypes: types.toCreate },
    sample: rows.slice(0, 5),
  };
  // A real import without a case to store has nothing to add either: only rows to import add names.
  if (options.dryRun || !rows.length) return result;

  // Read only for a sheet that gives priorities: they are what a deadline comes from.
  const policies = rows.some((row) => row.priority) ? await prisma.slaPolicy.findMany() : [];
  const slaHours = new Map(policies.map((policy) => [policy.priority, policy.hours]));

  // All or nothing: what the catalogs lacked and every case of the sheet go in one transaction.
  // Stored one by one, a failure halfway (a lost connection, the server stopping) left part of the
  // sheet in, with the companies it had added, and importing the file again skipped that part as
  // duplicates: nobody could tell which rows had gone in.
  const lacking = result.created;
  try {
    result.created = await prisma.$transaction(async (tx) => {
      // What the catalogs lacked joins them first, so the cases can point at it: one catalog after
      // the other, always in this order (see `addMissing`). The answer says what was really added.
      // The names added here are seen by nobody until the cases are stored too.
      const created = {
        companies: await addMissing(companies, lacking.companies, {
          stored: () => tx.company.findMany(named),
          add: (names) => tx.company.createManyAndReturn({ data: names.map((name) => COMPANIES.newEntry(name)), skipDuplicates: true, ...named }),
        }),
        // A name is all a responsible has: nobody becomes a user of the app by being named in a sheet.
        assignees: await addMissing(people, lacking.assignees, {
          stored: () => tx.assignee.findMany(named),
          add: (names) => tx.assignee.createManyAndReturn({ data: names.map((name) => ASSIGNEES.newEntry(name)), skipDuplicates: true, ...named }),
        }),
        supportTypes: await addMissing(types, lacking.supportTypes, {
          stored: () => tx.supportType.findMany(named),
          add: (names) =>
            tx.supportType.createManyAndReturn({
              data: names.map((name) => SUPPORT_TYPES.newEntry(name, { color: NEW_SUPPORT_TYPE_COLOR })),
              skipDuplicates: true,
              ...named,
            }),
        }),
      };
      await storeCases(tx, rows, user.id, {
        company: (name) => companies.id(name),
        assignee: (name) => people.id(name),
        supportType: (name) => types.id(name),
        module: (fullName) => modules.id(fullName),
        slaHours: (priority) => slaHours.get(priority) ?? null,
      });
      return created;
    }, IMPORT_TRANSACTION);
  } catch (error) {
    // Out of time, or no connection in time. Prisma has undone the transaction: nothing is in.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2028') {
      throw new ServiceUnavailableException(
        'La importación tardó más de lo permitido y no se guardó nada: ningún caso ni ningún registro nuevo de los catálogos. ' +
          'Intenta de nuevo; si vuelve a pasar, divide el archivo en partes más pequeñas.',
      );
    }
    throw error;
  }
  return result;
}

/**
 * Adds to a catalog the names of the sheet that it lacked, and gives `catalog` the id of each.
 * The catalogs were read before the sheet was, and someone may have registered one of the names
 * since, or be registering it right now: the unique index of the catalog lets only one of the two
 * in. `add` skips a name whose key another entry has (`skipDuplicates`), after waiting for the
 * transaction that has just written it, if it has not ended yet. That entry is then read and used
 * as it is, as a person who finds the name registered would. Returns the names that were added,
 * in the order of the sheet.
 *
 * The names go in the order of their keys. Writing a key waits for whoever wrote it first and has
 * not ended: two imports that wanted two of the same names, each in the opposite order, would wait
 * for each other for ever (PostgreSQL would end one of them with an error). In one order, the one
 * that waits holds no name the other one has still to write. The catalogs go in one order too: see
 * `importSheet`.
 */
async function addMissing(
  catalog: NameCatalog,
  names: string[],
  table: {
    stored: () => Promise<CatalogEntry[]>;
    /** One statement for them all, which skips a name whose key another entry has. */
    add: (names: string[]) => Promise<CatalogEntry[]>;
  },
): Promise<string[]> {
  if (!names.length) return [];
  const inKeyOrder = names
    .map((name) => ({ name, key: searchKey(name) }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((each) => each.name);
  const added = await table.add(inKeyOrder);
  const isAdded = new Set(added.map((entry) => searchKey(entry.name)));
  // The names that someone else registered: read now that they are in.
  const others = added.length < names.length ? await table.stored() : [];
  for (const entry of [...others, ...added]) catalog.add(entry.name, entry.id);
  return names.filter((name) => isAdded.has(searchKey(name)));
}
