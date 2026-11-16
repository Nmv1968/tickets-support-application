import { BadRequestException } from '@nestjs/common';
import type { TicketStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { formatDateOnly, searchKey } from '../common/labels';
import { UNREADABLE_XLSX, checkXlsxSize } from './xlsx-size';

// Reading the file of an import: its rows, and what each of its cells says. Nothing here knows the
// catalogs or the database: see sheet-import.ts.

export type DateOrder = 'mdy' | 'dmy';

/** The file of an import as it was uploaded. */
export interface SheetFile {
  buffer: Buffer;
  originalname: string;
}

/** A row of the sheet, with the number it has there: it is how a person finds it again. */
export interface SheetRow {
  number: number;
  cells: unknown[];
}

/**
 * Rows a sheet may have below its headers, blank ones included. The cases of a sheet are stored in
 * one transaction, and a transaction needs a time limit; the size of the file is no bound for it:
 * the 20 MB the upload admits hold a million short rows of CSV. It is as many cases as an export to
 * Excel carries (`XLSX_EXPORT_LIMIT`), so a whole export can be imported back.
 */
export const MAX_IMPORT_ROWS = 20_000;

/** Rows at the top of a sheet where the import looks for its headers. */
export const HEADER_ROWS = 21;

/**
 * Rows of a CSV the import reads at most: the headers as far down as they may be, the rows it
 * imports, and one more. With them it knows the file has too many; reading on would only take
 * memory, and a CSV of 20 MB made of empty lines has twenty million rows.
 */
export const MAX_CSV_ROWS = HEADER_ROWS + MAX_IMPORT_ROWS + 1;

/** The rows of the file of an import: the records of a CSV, or the rows of the first sheet of an Excel file. */
export async function readTable(file: SheetFile): Promise<SheetRow[]> {
  if (/\.csv$/i.test(file.originalname)) {
    const records = parseCsv(decodeCsv(file.buffer), MAX_CSV_ROWS);
    if (records.length === MAX_CSV_ROWS) {
      throw new BadRequestException(
        `El archivo tiene más de ${MAX_IMPORT_ROWS} filas debajo de los encabezados y se pueden importar hasta ${MAX_IMPORT_ROWS} a la vez. Divídelo en varios archivos.`,
      );
    }
    // A spreadsheet program shows each record of a CSV as one row, in order from the first.
    return records.map((cells, index) => ({ number: index + 1, cells }));
  }
  if (!/\.xlsx$/i.test(file.originalname)) {
    throw new BadRequestException('Formato no soportado. Usa un archivo .xlsx o .csv');
  }

  // Before ExcelJS, which inflates the whole file into memory before a row can be counted.
  await checkXlsxSize(file.buffer);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    throw new BadRequestException(UNREADABLE_XLSX);
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

/** Flattens the shapes ExcelJS uses for a cell value. */
export function cellValue(value: unknown): string | number | Date | null {
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

export function cellText(value: unknown): string {
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

/** The records of a CSV, at most `maxRows` of them: the text after the last one is not read. */
export function parseCsv(text: string, maxRows = Infinity): string[][] {
  const clean = text.replace(/^\uFEFF/, '');
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
      if (rows.length === maxRows) return rows;
      row = [];
      field = '';
    } else if (char !== '\r') field += char;
  }
  if ((field || row.length) && rows.length < maxRows) {
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
export function timeOfDateCell(value: unknown): string | null {
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
