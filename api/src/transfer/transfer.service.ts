import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import type { AuthUser } from '../common/auth';
import {
  PRIORITY_LABEL,
  STATUS_LABEL,
  formatDateEs,
  formatDateOnly,
  formatMomentEs,
  moduleFullName,
  noteSearchKey,
  parseDateOnly,
  searchKey,
  ticketCode,
  ticketSearchKey,
  todayDateOnly,
} from '../common/labels';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import { TicketsService, activityStamp, ticketOrder } from '../tickets/tickets.service';
import type { PromiseFilter, TicketFilters } from '../tickets/tickets.service';

type DateOrder = 'mdy' | 'dmy';
type ColumnKey = 'date' | 'time' | 'company' | 'description' | 'status' | 'assignee' | 'note';

interface ParsedRow {
  date: string;
  /** Time of day of the case, `HH:mm`. Null when the sheet does not give one. */
  time: string | null;
  company: string;
  description: string;
  status: TicketStatus;
  /** Person name, "Cliente" marker or null. */
  assignee: string | null;
  toClient: boolean;
  note: string | null;
}

export interface ImportResult {
  dryRun: boolean;
  /** Spreadsheet header found for each field, or null when the column is missing. */
  columns: Record<ColumnKey, string | null>;
  totalRows: number;
  skippedEmpty: number;
  duplicates: number;
  /** Rows that will be (dry run) or were created. */
  toCreate: number;
  /** Responsibles that do not exist yet. They are created as people without login. */
  newPeople: string[];
  sample: ParsedRow[];
}

const HEADER_PATTERNS: Record<ColumnKey, RegExp> = {
  date: /^fecha/,
  time: /^hora/,
  company: /^(empresa|cliente|compania)/,
  description: /^(descrip|detalle|problema|caso)/,
  status: /^estado/,
  assignee: /^(respons|asignad|tecnico)/,
  note: /^(observ|nota|comentario)/,
};

/** Rows of the template that carry the cell checks. Rows below them import the same, without the checks. */
export const TEMPLATE_ROWS = 2_000;

/**
 * The columns of the import template, in order. Each header is one the import recognises
 * (`HEADER_PATTERNS`). `help` is what the person reads about the column: as a note on its
 * header cell and in the "Instrucciones" sheet.
 */
export const TEMPLATE_COLUMNS: { key: ColumnKey; header: string; width: number; required: boolean; help: string }[] = [
  {
    key: 'date',
    header: 'Fecha',
    width: 14,
    required: false,
    help: 'Día en que el cliente reportó el caso. Escríbela como fecha, por ejemplo 15/03/2026. Vacía: toma la fecha de la fila de arriba; en la primera fila, la de hoy.',
  },
  { key: 'time', header: 'Hora', width: 9, required: false, help: 'Hora en que el cliente reportó el caso, por ejemplo 14:35. Vacía: el caso queda solo con la fecha.' },
  { key: 'company', header: 'Empresa', width: 30, required: true, help: 'Nombre de la empresa o del cliente. Máximo 200 caracteres.' },
  { key: 'description', header: 'Descripción', width: 60, required: true, help: 'Qué pasó o qué se pidió. Máximo 5000 caracteres.' },
  { key: 'status', header: 'Estado', width: 16, required: false, help: 'Pendiente, Resuelto o Sin resolver. Vacío: Pendiente.' },
  {
    key: 'assignee',
    header: 'Responsable',
    width: 24,
    required: false,
    help: 'Persona a cargo: elígela de la lista o escribe su nombre. "Cliente" si depende del cliente. Vacío: sin asignar. Un nombre que no existe se agrega a la lista de responsables.',
  },
  { key: 'note', header: 'Observación', width: 60, required: false, help: 'Nota o solución del caso. Máximo 5000 caracteres.' },
];

const TEMPLATE_RULES = [
  'No cambies los nombres de las columnas y deja "Casos" como primera hoja: es la que lee el sistema.',
  'Una fila sin Empresa o sin Descripción no se importa.',
  'Un caso con la misma fecha, empresa y descripción que uno ya registrado se omite, así que importar dos veces el mismo archivo no duplica casos.',
  'La "Fecha" de la plantilla es la fecha del caso. La fecha de registro de cada caso es el momento de la importación.',
  `Las listas y los avisos de las celdas llegan hasta la fila ${TEMPLATE_ROWS + 1}. Puedes seguir más abajo: esas filas se importan igual, sin avisos.`,
];

/** Header row of the spreadsheets this service writes: white bold text on the brand blue. */
function paintHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { horizontal: 'center', vertical: 'middle' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  });
}

/**
 * Puts one cell rule on a whole range of a sheet. ExcelJS types only the rule of a single cell,
 * and a column filled cell by cell is written as ranges that overlap (it sorts "A10" before "A2"),
 * which Excel does not accept. A rule stored under the range goes to the file as that one range.
 */
function addRangeRule(sheet: ExcelJS.Worksheet, range: string, rule: ExcelJS.DataValidation): void {
  (sheet as unknown as { dataValidations: { add(address: string, rule: ExcelJS.DataValidation): void } }).dataValidations.add(range, rule);
}

/**
 * The import template. It has the columns `import` reads and cell rules against the usual format
 * mistakes: a date typed as text, a status worded another way, a person's name spelled differently.
 * "Casos" is the first sheet because `import` reads that one. `people` are the names offered as
 * responsible.
 */
export function buildTemplate(people: string[]): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();

  const sheet = workbook.addWorksheet('Casos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
    // A date cell keeps what is typed as a real date, so day and month cannot be swapped on import.
    style: column.key === 'date' ? { numFmt: 'dd/mm/yyyy' } : column.key === 'time' ? { numFmt: 'hh:mm' } : { alignment: { vertical: 'top', wrapText: true } },
  }));
  const header = sheet.getRow(1);
  paintHeader(header);
  for (const column of TEMPLATE_COLUMNS) {
    header.getCell(column.key).note = `${column.required ? 'Obligatoria' : 'Opcional'}. ${column.help}`;
  }

  // The names go in their own sheet: a list written inside the rule is limited to 255 characters.
  const lists = workbook.addWorksheet('Listas', { state: 'hidden' });
  const names = ['Cliente', ...people];
  names.forEach((name, index) => (lists.getCell(index + 1, 1).value = name));

  const statuses = [STATUS_LABEL.PENDING, STATUS_LABEL.RESOLVED, STATUS_LABEL.UNRESOLVED];
  const rows = (key: ColumnKey): string => {
    const letter = sheet.getColumn(key).letter;
    return `${letter}2:${letter}${TEMPLATE_ROWS + 1}`;
  };
  addRangeRule(sheet, rows('date'), {
    type: 'date',
    operator: 'between',
    formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2099, 11, 31))],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Fecha no válida',
    error: 'Escribe una fecha, por ejemplo 15/03/2026.',
  });
  // Excel keeps a time as the part of a day that has gone by: 0 is midnight and 0.5 is noon.
  addRangeRule(sheet, rows('time'), {
    type: 'decimal',
    operator: 'between',
    formulae: [0, 0.99999],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Hora no válida',
    error: 'Escribe una hora, por ejemplo 14:35.',
  });
  addRangeRule(sheet, rows('status'), {
    type: 'list',
    formulae: [`"${statuses.join(',')}"`],
    allowBlank: true,
    showErrorMessage: true,
    errorTitle: 'Estado no válido',
    error: `Elige ${statuses.join(', ')}. Vacío se toma como ${STATUS_LABEL.PENDING}.`,
  });
  // Only a list to pick from: another name is allowed and creates that person.
  addRangeRule(sheet, rows('assignee'), {
    type: 'list',
    formulae: [`Listas!$A$1:$A$${names.length}`],
    allowBlank: true,
    showErrorMessage: false,
  });

  const guide = workbook.addWorksheet('Instrucciones');
  guide.columns = [{ width: 16 }, { width: 13 }, { width: 110 }];
  const line = (text: string): ExcelJS.Row => {
    const row = guide.addRow([text]);
    guide.mergeCells(row.number, 1, row.number, 3);
    row.alignment = { vertical: 'top', wrapText: true };
    return row;
  };
  line('Plantilla para importar casos de soporte').font = { bold: true, size: 14 };
  line('Llena la hoja "Casos", una fila por caso, y súbela en Casos > Importar. Antes de guardar nada verás una vista previa.');
  guide.addRow([]);
  paintHeader(guide.addRow(['Columna', 'Obligatoria', 'Qué va en ella']));
  for (const column of TEMPLATE_COLUMNS) {
    guide.addRow([column.header, column.required ? 'Sí' : 'No', column.help]).alignment = { vertical: 'top', wrapText: true };
  }
  guide.addRow([]);
  TEMPLATE_RULES.forEach(line);

  return workbook;
}


// An export with more cases than its limit is refused with a message. It is never cut short:
// a file with part of the selection and nothing that says so reads as the whole of it.

/** The spreadsheet is built in memory, with every case and its observations loaded at once. */
export const XLSX_EXPORT_LIMIT = 20_000;
/**
 * pdfmake lays the whole document out in memory inside the only API process, and nothing else is
 * answered meanwhile. Measured with texts of ordinary length: under three seconds at this size,
 * over ten seconds and about 1 GB of memory at 20,000.
 */
export const PDF_EXPORT_LIMIT = 5_000;

const exportInclude = {
  assignee: { select: { name: true } },
  module: { select: { name: true, parent: { select: { name: true } } } },
  notes: { orderBy: { createdAt: 'asc' }, select: { text: true, createdAt: true } },
} satisfies Prisma.TicketInclude;

type ExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

/** Flattens the shapes ExcelJS uses for a cell value. */
function cellValue(value: unknown): string | number | Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value === 'number') return value;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'object') {
    const cell = value as { richText?: { text: string }[]; text?: unknown; result?: unknown; error?: unknown };
    if (cell.richText) return cell.richText.map((part) => part.text).join('').trim();
    if (cell.result !== undefined) return cellValue(cell.result);
    if (cell.text !== undefined) return cellValue(cell.text);
  }
  return null;
}

function cellText(value: unknown): string {
  const flat = cellValue(value);
  if (flat === null) return '';
  return flat instanceof Date ? formatDateOnly(flat) : String(flat).trim();
}

export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.slice(0, clean.indexOf('\n') >>> 0);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    if (quoted) {
      if (char === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function toDateOnly(value: unknown, order: DateOrder): string | null {
  const flat = cellValue(value);
  if (flat === null || flat === '') return null;
  if (flat instanceof Date) return Number.isNaN(flat.getTime()) ? null : formatDateOnly(flat);
  if (typeof flat === 'number') {
    // Excel serial date: days since 1899-12-30.
    return flat > 20_000 && flat < 80_000 ? formatDateOnly(new Date(Date.UTC(1899, 11, 30) + flat * 86_400_000)) : null;
  }

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(flat);
  const parts = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(flat);
  let year: number;
  let month: number;
  let day: number;
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (parts) {
    const [a, b] = [Number(parts[1]), Number(parts[2])];
    year = Number(parts[3]) < 100 ? 2000 + Number(parts[3]) : Number(parts[3]);
    // A number above 12 can only be the day; otherwise the chosen order decides.
    const monthFirst = a > 12 ? false : b > 12 ? true : order === 'mdy';
    [month, day] = monthFirst ? [a, b] : [b, a];
  } else return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  const valid = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return valid ? formatDateOnly(date) : null;
}

/** Minutes since midnight as `HH:mm`. Null when they are not a time of day. */
function clock(minutes: number): string | null {
  if (!Number.isFinite(minutes) || minutes < 0 || minutes >= 1440) return null;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/**
 * The time of day in a cell, as `HH:mm`. A spreadsheet gives it in three ways: a time cell (a
 * date on Excel's day zero, read in UTC), the fraction of a day that has gone by, or text such
 * as "14:35", "2:35 p. m." or "14h35". Null for an empty cell and for anything that is not a time.
 */
export function toTimeOnly(value: unknown): string | null {
  const flat = cellValue(value);
  if (flat === null || flat === '') return null;
  if (flat instanceof Date) {
    if (Number.isNaN(flat.getTime())) return null;
    // Rounded to the minute: 14:35 can arrive as 14:34:59.999.
    const seconds = flat.getUTCHours() * 3600 + flat.getUTCMinutes() * 60 + flat.getUTCSeconds() + flat.getUTCMilliseconds() / 1000;
    return clock(Math.round(seconds / 60) % 1440);
  }
  if (typeof flat === 'number') return flat >= 0 ? clock(Math.round((flat % 1) * 1440) % 1440) : null;

  const match = /^(\d{1,2})\s*[:h.]\s*(\d{2})(?::\d{2})?\s*(?:([ap])\.?\s*m\.?)?$/i.exec(flat);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const half = match[3]?.toLowerCase();
  if (minutes > 59 || (half ? hours < 1 || hours > 12 : hours > 23)) return null;
  if (half === 'p' && hours < 12) hours += 12;
  if (half === 'a' && hours === 12) hours = 0;
  return clock(hours * 60 + minutes);
}

/** The time a date cell carries besides its day ("27/07/2023 14:35"). Null at midnight: a plain date. */
function timeOfDateCell(value: unknown): string | null {
  const flat = cellValue(value);
  if (!(flat instanceof Date) || Number.isNaN(flat.getTime())) return null;
  const time = toTimeOnly(flat);
  return time === '00:00' ? null : time;
}

export function toStatus(value: string): TicketStatus {
  const text = searchKey(value);
  if (text.startsWith('resuel')) return 'RESOLVED';
  if (text.startsWith('sin res')) return 'UNRESOLVED';
  return 'PENDING';
}

/** Names the description of the filters needs and the filters only carry as ids. Null when the id points to nothing. */
export interface FilterNames {
  assignee: string | null;
  /** With its parent, as the list shows it: "Ventas > Facturas". */
  module: string | null;
}

/** The fields of `TicketFilters` that choose which cases are listed. The others only order and page them. */
type FilterKey = Exclude<keyof TicketFilters, 'sort' | 'dir' | 'page' | 'pageSize'>;

const PROMISE_TEXT: Record<PromiseFilter, string> = {
  any: 'con promesa de entrega',
  overdue: 'promesa de entrega vencida',
  today: 'promesa de entrega para hoy',
  soon: 'promesa de entrega próxima',
  due: 'promesa de entrega vencida, para hoy o próxima',
};

/**
 * How the PDF header words each filter, in the order it prints them. The type asks for one entry per
 * filter of `TicketFilters`: a filter added to the list does not compile until it is worded here,
 * so a filtered PDF cannot be headed "Sin filtros".
 */
const FILTER_TEXT: { [K in FilterKey]: (value: NonNullable<TicketFilters[K]>, names: FilterNames) => string } = {
  status: (statuses) => `Estado: ${statuses.map((status) => STATUS_LABEL[status]).join(', ')}`,
  assignee: (assignee, names) => {
    if (assignee === 'client') return 'Responsable: Cliente';
    if (assignee === 'none') return 'Responsable: sin asignar';
    return `Responsable: ${names.assignee ?? `id ${assignee} (no existe)`}`;
  },
  company: (company) => `Empresa: ${company}`,
  priority: (priority) => `Prioridad: ${PRIORITY_LABEL[priority]}`,
  moduleId: (id, names) => `Módulo: ${names.module ?? `id ${id} (no existe)`}`,
  from: (day) => `Desde: ${formatDateEs(parseDateOnly(day))}`,
  to: (day) => `Hasta: ${formatDateEs(parseDateOnly(day))}`,
  overdue: () => 'Solo vencidos',
  stale: () => 'Solo olvidados',
  promise: (promise) => `Solo ${PROMISE_TEXT[promise]}`,
  q: (text) => `Búsqueda: "${text}"`,
};

/** As in `buildWhere`, a field that is switched off or empty does not filter, the same as an absent one. */
function filtersNothing(value: unknown): boolean {
  return value === false || value === '' || (Array.isArray(value) && !value.length);
}

/**
 * The "Filtros" line of the PDF, worded from the same filters its query runs with.
 * Empty when nothing filters.
 */
export function describeFilters(filters: TicketFilters, names: FilterNames): string {
  const text = <K extends FilterKey>(key: K): string | null => {
    const value = filters[key];
    return value == null || filtersNothing(value) ? null : FILTER_TEXT[key](value, names);
  };
  return (Object.keys(FILTER_TEXT) as FilterKey[])
    .map(text)
    .filter((part) => part !== null)
    .join('  ·  ');
}

/** The PDF uses the built-in Helvetica font, which only covers Latin-1. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\u0009\u000A -~ -ÿ]/g, '?');
}

/**
 * Excel cells have no time zone and ExcelJS writes the UTC reading of a Date.
 * Shifting by the server's offset makes the cell show local time.
 */
export function excelMoment(value: Date | null): Date | null {
  return value ? new Date(value.getTime() - value.getTimezoneOffset() * 60_000) : null;
}

/** The "Observación" cell: one observation goes alone, several go one per line with the day each was written. */
export function notesText(notes: ExportRow['notes']): string {
  if (notes.length <= 1) return notes[0]?.text ?? '';
  // `createdAt` is a moment, not a calendar date: its day is the one on the server's clock, not the UTC one.
  return notes.map((note) => `${formatMomentEs(note.createdAt)}: ${note.text}`).join('\n');
}

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly settings: SettingsService,
  ) {}

  async import(
    file: { buffer: Buffer; originalname: string },
    options: { dryRun: boolean; dateOrder: DateOrder },
    user: AuthUser,
  ): Promise<ImportResult> {
    const table = await this.readTable(file);

    const headerIndex = table.findIndex((row) => {
      const cells = row.map((cell) => searchKey(cellText(cell)));
      return cells.some((c) => HEADER_PATTERNS.company.test(c)) && cells.some((c) => HEADER_PATTERNS.description.test(c));
    });
    if (headerIndex < 0 || headerIndex > 20) {
      throw new BadRequestException('No se encontró la fila de encabezados. Se necesitan al menos las columnas "Empresa" y "Descripción".');
    }

    const headers = table[headerIndex].map((cell) => cellText(cell));
    const columnIndex = {} as Record<ColumnKey, number>;
    const columns = {} as Record<ColumnKey, string | null>;
    for (const key of Object.keys(HEADER_PATTERNS) as ColumnKey[]) {
      columnIndex[key] = headers.findIndex((header) => HEADER_PATTERNS[key].test(searchKey(header)));
      columns[key] = columnIndex[key] >= 0 ? headers[columnIndex[key]] : null;
    }

    const existing = await this.prisma.ticket.findMany({ select: { date: true, company: true, description: true } });
    const seen = new Set(existing.map((t) => `${formatDateOnly(t.date)}|${searchKey(t.company)}|${searchKey(t.description)}`));

    const rows: ParsedRow[] = [];
    let skippedEmpty = 0;
    let duplicates = 0;
    let lastDate = formatDateOnly(todayDateOnly());
    const dataRows = table.slice(headerIndex + 1);

    for (const raw of dataRows) {
      const at = (key: ColumnKey): unknown => (columnIndex[key] >= 0 ? raw[columnIndex[key]] : null);
      const company = cellText(at('company'));
      const description = cellText(at('description'));
      if (!company || !description) {
        skippedEmpty++;
        continue;
      }
      // A blank date cell repeats the date of the row above, as people do in spreadsheets.
      lastDate = toDateOnly(at('date'), options.dateOrder) ?? lastDate;

      const key = `${lastDate}|${searchKey(company)}|${searchKey(description)}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);

      const assignee = cellText(at('assignee'));
      const toClient = searchKey(assignee) === 'cliente';
      rows.push({
        date: lastDate,
        // A column of its own, or the time written in the date cell. Unlike the date, it is not
        // taken from the row above.
        time: toTimeOnly(at('time')) ?? timeOfDateCell(at('date')),
        company: company.slice(0, 200),
        description: description.slice(0, 5000),
        status: toStatus(cellText(at('status'))),
        assignee: assignee ? assignee.slice(0, 80) : null,
        toClient,
        note: cellText(at('note')).slice(0, 5000) || null,
      });
    }

    // Active or not: a sheet that names a deactivated responsible means that person, not a new one.
    const people = await this.prisma.assignee.findMany({ select: { id: true, name: true } });
    const personByName = new Map(people.map((person) => [searchKey(person.name), person.id]));
    // One entry per person, however the sheet spells the name from row to row. The first spelling
    // is the one kept: it is the name the new responsible gets.
    const unknown = new Map<string, string>();
    for (const row of rows) {
      if (!row.assignee || row.toClient) continue;
      const key = searchKey(row.assignee);
      if (!personByName.has(key) && !unknown.has(key)) unknown.set(key, row.assignee);
    }
    const newPeople = [...unknown.values()];

    const result: ImportResult = {
      dryRun: options.dryRun,
      columns,
      totalRows: dataRows.length,
      skippedEmpty,
      duplicates,
      toCreate: rows.length,
      newPeople,
      sample: rows.slice(0, 5),
    };
    if (options.dryRun) return result;

    // The names in the sheet that nobody has yet join the catalog of responsibles.
    for (const name of newPeople) {
      const created = await this.prisma.assignee.create({ data: { name } });
      personByName.set(searchKey(name), created.id);
    }

    for (const row of rows) {
      // The registration moment (`createdAt`) is left to the database: it is now, the time of the import.
      // Midday UTC keeps the calendar day of the case stable in any time zone.
      const reportedAt = new Date(`${row.date}T12:00:00.000Z`);
      await this.prisma.ticket.create({
        data: {
          date: parseDateOnly(row.date),
          time: row.time,
          company: row.company,
          description: row.description,
          searchText: ticketSearchKey(row.company, row.description),
          status: row.status,
          assigneeId: row.assignee && !row.toClient ? (personByName.get(searchKey(row.assignee)) ?? null) : null,
          assignedToClient: row.toClient,
          createdById: user.id,
          // Last activity is the day of the case, so old open cases show up as forgotten.
          ...activityStamp(reportedAt),
          // The sheet does not date its observations; the day of the case is the closest known date.
          notes: row.note ? { create: { text: row.note, searchText: noteSearchKey(row.note), createdAt: reportedAt } } : undefined,
        },
      });
    }
    return result;
  }

  /** The spreadsheet people fill in to import cases, with the active responsibles to choose from. */
  async template(): Promise<Buffer> {
    const people = await this.prisma.assignee.findMany({ where: { active: true }, orderBy: { name: 'asc' }, select: { name: true } });
    return Buffer.from(await buildTemplate(people.map((person) => person.name)).xlsx.writeBuffer());
  }

  async xlsx(filters: TicketFilters): Promise<Buffer> {
    const where = this.tickets.buildWhere(filters, await this.settings.reminderRules());
    // Counted first, as for the PDF: a refused export costs one query and loads no rows.
    const total = await this.prisma.ticket.count({ where });
    if (total > XLSX_EXPORT_LIMIT) {
      throw new BadRequestException(
        `La exportación a Excel admite hasta ${XLSX_EXPORT_LIMIT} casos y la selección actual tiene ${total}. ` +
          'Acota los filtros (por ejemplo, por fechas, estado o responsable) y exporta por partes.',
      );
    }
    const rows = await this.exportRows(where, filters);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Casos de Soporte', { views: [{ state: 'frozen', ySplit: 1 }] });

    sheet.columns = [
      { header: 'Código', key: 'code', width: 12 },
      { header: 'Fecha del caso', key: 'date', width: 15, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Hora del caso', key: 'time', width: 10 },
      { header: 'Fecha de registro', key: 'registered', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Empresa', key: 'company', width: 28 },
      { header: 'Descripción', key: 'description', width: 60 },
      { header: 'Estado', key: 'status', width: 14 },
      { header: 'Responsable', key: 'assignee', width: 18 },
      { header: 'Observación', key: 'notes', width: 60 },
      { header: 'Prioridad', key: 'priority', width: 11 },
      { header: 'Módulo', key: 'module', width: 26 },
      { header: 'Estimado (min)', key: 'estimated', width: 15 },
      { header: 'Real (min)', key: 'spent', width: 11 },
      { header: 'Promesa de entrega', key: 'promised', width: 18, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Fecha límite SLA', key: 'due', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Resuelto el', key: 'resolved', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
    ];

    paintHeader(sheet.getRow(1));

    const statusFill: Record<TicketStatus, string> = { RESOLVED: 'FFA9D08E', PENDING: 'FFFFD966', UNRESOLVED: 'FFF4B183' };
    for (const t of rows) {
      const row = sheet.addRow({
        code: ticketCode(t.id),
        date: t.date,
        time: t.time ?? '',
        registered: excelMoment(t.createdAt),
        company: t.company,
        description: t.description,
        status: STATUS_LABEL[t.status],
        assignee: t.assignedToClient ? 'Cliente' : (t.assignee?.name ?? ''),
        notes: notesText(t.notes),
        priority: t.priority ? PRIORITY_LABEL[t.priority] : '',
        module: t.module ? moduleFullName(t.module) : '',
        estimated: t.estimatedMinutes,
        spent: t.spentMinutes || null,
        promised: t.promisedDate,
        due: excelMoment(t.dueAt),
        resolved: excelMoment(t.resolvedAt),
      });
      row.alignment = { vertical: 'top', wrapText: true };
      row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill[t.status] } };
    }
    sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async pdf(filters: TicketFilters): Promise<Buffer> {
    const where = this.tickets.buildWhere(filters, await this.settings.reminderRules());
    // Counted first: a PDF that is going to be refused costs one query and loads no rows.
    const total = await this.prisma.ticket.count({ where });
    if (total > PDF_EXPORT_LIMIT) {
      throw new BadRequestException(
        `La exportación a PDF admite hasta ${PDF_EXPORT_LIMIT} casos y la selección actual tiene ${total}. ` +
          // Excel is offered only while this selection fits in it.
          `Acota los filtros (por ejemplo, por fechas, estado o responsable)${total > XLSX_EXPORT_LIMIT ? '.' : ' o exporta a Excel.'}`,
      );
    }
    const rows = await this.exportRows(where, filters);
    const count = (status: TicketStatus): number => rows.filter((t) => t.status === status).length;
    const filtersLine = describeFilters(filters, await this.filterNames(filters));
    const statusColor: Record<TicketStatus, string> = { RESOLVED: '#12b76a', PENDING: '#b97a00', UNRESOLVED: '#e5484d' };

    const headerCell = (text: string): TableCell => ({ text, bold: true, color: '#ffffff', fillColor: '#0c7beb' });
    const body: TableCell[][] = [
      ['Código', 'Fecha caso', 'Registro', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Observación'].map(headerCell),
      ...rows.map((t): TableCell[] => [
        ticketCode(t.id),
        t.time ? `${formatDateEs(t.date)} ${t.time}` : formatDateEs(t.date),
        formatMomentEs(t.createdAt),
        pdfSafe(t.company),
        pdfSafe(t.description),
        { text: STATUS_LABEL[t.status], color: statusColor[t.status], bold: true },
        pdfSafe(t.assignedToClient ? 'Cliente' : (t.assignee?.name ?? '')),
        pdfSafe(notesText(t.notes)),
      ]),
    ];

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [28, 56, 28, 36],
      defaultStyle: { font: 'Helvetica', fontSize: 8 },
      header: {
        margin: [28, 22, 28, 0],
        columns: [
          { text: 'Casos de Soporte', fontSize: 15, bold: true, color: '#0c7beb' },
          { text: `Generado el ${formatDateEs(todayDateOnly())}`, alignment: 'right', fontSize: 8, color: '#5b6472', margin: [0, 6, 0, 0] },
        ],
      },
      footer: (page: number, pages: number) => ({
        text: `Página ${page} de ${pages}`,
        alignment: 'center',
        fontSize: 7,
        color: '#5b6472',
        margin: [0, 12, 0, 0],
      }),
      content: [
        { text: pdfSafe(filtersLine ? `Filtros: ${filtersLine}` : 'Sin filtros: todos los casos'), color: '#5b6472', margin: [0, 0, 0, 4] },
        {
          text: `Total: ${rows.length}   ·   Resueltos: ${count('RESOLVED')}   ·   Pendientes: ${count('PENDING')}   ·   Sin resolver: ${count('UNRESOLVED')}`,
          bold: true,
          fontSize: 9,
          margin: [0, 0, 0, 8],
        },
        {
          table: { headerRows: 1, widths: [44, 46, 46, 90, '*', 48, 60, 170], body },
          layout: {
            hLineWidth: () => 0.5,
            vLineWidth: () => 0,
            hLineColor: () => '#dbe4f3',
            paddingTop: () => 4,
            paddingBottom: () => 4,
          },
        },
      ],
    };

    const printer = new PdfPrinter({
      Helvetica: {
        normal: 'Helvetica',
        bold: 'Helvetica-Bold',
        italics: 'Helvetica-Oblique',
        bolditalics: 'Helvetica-BoldOblique',
      },
    });
    const document = printer.createPdfKitDocument(definition);
    return new Promise<Buffer>((resolvePdf, reject) => {
      const chunks: Buffer[] = [];
      document.on('data', (chunk: Buffer) => chunks.push(chunk));
      document.on('end', () => resolvePdf(Buffer.concat(chunks)));
      document.on('error', reject);
      document.end();
    });
  }

  /**
   * Every case of the selection. There is no `take` on purpose: the caller has just counted the
   * selection against its limit, and a cut here would hand over an incomplete file without notice.
   */
  private exportRows(where: Prisma.TicketWhereInput, filters: TicketFilters): Promise<ExportRow[]> {
    return this.prisma.ticket.findMany({
      where,
      include: exportInclude,
      // Same order as the list on screen.
      orderBy: ticketOrder(filters),
    });
  }

  /** Looks up the names behind the ids the filters carry. */
  private async filterNames(filters: TicketFilters): Promise<FilterNames> {
    const [assignee, module] = await Promise.all([
      typeof filters.assignee === 'number'
        ? this.prisma.assignee.findUnique({ where: { id: filters.assignee }, select: { name: true } })
        : null,
      filters.moduleId !== undefined
        ? this.prisma.systemModule.findUnique({
            where: { id: filters.moduleId },
            select: { name: true, parent: { select: { name: true } } },
          })
        : null,
    ]);
    return {
      assignee: assignee?.name ?? null,
      module: module ? moduleFullName(module) : null,
    };
  }

  private async readTable(file: { buffer: Buffer; originalname: string }): Promise<unknown[][]> {
    if (/\.csv$/i.test(file.originalname)) return parseCsv(file.buffer.toString('utf8'));
    if (!/\.xlsx$/i.test(file.originalname)) {
      throw new BadRequestException('Formato no soportado. Usa un archivo .xlsx o .csv');
    }

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    } catch {
      throw new BadRequestException('No se pudo leer el archivo Excel');
    }
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new BadRequestException('El archivo no tiene hojas');

    const table: unknown[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // ExcelJS row values are 1-based and sparse.
      table.push(Array.from(row.values as unknown[]).slice(1));
    });
    return table;
  }
}
