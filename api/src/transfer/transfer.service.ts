import { BadRequestException, Injectable } from '@nestjs/common';
import { Priority, Prisma, TicketStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { ASSIGNEE_NAME_MAX, meansNobody } from '../assignees/assignees.controller';
import type { AuthUser } from '../common/auth';
import { withCatalogLock } from '../common/catalog-lock';
import type { NamedCatalog } from '../common/catalog-lock';
import {
  PRIORITIES,
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
import { COMPANY_NAME_MAX } from '../companies/companies.controller';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SUPPORT_TYPE_NAME_MAX, meansNoType } from '../support-types/support-types.controller';
import { MAX_SUPPORT_TYPES, TicketsService, activityStamp, slaDueAt, ticketOrder } from '../tickets/tickets.service';
import type { ArchivedFilter, PromiseFilter, TicketFilters } from '../tickets/tickets.service';

type DateOrder = 'mdy' | 'dmy';
type ColumnKey = 'date' | 'time' | 'company' | 'description' | 'status' | 'priority' | 'module' | 'assignee' | 'supportTypes' | 'note';

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

/** A row of the sheet, with the number it has there: it is how a person finds it again. */
interface SheetRow {
  number: number;
  cells: unknown[];
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

/** Rows of the template that carry the cell checks. Rows below them import the same, without the checks. */
export const TEMPLATE_ROWS = 2_000;

/** Sheet of the template with what the system has: the lists of "Casos" read it, and so does the person. */
export const TEMPLATE_VALUES_SHEET = 'Valores del sistema';

/** The lists of "Valores del sistema". */
type ListKey = 'companies' | 'statuses' | 'priorities' | 'modules' | 'assignees' | 'supportTypes';

/** What the catalogs offer when the template is downloaded: the names of their active entries. */
export interface TemplateValues {
  companies: string[];
  /** Full names: "Ventas > Facturas". */
  modules: string[];
  assignees: string[];
  supportTypes: string[];
}

interface TemplateColumn {
  /** Field of the import that reads the column. Both "tipo" columns go to the same one. */
  key: ColumnKey;
  header: string;
  width: number;
  required: boolean;
  /** What goes in it. A column with a list of a catalog adds where that list comes from: see `TemplateList`. */
  help: string;
  /** The list its cells choose from. */
  list?: ListKey;
}

/**
 * The columns of the import template, in order. Each header is one the import recognises
 * (`HEADER_PATTERNS`). `help` is what the person reads about the column: as a note on its
 * header cell and in the "Instrucciones" sheet.
 */
export const TEMPLATE_COLUMNS: TemplateColumn[] = [
  {
    key: 'date',
    header: 'Fecha',
    width: 14,
    required: false,
    help: 'Día en que el cliente reportó el caso. Escríbela como fecha, por ejemplo 15/03/2026. Vacía: toma la fecha de la fila de arriba; en la primera fila, la de hoy.',
  },
  { key: 'time', header: 'Hora', width: 9, required: false, help: 'Hora en que el cliente reportó el caso, por ejemplo 14:35. Vacía: el caso queda solo con la fecha.' },
  { key: 'company', header: 'Empresa', width: 30, required: true, list: 'companies', help: 'Empresa que reporta el caso.' },
  { key: 'description', header: 'Descripción', width: 60, required: true, help: 'Qué pasó o qué se pidió. Máximo 5000 caracteres.' },
  { key: 'status', header: 'Estado', width: 16, required: false, list: 'statuses', help: 'Pendiente, Resuelto o Sin resolver. Vacío: Pendiente.' },
  { key: 'priority', header: 'Prioridad', width: 12, required: false, list: 'priorities', help: 'Baja, Media, Alta o Crítica. Vacía: sin prioridad.' },
  { key: 'module', header: 'Módulo', width: 30, required: false, list: 'modules', help: 'Módulo del sistema al que corresponde el caso. Vacío: sin módulo.' },
  { key: 'assignee', header: 'Responsable', width: 24, required: false, list: 'assignees', help: 'Persona a cargo. Vacío: sin asignar.' },
  { key: 'supportTypes', header: 'Tipo de soporte', width: 24, required: false, list: 'supportTypes', help: 'Qué clase de soporte fue. Vacío: sin tipo.' },
  {
    key: 'supportTypes',
    header: 'Otro tipo de soporte',
    width: 24,
    required: false,
    list: 'supportTypes',
    help: 'Un segundo tipo de soporte, para el caso que tiene más de uno.',
  },
  { key: 'note', header: 'Observación', width: 60, required: false, help: 'Nota o solución del caso. Máximo 5000 caracteres.' },
];

const STATUS_OPTIONS = [STATUS_LABEL.PENDING, STATUS_LABEL.RESOLVED, STATUS_LABEL.UNRESOLVED];
const PRIORITY_OPTIONS = PRIORITIES.map((priority) => PRIORITY_LABEL[priority]);

/** Excel shows this much of the title and of the text of the message a cell rule answers with. */
export const RULE_TITLE_MAX = 32;
export const RULE_MESSAGE_MAX = 255;

interface TemplateList {
  key: ListKey;
  /** Title of its column in "Valores del sistema". */
  header: string;
  width: number;
  /** What Excel answers to a value that is not in the list. */
  errorTitle: string;
  error: string;
  /** For a catalog: where its values come from, added to the help of the columns that choose from it. */
  source?: string;
  /** And what the help says instead while the catalog has nothing registered. */
  empty?: string;
}

/**
 * The texts of the list of a catalog, from the words for its entries and the tab of Configuración
 * that registers them. A value that is not in the list has to be registered first: the cell does not take it.
 */
const catalogList = (words: { one: string; the: string; many: string; register: string; tab: string }): Pick<TemplateList, 'error' | 'source' | 'empty'> => ({
  error: `Elige ${words.one} de la lista. Si no está, ${words.register} primero en Configuración > ${words.tab} y descarga la plantilla otra vez.`,
  source: `Se elige de la lista: ${words.the} ${words.many} en Configuración > ${words.tab}.`,
  empty: `Todavía no hay ${words.many} en Configuración > ${words.tab}.`,
});

/** The lists of the sheet "Valores del sistema", in the order of its columns. A cell of "Casos" that chooses from one takes nothing else. */
const TEMPLATE_LISTS: TemplateList[] = [
  {
    key: 'companies',
    header: 'Empresas',
    width: 34,
    errorTitle: 'Empresa no registrada',
    ...catalogList({ one: 'una empresa', the: 'las', many: 'empresas registradas', register: 'regístrala', tab: 'Empresas' }),
  },
  {
    key: 'statuses',
    header: 'Estados',
    width: 16,
    errorTitle: 'Estado no válido',
    error: `Elige ${STATUS_OPTIONS.join(', ')}. Vacío se toma como ${STATUS_LABEL.PENDING}.`,
  },
  {
    key: 'priorities',
    header: 'Prioridades',
    width: 14,
    errorTitle: 'Prioridad no válida',
    error: `Elige ${PRIORITY_OPTIONS.join(', ')}. Vacía: el caso queda sin prioridad.`,
  },
  {
    key: 'modules',
    header: 'Módulos',
    width: 34,
    errorTitle: 'Módulo no registrado',
    ...catalogList({ one: 'un módulo', the: 'los', many: 'módulos registrados', register: 'regístralo', tab: 'Módulos' }),
  },
  {
    key: 'assignees',
    header: 'Responsables',
    width: 26,
    errorTitle: 'Responsable no registrado',
    ...catalogList({ one: 'un responsable', the: 'los', many: 'responsables registrados', register: 'regístralo', tab: 'Responsables' }),
  },
  {
    key: 'supportTypes',
    header: 'Tipos de soporte',
    width: 28,
    errorTitle: 'Tipo de soporte no registrado',
    ...catalogList({ one: 'un tipo de soporte', the: 'los', many: 'tipos de soporte registrados', register: 'regístralo', tab: 'Tipos de soporte' }),
  },
];

const TEMPLATE_RULES = [
  'No cambies los nombres de las columnas y deja "Casos" como primera hoja: es la que lee el sistema.',
  'Una fila sin Empresa o sin Descripción no se importa.',
  `Empresa, Estado, Prioridad, Módulo, Responsable y los tipos de soporte se eligen de listas. La hoja "${TEMPLATE_VALUES_SHEET}" muestra lo que había registrado al descargar la plantilla. ` +
    'Cambiar esa hoja no registra nada: lo que falte se registra en Configuración, y después se descarga la plantilla otra vez.',
  'Una fila con una empresa, un responsable, un tipo de soporte, un módulo, una prioridad o un estado que no existe en el sistema se rechaza: no se importa, y la vista previa dice cuál es y por qué. ' +
    'Al importar se puede pedir que se creen las empresas, los responsables y los tipos de soporte que falten; los módulos, las prioridades y los estados, no.',
  'Un caso con la misma fecha, empresa y descripción que uno ya registrado se omite, así que importar dos veces el mismo archivo no duplica casos.',
  'La "Fecha" de la plantilla es la fecha del caso. La fecha de registro de cada caso es el momento de la importación.',
  `Las listas y los avisos de las celdas llegan hasta la fila ${TEMPLATE_ROWS + 1}. Puedes seguir más abajo: esas filas se importan igual, sin avisos.`,
];

/** Header row of the spreadsheets of the app: white bold text on the brand blue. */
export function paintHeader(row: ExcelJS.Row): void {
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
 * The import template. It has the columns `import` reads and cell rules against the usual
 * mistakes: a date typed as text, a status worded another way, a company or a person that is not
 * registered. "Casos" is the first sheet because `import` reads that one. `values` is what the
 * catalogs offer: it fills the sheet "Valores del sistema", which the lists of "Casos" read.
 */
export function buildTemplate(values: TemplateValues): ExcelJS.Workbook {
  const workbook = new ExcelJS.Workbook();
  const options: Record<ListKey, string[]> = { ...values, statuses: STATUS_OPTIONS, priorities: PRIORITY_OPTIONS };
  // What a person reads about a column. One that chooses from a catalog says where its list comes
  // from, or that nothing is registered there yet.
  const help = (column: TemplateColumn): string => {
    const list = TEMPLATE_LISTS.find((entry) => entry.key === column.list);
    const about = list && (options[list.key].length ? list.source : list.empty);
    return about ? `${column.help} ${about}` : column.help;
  };

  const sheet = workbook.addWorksheet('Casos', { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = TEMPLATE_COLUMNS.map((column) => ({
    header: column.header,
    width: column.width,
    // A date cell keeps what is typed as a real date, so day and month cannot be swapped on import.
    style: column.key === 'date' ? { numFmt: 'dd/mm/yyyy' } : column.key === 'time' ? { numFmt: 'hh:mm' } : { alignment: { vertical: 'top', wrapText: true } },
  }));
  const header = sheet.getRow(1);
  paintHeader(header);
  TEMPLATE_COLUMNS.forEach((column, index) => {
    header.getCell(index + 1).note = `${column.required ? 'Obligatoria' : 'Opcional'}. ${help(column)}`;
  });

  // The values go in their own sheet: a list written inside the rule is limited to 255 characters.
  // It is in sight on purpose: besides feeding the lists, it tells the person what is registered.
  const lists = workbook.addWorksheet(TEMPLATE_VALUES_SHEET, { views: [{ state: 'frozen', ySplit: 1 }] });
  lists.columns = TEMPLATE_LISTS.map((list) => ({ header: list.header, width: list.width }));
  paintHeader(lists.getRow(1));
  TEMPLATE_LISTS.forEach((list, index) => {
    options[list.key].forEach((value, row) => (lists.getCell(row + 2, index + 1).value = value));
  });

  /** The cells of a column of "Casos" that carry its rule. */
  const rows = (index: number): string => {
    const letter = sheet.getColumn(index + 1).letter;
    return `${letter}2:${letter}${TEMPLATE_ROWS + 1}`;
  };
  TEMPLATE_COLUMNS.forEach((column, index) => {
    if (column.key === 'date') {
      addRangeRule(sheet, rows(index), {
        type: 'date',
        operator: 'between',
        formulae: [new Date(Date.UTC(2000, 0, 1)), new Date(Date.UTC(2099, 11, 31))],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Fecha no válida',
        error: 'Escribe una fecha, por ejemplo 15/03/2026.',
      });
    }
    // Excel keeps a time as the part of a day that has gone by: 0 is midnight and 0.5 is noon.
    if (column.key === 'time') {
      addRangeRule(sheet, rows(index), {
        type: 'decimal',
        operator: 'between',
        formulae: [0, 0.99999],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Hora no válida',
        error: 'Escribe una hora, por ejemplo 14:35.',
      });
    }

    const list = TEMPLATE_LISTS.find((entry) => entry.key === column.list);
    const count = list ? options[list.key].length : 0;
    // A catalog with nothing registered gives no list: there are no cells to point the rule at.
    // The column takes any text, and the import rejects the rows that name what it does not know.
    if (!list || !count) return;
    const letter = lists.getColumn(TEMPLATE_LISTS.indexOf(list) + 1).letter;
    addRangeRule(sheet, rows(index), {
      type: 'list',
      formulae: [`'${TEMPLATE_VALUES_SHEET}'!$${letter}$2:$${letter}$${count + 1}`],
      allowBlank: true,
      // Strict: Excel refuses what is not in the list, as the import would reject the row.
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: list.errorTitle,
      error: list.error,
    });
  });

  const guide = workbook.addWorksheet('Instrucciones');
  guide.columns = [{ width: 22 }, { width: 13 }, { width: 110 }];
  /** Characters of a line of text across the three columns, with room to spare. */
  const GUIDE_LINE_CHARS = 125;
  const line = (text: string): ExcelJS.Row => {
    const row = guide.addRow([text]);
    guide.mergeCells(row.number, 1, row.number, 3);
    row.alignment = { vertical: 'top', wrapText: true };
    // Excel does not fit the height of a row to a merged cell: a text of several lines says how many it takes.
    const lines = Math.ceil(text.length / GUIDE_LINE_CHARS);
    if (lines > 1) row.height = lines * 15;
    return row;
  };
  line('Plantilla para importar casos de soporte').font = { bold: true, size: 14 };
  line('Llena la hoja "Casos", una fila por caso, y súbela en Casos > Importar. Antes de guardar nada verás una vista previa.');
  guide.addRow([]);
  paintHeader(guide.addRow(['Columna', 'Obligatoria', 'Qué va en ella']));
  for (const column of TEMPLATE_COLUMNS) {
    guide.addRow([column.header, column.required ? 'Sí' : 'No', help(column)]).alignment = { vertical: 'top', wrapText: true };
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
  company: { select: { name: true } },
  assignee: { select: { name: true } },
  module: { select: { name: true, parent: { select: { name: true } } } },
  supportTypes: { select: { supportType: { select: { name: true } } } },
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

/**
 * The text of a CSV file. Most programs write it in UTF-8. Excel on Windows, with its plain "CSV
 * (delimitado por comas)", writes the Windows code page of Western Europe instead, where "ó" is
 * one byte that is not valid UTF-8. Read as UTF-8 anyway, every accented letter becomes the mark
 * of an unreadable character: no name with one is found in its catalog, and "Módulo" is not
 * taken for the column it is. So UTF-8 is read strictly, and a file that is not UTF-8 is read as
 * that code page.
 */
export function decodeCsv(file: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file);
  } catch {
    return new TextDecoder('windows-1252').decode(file);
  }
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

/**
 * The status an "Estado" cell names. An empty cell is a pending case. The three statuses are read
 * by how they start, so the sheets that write "Resuelta" or "Sin resover" keep importing. Null
 * for anything else: "Cerrado" is not a status of the system, and taking it for a pending case
 * would bring a history of closed cases in as open ones.
 */
export function toStatus(value: string): TicketStatus | null {
  const text = searchKey(value);
  if (!text || text.startsWith('pend')) return 'PENDING';
  if (text.startsWith('resuel')) return 'RESOLVED';
  if (text.startsWith('sin res')) return 'UNRESOLVED';
  return null;
}

/** The priorities by the `searchKey` of their label, which is how a sheet writes them: "Crítica", "critica". */
const PRIORITY_BY_LABEL = new Map(PRIORITIES.map((priority) => [searchKey(PRIORITY_LABEL[priority]), priority]));

/** A name as the catalogs keep it: without spaces around it, and with single spaces inside. */
function tidyName(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Why a row is rejected: it names something that is in no catalog. */
const notFound = (what: string, value: string): string => `${what} «${value}» no existe`;

/** An entry of a catalog of names, as the import needs it. */
interface CatalogEntry {
  id: number;
  name: string;
}

/**
 * One catalog of names as the import uses it: the companies, the responsibles or the support
 * types. It finds an entry by the `searchKey` of its name, so the sheet may write it with other
 * capitals, accents or spaces. It also keeps the names of the sheet that it lacks: one per name,
 * however the sheet spells it from row to row, under its first spelling.
 */
class NameCatalog {
  private readonly entries = new Map<string, CatalogEntry>();
  /** Names of the sheet that the catalog lacks, by key, as first written. */
  private readonly missing = new Map<string, string>();
  /** Keys of the missing names that a row to import carries. */
  private readonly wanted = new Set<string>();

  /** `entries` is the whole catalog, active or not: a sheet that names a deactivated entry means that one, not a new one. */
  constructor(entries: CatalogEntry[]) {
    for (const entry of entries) this.entries.set(searchKey(entry.name), entry);
  }

  has(written: string): boolean {
    return this.entries.has(searchKey(written));
  }

  /** The name a case gets for what the sheet wrote: the one of the catalog, or the first spelling of a name it lacks. */
  read(written: string): { name: string; known: boolean } {
    const key = searchKey(written);
    const entry = this.entries.get(key);
    if (entry) return { name: entry.name, known: true };
    if (!this.missing.has(key)) this.missing.set(key, written);
    return { name: this.missing.get(key) ?? written, known: false };
  }

  /** A row to import carries this name, which the catalog lacks: it is one to add. */
  want(name: string): void {
    this.wanted.add(searchKey(name));
  }

  /** Every name of the sheet that the catalog lacks. */
  get unknown(): string[] {
    return [...this.missing.values()];
  }

  /** Of those, the ones to add: no entry is created for a row that is not imported. */
  get toCreate(): string[] {
    return [...this.missing].filter(([key]) => this.wanted.has(key)).map(([, name]) => name);
  }

  /** An entry just created. */
  add(name: string, id: number): void {
    this.entries.set(searchKey(name), { id, name });
  }

  id(name: string): number {
    const entry = this.entries.get(searchKey(name));
    // Every name of a row to import is here: the catalog had it, or it has just been added.
    if (!entry) throw new Error(`The import has no catalog entry for "${name}"`);
    return entry.id;
  }
}

/** `searchKey` of the name of a module, with its ">" spaced the same however the sheet writes it: "Ventas>Facturas". */
function moduleKey(name: string): string {
  return searchKey(name.replace(/\s*>\s*/g, ' > '));
}

/**
 * The modules as the import finds them: by their full name ("Ventas > Facturas"), or by their own
 * name ("Facturas") while only one module is called so.
 */
class ModuleCatalog {
  private readonly byFullName = new Map<string, { id: number; fullName: string }>();
  /** By own name, the keys of the full names of the modules called so. */
  private readonly sharing = new Map<string, Set<string>>();

  constructor(modules: { id: number; name: string; parent: { name: string } | null }[]) {
    for (const module of modules) {
      const fullName = moduleFullName(module);
      const key = moduleKey(fullName);
      // Nothing stops two modules from having the same full name. The first one is taken: see the order of the query.
      if (!this.byFullName.has(key)) this.byFullName.set(key, { id: module.id, fullName });
      const own = searchKey(module.name);
      this.sharing.set(own, (this.sharing.get(own) ?? new Set<string>()).add(key));
    }
  }

  /**
   * The module a cell names. A list when the cell gives an own name that several modules have:
   * their full names, for the person to write one of them. Null when no module is called so.
   */
  find(written: string): { id: number; fullName: string } | string[] | null {
    const key = moduleKey(written);
    const exact = this.byFullName.get(key);
    if (exact) return exact;
    const called = [...(this.sharing.get(key) ?? [])].flatMap((fullKey) => this.byFullName.get(fullKey) ?? []);
    if (called.length === 1) return called[0];
    return called.length ? called.map((module) => module.fullName) : null;
  }

  /** Id of the module with this full name. */
  id(fullName: string): number | null {
    return this.byFullName.get(moduleKey(fullName))?.id ?? null;
  }
}

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

/** Names the description of the filters needs and the filters only carry as ids. Null when the id points to nothing. */
export interface FilterNames {
  assignee: string | null;
  company: string | null;
  /** With its parent, as the list shows it: "Ventas > Facturas". */
  module: string | null;
  supportType: string | null;
  /** The user of the "registered by" filter. */
  createdBy: string | null;
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

const ARCHIVED_TEXT: Record<ArchivedFilter, string> = {
  only: 'Solo archivados',
  all: 'Incluye archivados',
};

/** A filter by the id of a record, worded with its name. An id that points to nothing says so. */
const named = (label: string, id: number, name: string | null): string => `${label}: ${name ?? `id ${id} (no existe)`}`;

/**
 * How the PDF header words each filter, in the order it prints them. The type asks for one entry per
 * filter of `TicketFilters`: a filter added to the list does not compile until it is worded here,
 * so a filtered PDF cannot be headed "Sin filtros".
 */
const FILTER_TEXT: { [K in FilterKey]: (value: NonNullable<TicketFilters[K]>, names: FilterNames) => string } = {
  status: (statuses) => `Estado: ${statuses.map((status) => STATUS_LABEL[status]).join(', ')}`,
  assignee: (assignee, names) => (assignee === 'none' ? 'Responsable: sin asignar' : named('Responsable', assignee, names.assignee)),
  companyId: (id, names) => named('Empresa', id, names.company),
  priority: (priority) => `Prioridad: ${PRIORITY_LABEL[priority]}`,
  moduleId: (id, names) => named('Módulo', id, names.module),
  supportType: (id, names) => named('Tipo de soporte', id, names.supportType),
  createdBy: (id, names) => named('Registrado por', id, names.createdBy),
  from: (day) => `Desde: ${formatDateEs(parseDateOnly(day))}`,
  to: (day) => `Hasta: ${formatDateEs(parseDateOnly(day))}`,
  overdue: () => 'Solo vencidos',
  stale: () => 'Solo olvidados',
  promise: (promise) => `Solo ${PROMISE_TEXT[promise]}`,
  archived: (archived) => ARCHIVED_TEXT[archived],
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

/**
 * First line of the PDF: which cases it lists. Unless the filter of archived cases asks for them,
 * they are not in the file, and the line says so: "todos los casos" alone would promise them too.
 */
export function describeSelection(filters: TicketFilters, names: FilterNames): string {
  const line = describeFilters(filters, names);
  if (filters.archived) return `Filtros: ${line}`;
  return line ? `Filtros: ${line}  ·  Sin archivados` : 'Sin filtros: todos los casos sin archivar';
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

/**
 * The "Tipos de soporte" cell: the names of the types a case carries, in alphabetical order and
 * separated by commas. The import reads the cell back the same way.
 */
export function supportTypesText(types: { supportType: { name: string } }[]): string {
  return types
    .map((link) => link.supportType.name)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .join(', ');
}

/** Colour of each status in the PDFs of the app. */
export const PDF_STATUS_COLOR: Record<TicketStatus, string> = { RESOLVED: '#12b76a', PENDING: '#b97a00', UNRESOLVED: '#e5484d' };

/** Draws a pdfmake document with Helvetica, the font built into every PDF reader: no font file to ship. */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
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

@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Reads a sheet of cases and stores them. A row that names a company, a responsible, a support
   * type, a module, a priority or a status that does not exist is rejected: it is not imported,
   * and the answer says which row it is and why. `createMissing` adds to the catalogs the
   * companies, responsibles and support types they lack instead of rejecting those rows; a module,
   * a priority or a status is never created from a sheet. `dryRun` writes nothing: it reports what
   * would happen.
   */
  async import(
    file: { buffer: Buffer; originalname: string },
    options: { dryRun: boolean; dateOrder: DateOrder; createMissing: boolean },
    user: AuthUser,
  ): Promise<ImportResult> {
    const table = await this.readTable(file);

    const headerIndex = table.findIndex((row) => {
      const cells = row.cells.map((cell) => searchKey(cellText(cell)));
      return cells.some((c) => HEADER_PATTERNS.company.test(c)) && cells.some((c) => HEADER_PATTERNS.description.test(c));
    });
    if (headerIndex < 0 || headerIndex > 20) {
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
      this.prisma.ticket.findMany({ select: { date: true, company: { select: { name: true } }, description: true } }),
      this.prisma.company.findMany(named),
      this.prisma.assignee.findMany(named),
      this.prisma.supportType.findMany(named),
      this.prisma.systemModule.findMany({
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
        description: description.slice(0, 5000),
        status,
        priority,
        module: module && !Array.isArray(module) ? module.fullName : null,
        assignee: assigneeName,
        supportTypes: typeNames,
        note: cellText(at('note')).slice(0, 5000) || null,
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
    if (options.dryRun) return result;

    // What the catalogs lacked joins them first, so the cases can point at it. The answer says
    // what was really added: see `addMissing`.
    result.created = {
      companies: await this.addMissing('companies', companies, result.created.companies, {
        stored: (tx) => tx.company.findMany(named),
        add: (tx, names) => tx.company.createManyAndReturn({ data: names.map((name) => ({ name })), ...named }),
      }),
      // A name is all a responsible has: nobody becomes a user of the app by being named in a sheet.
      assignees: await this.addMissing('assignees', people, result.created.assignees, {
        stored: (tx) => tx.assignee.findMany(named),
        add: (tx, names) => tx.assignee.createManyAndReturn({ data: names.map((name) => ({ name })), ...named }),
      }),
      supportTypes: await this.addMissing('supportTypes', types, result.created.supportTypes, {
        stored: (tx) => tx.supportType.findMany(named),
        add: (tx, names) => tx.supportType.createManyAndReturn({ data: names.map((name) => ({ name, color: NEW_SUPPORT_TYPE_COLOR })), ...named }),
      }),
    };

    // Read only for a sheet that gives priorities: they are what a deadline comes from.
    const policies = rows.some((row) => row.priority) ? await this.prisma.slaPolicy.findMany() : [];
    const slaHours = new Map(policies.map((policy) => [policy.priority, policy.hours]));

    for (const row of rows) {
      // The registration moment (`createdAt`) is left to the database: it is now, the time of the import.
      // Midday UTC keeps the calendar day of the case stable in any time zone.
      const reportedAt = new Date(`${row.date}T12:00:00.000Z`);
      await this.prisma.ticket.create({
        data: {
          date: parseDateOnly(row.date),
          time: row.time,
          companyId: companies.id(row.company),
          description: row.description,
          searchText: ticketSearchKey(row.company, row.description),
          status: row.status,
          assigneeId: row.assignee ? people.id(row.assignee) : null,
          priority: row.priority,
          // As in a case registered by hand, the deadline of the priority runs from the registration: from now.
          dueAt: slaDueAt(new Date(), row.priority ? (slaHours.get(row.priority) ?? null) : null),
          moduleId: row.module ? modules.id(row.module) : null,
          supportTypes: row.supportTypes.length ? { create: row.supportTypes.map((type) => ({ supportTypeId: types.id(type) })) } : undefined,
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

  /**
   * Adds to a catalog the names of the sheet that it lacked, and gives `catalog` the id of each.
   * Like a person who adds one by hand, behind the lock of the catalog and after looking again:
   * the catalogs were read before the sheet was, and someone may have registered one of the names
   * since. That one is used as it is. Returns the names that were added.
   */
  private async addMissing(
    lock: NamedCatalog,
    catalog: NameCatalog,
    names: string[],
    table: {
      stored: (tx: Prisma.TransactionClient) => Promise<CatalogEntry[]>;
      /** One statement for them all: the lock is held for as little as it takes. */
      add: (tx: Prisma.TransactionClient, names: string[]) => Promise<CatalogEntry[]>;
    },
  ): Promise<string[]> {
    if (!names.length) return [];
    return withCatalogLock(this.prisma, lock, async (tx) => {
      const stored = await table.stored(tx);
      const taken = new Set(stored.map((entry) => searchKey(entry.name)));
      const lacking = names.filter((name) => !taken.has(searchKey(name)));
      const added = lacking.length ? await table.add(tx, lacking) : [];
      for (const entry of [...stored, ...added]) catalog.add(entry.name, entry.id);
      return lacking;
    });
  }

  /**
   * The spreadsheet people fill in to import cases. Its lists offer what a new case can take:
   * the active entries of each catalog, in the order the screens show them.
   */
  async template(): Promise<Buffer> {
    const active = { where: { active: true }, select: { name: true } } as const;
    const [companies, people, types, modules] = await Promise.all([
      this.prisma.company.findMany(active),
      this.prisma.assignee.findMany(active),
      this.prisma.supportType.findMany(active),
      this.prisma.systemModule.findMany({ where: { active: true }, select: { name: true, parent: { select: { name: true } } } }),
    ]);
    // Sorted here and not by the database, whose order depends on its locale: "Ñ" after "Z", capitals first.
    const sorted = (names: string[]): string[] => names.sort((a, b) => a.localeCompare(b, 'es'));
    const names = (rows: { name: string }[]): string[] => sorted(rows.map((row) => row.name));
    const workbook = buildTemplate({
      companies: names(companies),
      modules: sorted(modules.map((module) => moduleFullName(module))),
      assignees: names(people),
      supportTypes: names(types),
    });
    return Buffer.from(await workbook.xlsx.writeBuffer());
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
      { header: 'Tipos de soporte', key: 'supportTypes', width: 28 },
      { header: 'Estimado (min)', key: 'estimated', width: 15 },
      { header: 'Real (min)', key: 'spent', width: 11 },
      { header: 'Promesa de entrega', key: 'promised', width: 18, style: { numFmt: 'dd/mm/yyyy' } },
      { header: 'Fecha límite SLA', key: 'due', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      { header: 'Resuelto el', key: 'resolved', width: 17, style: { numFmt: 'dd/mm/yyyy hh:mm' } },
      // With the filter on "Todos" the file mixes both kinds of case, and this is what tells them
      // apart. The import does not know the column: an archived case comes back in as any other.
      { header: 'Archivado', key: 'archived', width: 11 },
    ];

    paintHeader(sheet.getRow(1));

    const statusFill: Record<TicketStatus, string> = { RESOLVED: 'FFA9D08E', PENDING: 'FFFFD966', UNRESOLVED: 'FFF4B183' };
    for (const t of rows) {
      const row = sheet.addRow({
        code: ticketCode(t.id),
        date: t.date,
        time: t.time ?? '',
        registered: excelMoment(t.createdAt),
        company: t.company.name,
        description: t.description,
        status: STATUS_LABEL[t.status],
        assignee: t.assignee?.name ?? '',
        notes: notesText(t.notes),
        priority: t.priority ? PRIORITY_LABEL[t.priority] : '',
        module: t.module ? moduleFullName(t.module) : '',
        supportTypes: supportTypesText(t.supportTypes),
        estimated: t.estimatedMinutes,
        spent: t.spentMinutes || null,
        promised: t.promisedDate,
        due: excelMoment(t.dueAt),
        resolved: excelMoment(t.resolvedAt),
        archived: t.archivedAt ? 'Sí' : 'No',
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
    const selection = describeSelection(filters, await this.filterNames(filters));

    // The description takes what the other columns leave of the sheet (A4 on its side is 841.89 pt
    // wide, and pdfmake leaves 4 pt at each side of a cell). A number and not "*": pdfmake never
    // makes a "*" column narrower than its longest word, so a web address in a description pushed
    // the columns after it off the page. In a column of a set width the word goes on in the next line.
    const sideMargin = 28;
    const [before, after] = [
      [44, 46, 46, 84],
      [48, 58, 66, 150],
    ];
    const others = [...before, ...after];
    const descriptionWidth = Math.floor(841.89 - 2 * sideMargin - others.reduce((sum, width) => sum + width, 0) - 8 * (others.length + 1));

    const headerCell = (text: string): TableCell => ({ text, bold: true, color: '#ffffff', fillColor: '#0c7beb' });
    const body: TableCell[][] = [
      ['Código', 'Fecha caso', 'Registro', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Tipos de soporte', 'Observación'].map(headerCell),
      ...rows.map((t): TableCell[] => [
        // The header only says that the file includes the archived cases: each of them says so itself.
        t.archivedAt ? { stack: [ticketCode(t.id), { text: '(archivado)', fontSize: 7, color: '#5b6472' }] } : ticketCode(t.id),
        t.time ? `${formatDateEs(t.date)} ${t.time}` : formatDateEs(t.date),
        formatMomentEs(t.createdAt),
        pdfSafe(t.company.name),
        pdfSafe(t.description),
        { text: STATUS_LABEL[t.status], color: PDF_STATUS_COLOR[t.status], bold: true },
        pdfSafe(t.assignee?.name ?? ''),
        pdfSafe(supportTypesText(t.supportTypes)),
        pdfSafe(notesText(t.notes)),
      ]),
    ];

    const definition: TDocumentDefinitions = {
      pageSize: 'A4',
      pageOrientation: 'landscape',
      pageMargins: [sideMargin, 56, sideMargin, 36],
      defaultStyle: { font: 'Helvetica', fontSize: 8 },
      header: {
        margin: [sideMargin, 22, sideMargin, 0],
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
        { text: pdfSafe(selection), color: '#5b6472', margin: [0, 0, 0, 4] },
        {
          text: `Total: ${rows.length}   ·   Resueltos: ${count('RESOLVED')}   ·   Pendientes: ${count('PENDING')}   ·   Sin resolver: ${count('UNRESOLVED')}`,
          bold: true,
          fontSize: 9,
          margin: [0, 0, 0, 8],
        },
        {
          table: { headerRows: 1, widths: [...before, descriptionWidth, ...after], body },
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

    return renderPdf(definition);
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
    const name = { select: { name: true } } as const;
    const [assignee, company, module, supportType, createdBy] = await Promise.all([
      typeof filters.assignee === 'number' ? this.prisma.assignee.findUnique({ where: { id: filters.assignee }, ...name }) : null,
      filters.companyId !== undefined ? this.prisma.company.findUnique({ where: { id: filters.companyId }, ...name }) : null,
      filters.moduleId !== undefined
        ? this.prisma.systemModule.findUnique({
            where: { id: filters.moduleId },
            select: { name: true, parent: { select: { name: true } } },
          })
        : null,
      filters.supportType !== undefined ? this.prisma.supportType.findUnique({ where: { id: filters.supportType }, ...name }) : null,
      filters.createdBy !== undefined ? this.prisma.user.findUnique({ where: { id: filters.createdBy }, ...name }) : null,
    ]);
    return {
      assignee: assignee?.name ?? null,
      company: company?.name ?? null,
      module: module ? moduleFullName(module) : null,
      supportType: supportType?.name ?? null,
      createdBy: createdBy?.name ?? null,
    };
  }

  private async readTable(file: { buffer: Buffer; originalname: string }): Promise<SheetRow[]> {
    // A spreadsheet program shows each record of a CSV as one row, in order from the first.
    if (/\.csv$/i.test(file.originalname)) return parseCsv(decodeCsv(file.buffer)).map((cells, index) => ({ number: index + 1, cells }));
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

    const table: SheetRow[] = [];
    sheet.eachRow({ includeEmpty: false }, (row, number) => {
      // ExcelJS row values are 1-based and sparse.
      table.push({ number, cells: Array.from(row.values as unknown[]).slice(1) });
    });
    return table;
  }
}
