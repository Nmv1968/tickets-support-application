import ExcelJS from 'exceljs';

// What the spreadsheets of the API share: the export of the list (transfer/xlsx-export.ts), the
// import template (transfer/import-template.ts) and the report of the dashboard.

/**
 * The most cases a spreadsheet of the list or of the report holds (see `refuseOverLimit`). It is
 * built in memory, with every case and its observations loaded at once.
 */
export const XLSX_EXPORT_LIMIT = 20_000;

/** How the cells of the spreadsheets of the app show a day, a time of day and a moment. */
export const EXCEL_FORMAT = { day: 'dd/mm/yyyy', time: 'hh:mm', moment: 'dd/mm/yyyy hh:mm' } as const;

/** Header row of the spreadsheets of the app: white bold text on the brand blue. */
export function paintHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { horizontal: 'center', vertical: 'middle' };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B6' } };
  });
}

/**
 * Excel cells have no time zone and ExcelJS writes the UTC reading of a Date.
 * Shifting by the server's offset makes the cell show local time.
 */
export function excelMoment(value: Date | null): Date | null {
  return value ? new Date(value.getTime() - value.getTimezoneOffset() * 60_000) : null;
}
