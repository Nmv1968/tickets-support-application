import { Priority, Prisma, TicketStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import type { CanvasRect, Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import {
  NO_MODULE,
  NO_SUPPORT_TYPE,
  PRIORITIES,
  PRIORITY_LABEL,
  STATUS_LABEL,
  formatDateEs,
  formatDateOnly,
  formatMomentEs,
  moduleFullName,
  parseDateOnly,
  supportTypesText,
  ticketCode,
} from '../common/labels';
import { PDF_COLOR, PDF_HEADER_CELL, PDF_STATUS_COLOR, pdfFrame, pdfSafe } from '../common/pdf';
import { EXCEL_FORMAT, excelMoment, paintHeader } from '../common/xlsx';

// The numbers of the dashboard and the two files of its report. Everything here works on cases
// already loaded: it reads no database and no clock, so the same cases always give the same report.

/** What the numbers need from a case. */
export const summarySelect = {
  date: true,
  status: true,
  priority: true,
  createdAt: true,
  resolvedAt: true,
  dueAt: true,
  estimatedMinutes: true,
  spentMinutes: true,
  company: { select: { name: true } },
  assignee: { select: { name: true } },
  // The full name, as the case shows it everywhere else: two submodules can share their own name.
  module: { select: { name: true, parent: { select: { name: true } } } },
  supportTypes: { select: { supportType: { select: { name: true, color: true } } } },
} satisfies Prisma.TicketSelect;

/** What the "Datos" sheet adds: the rest of what a person may want to group or filter the cases by. */
export const reportSelect = {
  ...summarySelect,
  id: true,
  time: true,
  description: true,
  promisedDate: true,
  archivedAt: true,
  createdBy: { select: { name: true } },
} satisfies Prisma.TicketSelect;

export type SummaryRow = Prisma.TicketGetPayload<{ select: typeof summarySelect }>;
export type ReportRow = Prisma.TicketGetPayload<{ select: typeof reportSelect }>;

export interface StatusCount {
  name: string;
  unresolved: number;
  pending: number;
  resolved: number;
  total: number;
}

/** The numbers of a set of cases, whole: the screen and the PDF cut the long lists, the spreadsheet does not. */
export interface Summary {
  totals: { total: number; unresolved: number; pending: number; resolved: number; overdue: number };
  /** Creation to resolution, for cases resolved inside the app. Imported history has no resolution time. */
  avgResolutionHours: number | null;
  /** Percentage of cases with a deadline that were resolved on time. Open cases count once overdue. */
  slaCompliance: number | null;
  /** Sums over cases that have an estimate. */
  estimatedMinutes: number;
  spentMinutes: number;
  /** Most cases first. The cases nobody is responsible for go under "Sin asignar". */
  byAssignee: StatusCount[];
  /** Every company with a case, most cases first. */
  byCompany: StatusCount[];
  /** Every module with a case, most cases first. */
  byModule: { name: string; total: number }[];
  /** Cases without a module: `byModule` does not count them. */
  withoutModule: number;
  byPriority: { priority: Priority | null; total: number }[];
  /** A case with two types counts in both. The cases without one go last, as "Sin tipo" and with no colour. */
  bySupportType: { name: string; color: string | null; total: number }[];
  /** Every month with a case, oldest first. */
  monthly: { month: string; total: number; resolved: number; open: number }[];
}

const STATUS_KEY = { UNRESOLVED: 'unresolved', PENDING: 'pending', RESOLVED: 'resolved' } as const satisfies Record<TicketStatus, string>;

/** Most cases first. A tie goes by name, so the order does not depend on how the database hands the cases over. */
function byTotal(a: { name: string; total: number }, b: { name: string; total: number }): number {
  return b.total - a.total || a.name.localeCompare(b.name, 'es');
}

/** True for an open case past its SLA deadline at the moment `now`. */
export function isOverdue(t: { status: TicketStatus; dueAt: Date | null }, now: Date): boolean {
  return t.status !== 'RESOLVED' && !!t.dueAt && t.dueAt < now;
}

/** Hours from the registration of a case to its resolution. Null while it is open, and for imported history. */
function resolutionHours(t: { status: TicketStatus; createdAt: Date; resolvedAt: Date | null }): number | null {
  return t.status === 'RESOLVED' && t.resolvedAt ? (t.resolvedAt.getTime() - t.createdAt.getTime()) / 3_600_000 : null;
}

/** Counts the cases every way the dashboard shows them. `now` decides which open cases are overdue. */
export function summarize(rows: SummaryRow[], now: Date): Summary {
  const totals = { total: rows.length, unresolved: 0, pending: 0, resolved: 0, overdue: 0 };
  const assignees = new Map<string, StatusCount>();
  const companies = new Map<string, StatusCount>();
  const modules = new Map<string, number>();
  const priorities = new Map<Priority | null, number>();
  const types = new Map<string, { name: string; color: string | null; total: number }>();
  const months = new Map<string, { total: number; resolved: number }>();
  let withoutModule = 0;
  let withoutType = 0;
  let resolutionSum = 0;
  let resolutionCount = 0;
  let slaMet = 0;
  let slaBreached = 0;
  let estimatedMinutes = 0;
  let spentMinutes = 0;

  for (const t of rows) {
    const statusKey = STATUS_KEY[t.status];
    const resolved = t.status === 'RESOLVED';
    totals[statusKey]++;

    for (const [counts, name] of [
      [assignees, t.assignee?.name ?? 'Sin asignar'],
      [companies, t.company.name],
    ] as const) {
      const entry = counts.get(name) ?? { name, unresolved: 0, pending: 0, resolved: 0, total: 0 };
      entry[statusKey]++;
      entry.total++;
      counts.set(name, entry);
    }

    if (t.module) modules.set(moduleFullName(t.module), (modules.get(moduleFullName(t.module)) ?? 0) + 1);
    else withoutModule++;
    priorities.set(t.priority, (priorities.get(t.priority) ?? 0) + 1);

    if (!t.supportTypes.length) withoutType++;
    for (const { supportType } of t.supportTypes) {
      const entry = types.get(supportType.name) ?? { name: supportType.name, color: supportType.color, total: 0 };
      entry.total++;
      types.set(supportType.name, entry);
    }

    const month = formatDateOnly(t.date).slice(0, 7);
    const monthEntry = months.get(month) ?? { total: 0, resolved: 0 };
    monthEntry.total++;
    if (resolved) monthEntry.resolved++;
    months.set(month, monthEntry);

    const hours = resolutionHours(t);
    if (hours !== null) {
      resolutionSum += hours;
      resolutionCount++;
    }
    if (t.dueAt) {
      if (resolved && t.resolvedAt) {
        if (t.resolvedAt <= t.dueAt) slaMet++;
        else slaBreached++;
      } else if (isOverdue(t, now)) {
        slaBreached++;
        totals.overdue++;
      }
    }
    if (t.estimatedMinutes) {
      estimatedMinutes += t.estimatedMinutes;
      spentMinutes += t.spentMinutes;
    }
  }

  return {
    totals,
    avgResolutionHours: resolutionCount ? Math.round((resolutionSum / resolutionCount) * 10) / 10 : null,
    slaCompliance: slaMet + slaBreached ? Math.round((slaMet / (slaMet + slaBreached)) * 100) : null,
    estimatedMinutes,
    spentMinutes,
    byAssignee: [...assignees.values()].sort(byTotal),
    byCompany: [...companies.values()].sort(byTotal),
    byModule: [...modules.entries()].map(([name, total]) => ({ name, total })).sort(byTotal),
    withoutModule,
    byPriority: [...PRIORITIES, null].map((priority) => ({ priority, total: priorities.get(priority) ?? 0 })).filter((p) => p.total > 0),
    bySupportType: [...[...types.values()].sort(byTotal), ...(withoutType ? [{ name: NO_SUPPORT_TYPE, color: null, total: withoutType }] : [])],
    monthly: [...months.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, m]) => ({ month, total: m.total, resolved: m.resolved, open: m.total - m.resolved })),
  };
}

/** What the report says about itself: the cases it was asked for, and when. */
export interface ReportOptions {
  /** Range of the case date, both ends included, as `YYYY-MM-DD`. An absent end leaves that side open. */
  from?: string;
  to?: string;
  includeArchived: boolean;
  /** Moment the report is generated. An open case is overdue or not as of it. */
  now: Date;
}

/** The period of a report in words. */
export function periodText({ from, to }: Pick<ReportOptions, 'from' | 'to'>): string {
  const day = (value: string): string => formatDateEs(parseDateOnly(value));
  if (from && to) return `Del ${day(from)} al ${day(to)}`;
  if (from) return `Desde el ${day(from)}`;
  return to ? `Hasta el ${day(to)}` : 'Todas las fechas';
}

const priorityName = (priority: Priority | null): string => (priority ? PRIORITY_LABEL[priority] : 'Sin prioridad');
const yesNo = (value: boolean): string => (value ? 'Sí' : 'No');

/** `HH:mm` as the part of the day gone by, which is how Excel keeps a time. */
function excelTime(time: string | null): number | null {
  if (!time) return null;
  const [hours, minutes] = time.split(':').map(Number);
  return (hours * 60 + minutes) / 1440;
}

/**
 * The columns of the "Datos" sheet, in order: one row per case, each value in a cell of its own
 * kind (a date is a date, a number a number), which is what a pivot table or Power BI works with.
 */
const DATA_COLUMNS: { name: string; width: number; numFmt?: string; value: (t: ReportRow, now: Date) => string | number | Date | null }[] = [
  { name: 'Código', width: 12, value: (t) => ticketCode(t.id) },
  { name: 'Fecha del caso', width: 15, numFmt: EXCEL_FORMAT.day, value: (t) => t.date },
  { name: 'Hora', width: 8, numFmt: EXCEL_FORMAT.time, value: (t) => excelTime(t.time) },
  // Text, so that a pivot table groups by it as it is and orders the months without help.
  { name: 'Mes', width: 10, value: (t) => formatDateOnly(t.date).slice(0, 7) },
  { name: 'Fecha de registro', width: 17, numFmt: EXCEL_FORMAT.moment, value: (t) => excelMoment(t.createdAt) },
  { name: 'Empresa', width: 28, value: (t) => t.company.name },
  { name: 'Descripción', width: 60, value: (t) => t.description },
  { name: 'Estado', width: 14, value: (t) => STATUS_LABEL[t.status] },
  { name: 'Responsable', width: 20, value: (t) => t.assignee?.name ?? null },
  { name: 'Prioridad', width: 11, value: (t) => (t.priority ? PRIORITY_LABEL[t.priority] : null) },
  { name: 'Módulo', width: 26, value: (t) => (t.module ? moduleFullName(t.module) : null) },
  { name: 'Tipos de soporte', width: 28, value: (t) => supportTypesText(t.supportTypes.map((link) => link.supportType)) || null },
  { name: 'Minutos estimados', width: 18, value: (t) => t.estimatedMinutes },
  { name: 'Minutos reales', width: 15, value: (t) => t.spentMinutes || null },
  { name: 'Fecha límite', width: 17, numFmt: EXCEL_FORMAT.moment, value: (t) => excelMoment(t.dueAt) },
  { name: 'Vencido', width: 10, value: (t, now) => yesNo(isOverdue(t, now)) },
  { name: 'Promesa de entrega', width: 18, numFmt: EXCEL_FORMAT.day, value: (t) => t.promisedDate },
  { name: 'Resuelto el', width: 17, numFmt: EXCEL_FORMAT.moment, value: (t) => excelMoment(t.resolvedAt) },
  {
    name: 'Horas hasta resolver',
    width: 19,
    numFmt: '0.00',
    value: (t) => {
      const hours = resolutionHours(t);
      return hours === null ? null : Math.round(hours * 100) / 100;
    },
  },
  { name: 'Archivado', width: 11, value: (t) => yesNo(t.archivedAt !== null) },
  { name: 'Registrado por', width: 20, value: (t) => t.createdBy?.name ?? null },
];

/** Name of the Excel table of the "Datos" sheet: what a pivot table or Power BI is pointed at. */
export const DATA_TABLE = 'Casos';

type Cell = string | number | Date | null;

/** A sheet with a painted header that stays in sight, and one row per entry. */
function addSheet(workbook: ExcelJS.Workbook, name: string, columns: { header: string; width: number }[], rows: Cell[][]): ExcelJS.Worksheet {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
  sheet.columns = columns;
  paintHeader(sheet.getRow(1));
  sheet.addRows(rows);
  return sheet;
}

/**
 * The report of the dashboard as a spreadsheet meant for analysis: a summary with the numbers of
 * the screen, one sheet per breakdown with nothing cut off, and "Datos" with every case.
 */
export function buildReportWorkbook(rows: ReportRow[], options: ReportOptions): ExcelJS.Workbook {
  const summary = summarize(rows, options.now);
  const { totals } = summary;
  const workbook = new ExcelJS.Workbook();

  const overview = workbook.addWorksheet('Resumen');
  overview.columns = [{ width: 34 }, { width: 26 }, { width: 44 }];
  overview.addRow(['Reporte de soporte']).font = { bold: true, size: 14 };
  overview.addRow(['Periodo', periodText(options)]);
  overview.addRow(['Casos archivados', options.includeArchived ? 'Incluidos' : 'No incluidos']);
  const generated = overview.addRow(['Generado el', excelMoment(options.now)]);
  generated.getCell(2).numFmt = EXCEL_FORMAT.moment;
  generated.getCell(2).alignment = { horizontal: 'left' };
  overview.addRow([]);
  paintHeader(overview.addRow(['Indicador', 'Valor', 'Qué cuenta']));
  overview.addRows([
    ['Total de casos', totals.total, null],
    ['Sin resolver', totals.unresolved, null],
    ['Pendientes', totals.pending, null],
    ['Resueltos', totals.resolved, null],
    ['Vencidos', totals.overdue, 'Casos abiertos fuera del plazo de su prioridad'],
    ['Tiempo de resolución (horas)', summary.avgResolutionHours, 'Promedio de los casos resueltos en la aplicación'],
    ['Cumplimiento SLA (%)', summary.slaCompliance, 'Casos con prioridad resueltos dentro de su plazo'],
    ['Tiempo estimado (minutos)', summary.estimatedMinutes, 'Suma de los casos que tienen estimación'],
    ['Tiempo real (minutos)', summary.spentMinutes, 'De esos mismos casos'],
  ]);

  const statusColumns = (first: string): { header: string; width: number }[] => [
    { header: first, width: 34 },
    { header: 'Sin resolver', width: 14 },
    { header: 'Pendientes', width: 14 },
    { header: 'Resueltos', width: 14 },
    { header: 'Total', width: 10 },
  ];
  const statusRows = (counts: StatusCount[]): Cell[][] => counts.map((c) => [c.name, c.unresolved, c.pending, c.resolved, c.total]);
  const countColumns = (first: string): { header: string; width: number }[] => [
    { header: first, width: 34 },
    { header: 'Casos', width: 10 },
  ];

  addSheet(
    workbook,
    'Por mes',
    [
      { header: 'Mes', width: 12 },
      { header: 'Total', width: 10 },
      { header: 'Resueltos', width: 12 },
      { header: 'Abiertos', width: 12 },
    ],
    summary.monthly.map((m) => [m.month, m.total, m.resolved, m.open]),
  );
  addSheet(workbook, 'Por responsable', statusColumns('Responsable'), statusRows(summary.byAssignee));
  addSheet(workbook, 'Por empresa', statusColumns('Empresa'), statusRows(summary.byCompany));
  addSheet(workbook, 'Por módulo', countColumns('Módulo'), [
    ...summary.byModule.map((m) => [m.name, m.total]),
    // So that the sheet adds up to the total: the screen only draws the cases that have a module.
    ...(summary.withoutModule ? [[NO_MODULE, summary.withoutModule]] : []),
  ]);
  addSheet(
    workbook,
    'Por prioridad',
    countColumns('Prioridad'),
    summary.byPriority.map((p) => [priorityName(p.priority), p.total]),
  );
  const byType = addSheet(
    workbook,
    'Por tipo de soporte',
    countColumns('Tipo de soporte'),
    summary.bySupportType.map((type) => [type.name, type.total]),
  );
  byType.getCell('B1').note = 'Un caso con varios tipos cuenta en cada uno: la suma puede pasar del total de casos.';

  const data = workbook.addWorksheet('Datos', { views: [{ state: 'frozen', ySplit: 1 }] });
  if (rows.length) {
    data.addTable({
      name: DATA_TABLE,
      ref: 'A1',
      headerRow: true,
      style: { theme: 'TableStyleMedium2', showRowStripes: true },
      columns: DATA_COLUMNS.map((column) => ({ name: column.name, filterButton: true })),
      rows: rows.map((t) => DATA_COLUMNS.map((column) => column.value(t, options.now))),
    });
  } else {
    // Excel does not open a file with a table that has no rows: without cases, the header alone.
    paintHeader(data.addRow(DATA_COLUMNS.map((column) => column.name)));
  }
  DATA_COLUMNS.forEach((column, index) => {
    data.getColumn(index + 1).width = column.width;
    if (column.numFmt) data.getColumn(index + 1).numFmt = column.numFmt;
  });

  return workbook;
}

const NEUTRAL = '#98a2b3';
/** Companies the PDF lists. The spreadsheet has them all. */
export const PDF_COMPANIES = 15;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-07" as "jul 2026". */
function monthText(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1]} ${year}`;
}

/** Minutes as people read them: "2 h 30 min". */
function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/**
 * A bar as long as its parts are of `max`, which takes the whole `width`. Each part is a stretch
 * of the bar in its own colour: the statuses of the cases of a company, for instance.
 */
export function bar(parts: { value: number; color: string }[], max: number, width: number): Content {
  let x = 0;
  const canvas: CanvasRect[] = [];
  for (const { value, color } of parts) {
    if (value <= 0 || max <= 0) continue;
    const w = (value / max) * width;
    canvas.push({ type: 'rect', x, y: 1, w, h: 8, color });
    x += w;
  }
  // A thin line around the whole bar. A support type has the colour its team gave it: in white, or
  // in a pale one, its bar would not be seen on the page without it.
  if (x > 0) canvas.push({ type: 'rect', x: 0, y: 1, w: x, h: 8, lineColor: NEUTRAL, lineWidth: 0.5 });
  return { canvas };
}

/** Side margin of the pages of the report, and the width left between the two on an A4 sheet (595.28 pt wide). */
const PAGE_MARGIN = 36;
const CONTENT_WIDTH = 595.28 - 2 * PAGE_MARGIN;
/** pdfmake leaves 4 pt at each side of a cell. */
const CELL_PADDING = 8;

/**
 * The width of the first column of a breakdown, the one with the names: what the other columns
 * leave of the page. A number and not "*": pdfmake never makes a "*" column narrower than its
 * longest word, so one long name without spaces (an e-mail address, a web address) pushed the
 * counts and the bars off the page. In a column of a set width the word goes on in the next line.
 */
function nameWidth(others: number[]): number {
  const taken = others.reduce((sum, width) => sum + width, 0) + CELL_PADDING * (others.length + 1);
  return Math.floor(CONTENT_WIDTH - taken);
}

/** A count in its column, in the colour of what it counts when it has one. */
const count = (value: number, color?: string): TableCell => ({ text: String(value), alignment: 'right', color, bold: color !== undefined });

/**
 * One breakdown of the report: a table with a title and a bar per row. The title is part of the
 * header of the table, so it is never left alone at the foot of a page and it is repeated when the
 * table goes on to the next one.
 */
function breakdown(title: string, headers: string[], widths: (number | string)[], rows: TableCell[][]): Content {
  const headerCell = (text: string, index: number): TableCell => ({
    text,
    ...PDF_HEADER_CELL,
    alignment: index > 0 && index < headers.length - 1 ? 'right' : 'left',
  });
  return {
    margin: [0, 14, 0, 0],
    table: {
      headerRows: 2,
      keepWithHeaderRows: 1,
      widths,
      body: [[{ text: title, colSpan: headers.length, bold: true, fontSize: 11, margin: [0, 0, 0, 2] }, ...headers.slice(1).map(() => ({}))], headers.map(headerCell), ...rows],
    },
    layout: {
      hLineWidth: (index: number) => (index > 1 ? 0.5 : 0),
      vLineWidth: () => 0,
      hLineColor: () => PDF_COLOR.rule,
      paddingTop: () => 4,
      paddingBottom: () => 4,
    },
  };
}

/** A breakdown by status: how many cases of each, the total, and a bar with a stretch per status. */
function statusBreakdown(title: string, first: string, counts: StatusCount[], more: string | null): Content {
  const barWidth = 150;
  const max = Math.max(...counts.map((c) => c.total), 0);
  const rows = counts.map((c): TableCell[] => [
    pdfSafe(c.name),
    count(c.unresolved, PDF_STATUS_COLOR.UNRESOLVED),
    count(c.pending, PDF_STATUS_COLOR.PENDING),
    count(c.resolved, PDF_STATUS_COLOR.RESOLVED),
    count(c.total),
    bar(
      [
        { value: c.resolved, color: PDF_STATUS_COLOR.RESOLVED },
        { value: c.pending, color: PDF_STATUS_COLOR.PENDING },
        { value: c.unresolved, color: PDF_STATUS_COLOR.UNRESOLVED },
      ],
      max,
      barWidth,
    ),
  ]);
  if (more) rows.push([{ text: more, colSpan: 6, italics: true, color: PDF_COLOR.muted }, {}, {}, {}, {}, {}]);
  const others = [50, 50, 50, 34, barWidth];
  return breakdown(title, [first, 'Sin resolver', 'Pendientes', 'Resueltos', 'Total', ''], [nameWidth(others), ...others], rows);
}

/** A breakdown that only counts cases, with a bar per row in the colour of the row. */
function countBreakdown(title: string, first: string, counts: { name: string; total: number; color?: string | null }[]): Content {
  const barWidth = 230;
  const max = Math.max(...counts.map((c) => c.total), 0);
  const rows = counts.map((c): TableCell[] => [pdfSafe(c.name), count(c.total), bar([{ value: c.total, color: c.color ?? PDF_COLOR.primary }], max, barWidth)]);
  const others = [40, barWidth];
  return breakdown(title, [first, 'Casos', ''], [nameWidth(others), ...others], rows);
}

/**
 * The report of the dashboard as a document to read or print: the indicators of the screen and
 * each breakdown as a table with bars. `summary` holds the numbers of the cases it is about.
 */
export function reportPdf(summary: Summary, options: ReportOptions): TDocumentDefinitions {
  const { totals } = summary;
  const hours = summary.avgResolutionHours;
  const indicator = (label: string, value: string, hint = ''): TableCell => ({
    stack: [
      { text: label, fontSize: 8, color: PDF_COLOR.muted },
      { text: value, fontSize: 16, bold: true, margin: [0, 2, 0, 1] },
      { text: hint, fontSize: 7, color: PDF_COLOR.muted },
    ],
    fillColor: '#f3f6fb',
    margin: [4, 3, 4, 3],
  });
  // The same eight numbers as the screen, worded the same way.
  const indicators: TableCell[] = [
    indicator('Total', String(totals.total)),
    indicator('Sin resolver', String(totals.unresolved)),
    indicator('Pendientes', String(totals.pending)),
    indicator('Resueltos', String(totals.resolved), totals.total ? `${Math.round((totals.resolved / totals.total) * 100)}% del total` : ''),
    indicator('Vencidos', String(totals.overdue), 'abiertos fuera de plazo'),
    indicator('Tiempo de resolución', hours === null ? '-' : hours >= 48 ? `${Math.round(hours / 24)} d` : `${hours} h`, 'promedio, casos resueltos en la app'),
    indicator('Cumplimiento SLA', summary.slaCompliance === null ? '-' : `${summary.slaCompliance}%`, 'casos con prioridad'),
    indicator(
      'Estimado vs real',
      summary.estimatedMinutes ? `${Math.round((summary.spentMinutes / summary.estimatedMinutes) * 100)}%` : '-',
      summary.estimatedMinutes ? `${minutesText(summary.spentMinutes)} de ${minutesText(summary.estimatedMinutes)}` : 'sin estimaciones',
    ),
  ];

  const companies = summary.byCompany.slice(0, PDF_COMPANIES);
  const left = summary.byCompany.slice(PDF_COMPANIES);
  const leftCases = left.reduce((sum, company) => sum + company.total, 0);
  const moreCompanies = left.length
    ? `y ${left.length} ${left.length === 1 ? 'empresa' : 'empresas'} más, con ${leftCases} ${leftCases === 1 ? 'caso' : 'casos'}`
    : null;
  const monthBar = 200;
  const monthMax = Math.max(...summary.monthly.map((m) => m.total), 0);

  const breakdowns: Content[] = [
    breakdown(
      'Casos por mes',
      ['Mes', 'Total', 'Resueltos', 'Abiertos', ''],
      ['*', 40, 50, 50, monthBar],
      summary.monthly.map((m): TableCell[] => [
        monthText(m.month),
        count(m.total),
        count(m.resolved, PDF_STATUS_COLOR.RESOLVED),
        count(m.open, PDF_STATUS_COLOR.PENDING),
        bar(
          [
            { value: m.resolved, color: PDF_STATUS_COLOR.RESOLVED },
            { value: m.open, color: PDF_STATUS_COLOR.PENDING },
          ],
          monthMax,
          monthBar,
        ),
      ]),
    ),
    statusBreakdown('Casos por responsable', 'Responsable', summary.byAssignee, null),
    statusBreakdown(left.length ? `Las ${PDF_COMPANIES} empresas con más casos` : 'Casos por empresa', 'Empresa', companies, moreCompanies),
    countBreakdown('Casos por módulo', 'Módulo', [
      ...summary.byModule,
      ...(summary.withoutModule ? [{ name: NO_MODULE, total: summary.withoutModule, color: NEUTRAL }] : []),
    ]),
    countBreakdown(
      'Casos por prioridad',
      'Prioridad',
      summary.byPriority.map((p) => ({ name: priorityName(p.priority), total: p.total, color: p.priority ? PDF_COLOR.primary : NEUTRAL })),
    ),
    countBreakdown(
      'Casos por tipo de soporte',
      'Tipo de soporte',
      summary.bySupportType.map((type) => ({ ...type, color: type.color ?? NEUTRAL })),
    ),
    { text: 'Un caso con varios tipos de soporte cuenta en cada uno.', fontSize: 7, color: PDF_COLOR.muted, margin: [0, 3, 0, 0] },
  ];

  const nothing: Content = { text: 'No hay casos en este periodo.', color: PDF_COLOR.muted, margin: [0, 16, 0, 0] };

  return {
    pageSize: 'A4',
    pageMargins: [PAGE_MARGIN, 56, PAGE_MARGIN, 40],
    ...pdfFrame('Reporte de soporte', formatMomentEs(options.now), PAGE_MARGIN),
    content: [
      {
        text: `Periodo: ${periodText(options)}   ·   ${options.includeArchived ? 'Incluye los casos archivados' : 'Sin los casos archivados'}`,
        color: PDF_COLOR.muted,
        margin: [0, 0, 0, 8],
      },
      {
        table: { widths: ['*', '*', '*', '*'], body: [indicators.slice(0, 4), indicators.slice(4)] },
        layout: { hLineWidth: () => 4, vLineWidth: () => 4, hLineColor: () => '#ffffff', vLineColor: () => '#ffffff' },
      },
      ...(totals.total ? breakdowns : [nothing]),
    ],
  };
}
