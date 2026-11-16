import ExcelJS from 'exceljs';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';
import { renderPdf } from '../common/pdf';
import { day } from '../common/testing';
import { toTimeOnly } from '../transfer/sheet-reading';
import { DATA_TABLE, PDF_COMPANIES, bar, buildReportWorkbook, periodText, reportPdf, summarize } from './dashboard.report';
import type { ReportOptions, ReportRow } from './dashboard.report';

/** The moment the reports of these tests are generated: 12 November 2026, at noon on the server clock. */
const now = new Date(2026, 10, 12, 12, 0);
const hoursAfter = (moment: Date, hours: number): Date => new Date(moment.getTime() + hours * 3_600_000);

const TRAINING = { supportType: { name: 'Capacitación', color: '#0c7beb' } };
const FAILURE = { supportType: { name: 'Falla del sistema', color: '#e5484d' } };

/** A case as the report loads it: pending, of ACME, with nothing else set. */
const ticket = (changes: Partial<ReportRow> = {}): ReportRow => ({
  id: 7,
  date: day('2026-11-02'),
  time: null,
  description: 'No abre la factura',
  status: 'PENDING',
  priority: null,
  createdAt: new Date(2026, 10, 2, 9, 0),
  resolvedAt: null,
  dueAt: null,
  promisedDate: null,
  archivedAt: null,
  estimatedMinutes: null,
  spentMinutes: 0,
  company: { name: 'ACME' },
  assignee: null,
  module: null,
  supportTypes: [],
  createdBy: null,
  ...changes,
});
const cases = (count: number, changes: Partial<ReportRow> = {}): ReportRow[] => Array.from({ length: count }, () => ticket(changes));

describe('summarize', () => {
  it('counts the cases by status, and as overdue the open ones past their deadline', () => {
    const rows = [
      ticket(),
      ticket({ dueAt: hoursAfter(now, -1) }),
      ticket({ status: 'UNRESOLVED', dueAt: hoursAfter(now, 1) }),
      // Resolved late is a deadline missed, not a case that is overdue today.
      ticket({ status: 'RESOLVED', dueAt: hoursAfter(now, -48), resolvedAt: hoursAfter(now, -24) }),
    ];

    expect(summarize(rows, now).totals).toEqual({ total: 4, unresolved: 1, pending: 2, resolved: 1, overdue: 1 });
  });

  it('averages the time to resolve the cases resolved in the app, and leaves out the history that was imported resolved', () => {
    const createdAt = new Date(2026, 10, 2, 9, 0);
    const resolved = (hours: number | null): ReportRow => ticket({ status: 'RESOLVED', createdAt, resolvedAt: hours === null ? null : hoursAfter(createdAt, hours) });

    expect(summarize([resolved(3), resolved(6), resolved(null), ticket()], now).avgResolutionHours).toBe(4.5);
    expect(summarize([resolved(null), ticket()], now).avgResolutionHours).toBeNull();
  });

  it('measures the SLA over the cases with a deadline: resolved in time against resolved late or overdue', () => {
    const due = hoursAfter(now, -10);
    const rows = [
      ticket({ status: 'RESOLVED', dueAt: due, resolvedAt: hoursAfter(due, -1) }),
      ticket({ status: 'RESOLVED', dueAt: due, resolvedAt: hoursAfter(due, 1) }),
      ticket({ dueAt: due }),
      // Still in time, and without a deadline: neither counts yet.
      ticket({ dueAt: hoursAfter(now, 10) }),
      ticket(),
    ];

    expect(summarize(rows, now).slaCompliance).toBe(33);
    expect(summarize([ticket()], now).slaCompliance).toBeNull();
  });

  it('adds up the estimated and the real time of the cases that have an estimate', () => {
    const rows = [ticket({ estimatedMinutes: 60, spentMinutes: 45 }), ticket({ estimatedMinutes: 30, spentMinutes: 50 }), ticket({ spentMinutes: 500 })];

    expect(summarize(rows, now)).toMatchObject({ estimatedMinutes: 90, spentMinutes: 95 });
  });

  it('counts every company and every responsible by status, most cases first and then by name', () => {
    const rows = [
      ...cases(2, { company: { name: 'Zeta' }, assignee: { name: 'Ana Torres' } }),
      ...cases(1, { company: { name: 'Zeta' }, status: 'RESOLVED' }),
      ...cases(2, { company: { name: 'Corporación Ñandú' }, status: 'UNRESOLVED', assignee: { name: 'José Pérez' } }),
      ...cases(2, { company: { name: 'Beta' }, assignee: { name: 'José Pérez' } }),
    ];

    const { byCompany, byAssignee } = summarize(rows, now);

    expect(byCompany).toEqual([
      { name: 'Zeta', unresolved: 0, pending: 2, resolved: 1, total: 3 },
      { name: 'Beta', unresolved: 0, pending: 2, resolved: 0, total: 2 },
      { name: 'Corporación Ñandú', unresolved: 2, pending: 0, resolved: 0, total: 2 },
    ]);
    expect(byAssignee).toEqual([
      { name: 'José Pérez', unresolved: 2, pending: 2, resolved: 0, total: 4 },
      { name: 'Ana Torres', unresolved: 0, pending: 2, resolved: 0, total: 2 },
      { name: 'Sin asignar', unresolved: 0, pending: 0, resolved: 1, total: 1 },
    ]);
  });

  it('counts a case with two support types in both, and the cases without one last, as "Sin tipo"', () => {
    const rows = [...cases(3), ticket({ supportTypes: [TRAINING, FAILURE] }), ticket({ supportTypes: [FAILURE] })];

    expect(summarize(rows, now).bySupportType).toEqual([
      { name: 'Falla del sistema', color: '#e5484d', total: 2 },
      { name: 'Capacitación', color: '#0c7beb', total: 1 },
      { name: 'Sin tipo', color: null, total: 3 },
    ]);
    // Nothing to say about the cases without a type when every case has one.
    expect(summarize([ticket({ supportTypes: [TRAINING] })], now).bySupportType).toEqual([{ name: 'Capacitación', color: '#0c7beb', total: 1 }]);
  });

  it('counts each module under its full name, and apart the cases that have none', () => {
    const rows = [
      ...cases(1, { module: { name: 'Reportes', parent: null } }),
      ...cases(3, { module: { name: 'Reportes', parent: { name: 'Ventas' } } }),
      ...cases(5, { module: { name: 'Reportes', parent: { name: 'Compras' } } }),
      ...cases(2),
    ];

    expect(summarize(rows, now)).toMatchObject({
      byModule: [
        { name: 'Compras > Reportes', total: 5 },
        { name: 'Ventas > Reportes', total: 3 },
        { name: 'Reportes', total: 1 },
      ],
      withoutModule: 2,
    });
  });

  it('counts the priorities from the lowest to the highest, and last the cases without one', () => {
    const rows = [...cases(2), ...cases(1, { priority: 'CRITICAL' }), ...cases(3, { priority: 'LOW' })];

    expect(summarize(rows, now).byPriority).toEqual([
      { priority: 'LOW', total: 3 },
      { priority: 'CRITICAL', total: 1 },
      { priority: null, total: 2 },
    ]);
  });

  it('counts every month by the date of the case, from the oldest', () => {
    const rows = [ticket({ date: day('2026-11-30') }), ticket({ date: day('2026-11-01'), status: 'RESOLVED' }), ticket({ date: day('2025-01-15') }), ticket({ date: day('2026-02-01') })];

    expect(summarize(rows, now).monthly).toEqual([
      { month: '2025-01', total: 1, resolved: 0, open: 1 },
      { month: '2026-02', total: 1, resolved: 0, open: 1 },
      { month: '2026-11', total: 2, resolved: 1, open: 1 },
    ]);
  });
});

describe('periodText', () => {
  it('words the range of dates of a report, whichever of its ends are given', () => {
    expect(periodText({ from: '2026-09-01', to: '2026-09-30' })).toBe('Del 01/09/2026 al 30/09/2026');
    expect(periodText({ from: '2026-09-01' })).toBe('Desde el 01/09/2026');
    expect(periodText({ to: '2026-09-30' })).toBe('Hasta el 30/09/2026');
    expect(periodText({})).toBe('Todas las fechas');
  });
});

const options: ReportOptions = { from: '2026-01-01', to: '2026-11-30', includeArchived: true, now };

describe('report spreadsheet', () => {
  /** The workbook as a person opens it: written to a file and read back. */
  const written = async (rows: ReportRow[], asked: ReportOptions = options): Promise<ExcelJS.Workbook> => {
    const file = await buildReportWorkbook(rows, asked).xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file);
    return workbook;
  };
  /** The rows of a sheet from the first one, each from its first column. An empty row or cell is `undefined`. */
  const table = (workbook: ExcelJS.Workbook, sheet: string): unknown[][] =>
    // ExcelJS counts rows and columns from 1, and leaves holes where there is nothing.
    Array.from(workbook.getWorksheet(sheet)?.getSheetValues() as unknown[][], (row) => Array.from(row ?? []).slice(1)).slice(1);
  interface StoredTable {
    tableRef: string;
    headerRow: boolean;
    columns: { name: string; filterButton: boolean }[];
  }
  /** The Excel table of the "Datos" sheet, as the file describes it. */
  const dataTable = (workbook: ExcelJS.Workbook): StoredTable | undefined =>
    (workbook.getWorksheet('Datos')?.getTable(DATA_TABLE) as unknown as { table: StoredTable } | undefined)?.table;

  const sample = [
    ticket({
      id: 1,
      time: '14:35',
      status: 'RESOLVED',
      priority: 'HIGH',
      createdAt: new Date(2026, 10, 2, 9, 0),
      resolvedAt: new Date(2026, 10, 2, 11, 30),
      dueAt: new Date(2026, 10, 2, 17, 0),
      promisedDate: day('2026-11-05'),
      archivedAt: new Date(2026, 10, 10, 8, 0),
      estimatedMinutes: 60,
      spentMinutes: 45,
      assignee: { name: 'Ana Torres' },
      module: { name: 'Facturas', parent: { name: 'Ventas' } },
      supportTypes: [FAILURE, TRAINING],
      createdBy: { name: 'José Pérez' },
    }),
    ticket({ id: 2, date: day('2026-10-20'), company: { name: 'Corporación Ñandú' }, priority: 'CRITICAL', dueAt: hoursAfter(now, -5), supportTypes: [TRAINING] }),
    ticket({ id: 3, date: day('2026-10-21'), status: 'UNRESOLVED', description: 'Pide un reporte' }),
  ];

  it('has the summary, one sheet per breakdown, and the cases last', async () => {
    const workbook = await written(sample);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      'Resumen',
      'Por mes',
      'Por responsable',
      'Por empresa',
      'Por módulo',
      'Por prioridad',
      'Por tipo de soporte',
      'Datos',
    ]);
  });

  it('says in the summary what it covers and when it was made, with the indicators of the screen', async () => {
    const summary = table(await written(sample), 'Resumen');

    expect(summary[0]).toEqual(['Reporte de soporte']);
    expect(summary[1]).toEqual(['Periodo', 'Del 01/01/2026 al 30/11/2026']);
    expect(summary[2]).toEqual(['Casos archivados', 'Incluidos']);
    // A real moment, shown on the clock of the server: Excel has no time zones.
    expect(summary[3]).toEqual(['Generado el', new Date(Date.UTC(2026, 10, 12, 12, 0))]);
    const indicators = new Map(summary.slice(6).map(([name, value]) => [name, value]));
    expect(Object.fromEntries(indicators)).toEqual({
      'Total de casos': 3,
      'Sin resolver': 1,
      Pendientes: 1,
      Resueltos: 1,
      Vencidos: 1,
      'Tiempo de resolución (horas)': 2.5,
      'Cumplimiento SLA (%)': 50,
      'Tiempo estimado (minutos)': 60,
      'Tiempo real (minutos)': 45,
    });
  });

  it('says in the summary when the archived cases were left out, and leaves empty what cannot be measured', async () => {
    const summary = table(await written([ticket()], { includeArchived: false, now }), 'Resumen');

    expect(summary[1]).toEqual(['Periodo', 'Todas las fechas']);
    expect(summary[2]).toEqual(['Casos archivados', 'No incluidos']);
    const value = (name: string): unknown => summary.find(([label]) => label === name)?.[1];
    expect(value('Total de casos')).toBe(1);
    expect(value('Tiempo de resolución (horas)')).toBeUndefined();
    expect(value('Cumplimiento SLA (%)')).toBeUndefined();
  });

  it('breaks the cases down by month, responsible, module, priority and support type', async () => {
    const workbook = await written(sample);

    expect(table(workbook, 'Por mes')).toEqual([
      ['Mes', 'Total', 'Resueltos', 'Abiertos'],
      ['2026-10', 2, 0, 2],
      ['2026-11', 1, 1, 0],
    ]);
    expect(table(workbook, 'Por responsable')).toEqual([
      ['Responsable', 'Sin resolver', 'Pendientes', 'Resueltos', 'Total'],
      ['Sin asignar', 1, 1, 0, 2],
      ['Ana Torres', 0, 0, 1, 1],
    ]);
    // With the cases that have no module, so that the sheet adds up to the total.
    expect(table(workbook, 'Por módulo')).toEqual([
      ['Módulo', 'Casos'],
      ['Ventas > Facturas', 1],
      ['Sin módulo', 2],
    ]);
    expect(table(workbook, 'Por prioridad')).toEqual([
      ['Prioridad', 'Casos'],
      ['Alta', 1],
      ['Crítica', 1],
      ['Sin prioridad', 1],
    ]);
    expect(table(workbook, 'Por tipo de soporte')).toEqual([
      ['Tipo de soporte', 'Casos'],
      ['Capacitación', 2],
      ['Falla del sistema', 1],
      ['Sin tipo', 1],
    ]);
  });

  // The screen draws the ten with most cases. The file is for analysis: nothing is cut off.
  it('lists every company with its cases by status, not only the ones with most cases', async () => {
    const rows = Array.from({ length: 25 }, (_, index) => cases(index + 1, { company: { name: `Empresa ${String(index + 1).padStart(2, '0')}` }, status: index % 2 ? 'RESOLVED' : 'PENDING' })).flat();

    const companies = table(await written(rows), 'Por empresa');

    expect(companies[0]).toEqual(['Empresa', 'Sin resolver', 'Pendientes', 'Resueltos', 'Total']);
    expect(companies).toHaveLength(26);
    expect(companies[1]).toEqual(['Empresa 25', 0, 25, 0, 25]);
    expect(companies[2]).toEqual(['Empresa 24', 0, 0, 24, 24]);
    expect(companies[25]).toEqual(['Empresa 01', 0, 1, 0, 1]);
  });

  describe('the "Datos" sheet', () => {
    const HEADERS = [
      'Código',
      'Fecha del caso',
      'Hora',
      'Mes',
      'Fecha de registro',
      'Empresa',
      'Descripción',
      'Estado',
      'Responsable',
      'Prioridad',
      'Módulo',
      'Tipos de soporte',
      'Minutos estimados',
      'Minutos reales',
      'Fecha límite',
      'Vencido',
      'Promesa de entrega',
      'Resuelto el',
      'Horas hasta resolver',
      'Archivado',
      'Registrado por',
    ];

    // A table is what a pivot table or Power BI is pointed at: it knows its own columns and where it ends.
    it('is an Excel table over every case, with a filter on each column and its header always in sight', async () => {
      const workbook = await written(sample);
      const data = workbook.getWorksheet('Datos');

      expect(dataTable(workbook)).toMatchObject({ tableRef: 'A1:U4', headerRow: true });
      expect(dataTable(workbook)?.columns.map((column) => column.name)).toEqual(HEADERS);
      expect(dataTable(workbook)?.columns.every((column) => column.filterButton)).toBe(true);
      expect(table(workbook, 'Datos')[0]).toEqual(HEADERS);
      expect(data?.views).toMatchObject([{ state: 'frozen', ySplit: 1 }]);
    });

    it('has one row per case, each value in a cell of its own kind', async () => {
      const [, first, second, third] = table(await written(sample), 'Datos');
      const cell = (row: unknown[], header: string): unknown => row[HEADERS.indexOf(header)];

      expect(first.slice(0, 2)).toEqual(['SOP-00001', day('2026-11-02')]);
      // A time cell, read here the way the import reads one.
      expect(toTimeOnly(cell(first, 'Hora'))).toBe('14:35');
      expect(cell(first, 'Mes')).toBe('2026-11');
      // Moments are shown on the clock of the server.
      expect(cell(first, 'Fecha de registro')).toEqual(new Date(Date.UTC(2026, 10, 2, 9, 0)));
      expect(first.slice(5, 14)).toEqual(['ACME', 'No abre la factura', 'Resuelto', 'Ana Torres', 'Alta', 'Ventas > Facturas', 'Capacitación, Falla del sistema', 60, 45]);
      expect(cell(first, 'Fecha límite')).toEqual(new Date(Date.UTC(2026, 10, 2, 17, 0)));
      expect(cell(first, 'Vencido')).toBe('No');
      expect(cell(first, 'Promesa de entrega')).toEqual(day('2026-11-05'));
      expect(cell(first, 'Resuelto el')).toEqual(new Date(Date.UTC(2026, 10, 2, 11, 30)));
      expect(cell(first, 'Horas hasta resolver')).toBe(2.5);
      expect(cell(first, 'Archivado')).toBe('Sí');
      expect(cell(first, 'Registrado por')).toBe('José Pérez');

      // An open case past its deadline, and what a case does not have left empty: a blank groups better than a made-up word.
      expect(cell(second, 'Vencido')).toBe('Sí');
      expect(cell(second, 'Archivado')).toBe('No');
      expect(cell(second, 'Empresa')).toBe('Corporación Ñandú');
      for (const header of ['Hora', 'Responsable', 'Módulo', 'Minutos estimados', 'Minutos reales', 'Promesa de entrega', 'Resuelto el', 'Horas hasta resolver', 'Registrado por']) {
        expect(cell(second, header)).toBeUndefined();
      }
      expect(third.slice(0, 1)).toEqual(['SOP-00003']);
      expect(cell(third, 'Tipos de soporte')).toBeUndefined();
      expect(cell(third, 'Prioridad')).toBeUndefined();
    });

    it('shows its dates as dates and its times as times', async () => {
      const data = (await written(sample)).getWorksheet('Datos');
      const format = (header: string): string | undefined => data?.getCell(2, HEADERS.indexOf(header) + 1).numFmt;

      expect(format('Fecha del caso')).toBe('dd/mm/yyyy');
      expect(format('Hora')).toBe('hh:mm');
      expect(format('Fecha de registro')).toBe('dd/mm/yyyy hh:mm');
      expect(format('Promesa de entrega')).toBe('dd/mm/yyyy');
    });

    // Excel reports as damaged a file with a table that has no rows.
    it('is only its header when there are no cases', async () => {
      const workbook = await written([]);

      expect(dataTable(workbook)).toBeUndefined();
      expect(table(workbook, 'Datos')).toEqual([HEADERS]);
      expect(table(workbook, 'Por empresa')).toEqual([['Empresa', 'Sin resolver', 'Pendientes', 'Resueltos', 'Total']]);
    });
  });
});

describe('report PDF', () => {
  type Node = Record<string, unknown>;
  /** Every text of a pdfmake document, in the order it is read. */
  const texts = (node: unknown): string[] => {
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.flatMap(texts);
    if (!node || typeof node !== 'object') return [];
    const part = node as Node;
    return [part.text, part.stack, part.columns, part.content, (part.table as Node | undefined)?.body].flatMap(texts);
  };
  /** The tables of a document, each as its rows. The first one holds the indicators. */
  const tables = (document: TDocumentDefinitions): unknown[][][] =>
    (document.content as unknown as Node[]).flatMap((part) => (part.table ? [(part.table as { body: unknown[][] }).body] : []));
  /** The rows of the table of a breakdown, found by its title, under its two rows of header. */
  const rowsOf = (document: TDocumentDefinitions, title: string): unknown[][] => {
    const body = tables(document).find((rows) => texts(rows[0])[0] === title);
    if (!body) throw new Error(`No breakdown titled "${title}"`);
    return body.slice(2);
  };
  type Rect = { x: number; w: number; color?: string; lineColor?: string; lineWidth?: number };
  /** What is drawn in the last cell of a row, where its bar goes. */
  const drawn = (row: unknown[]): Rect[] => (row.at(-1) as { canvas?: Rect[] }).canvas ?? [];
  /** The stretches of the bar of a row: what is painted, without the line around the whole of it. */
  const stretches = (row: unknown[]): Rect[] => drawn(row).filter((rect) => rect.color !== undefined);
  /** The rows of the breakdown with this title: its cells as text, and the length of its bar. */
  const breakdown = (document: TDocumentDefinitions, title: string): { cells: string[]; bar: number }[] =>
    rowsOf(document, title).map((row) => ({
      cells: texts(row),
      bar: stretches(row).reduce((sum, rect) => sum + rect.w, 0),
    }));
  const document = (rows: ReportRow[], asked: ReportOptions = options): TDocumentDefinitions => reportPdf(summarize(rows, now), asked);

  it('is headed by what it covers, and by the indicators of the screen', () => {
    const createdAt = new Date(2026, 10, 2, 9, 0);
    const rows = [
      ticket({ status: 'RESOLVED', createdAt, resolvedAt: hoursAfter(createdAt, 3), dueAt: hoursAfter(createdAt, 8), estimatedMinutes: 120, spentMinutes: 90 }),
      ticket({ dueAt: hoursAfter(now, -1) }),
      ticket({ status: 'UNRESOLVED' }),
      ticket(),
    ];

    const all = texts(document(rows));

    expect(texts(document(rows).header)).toEqual(['Reporte de soporte', 'Generado el 12/11/2026']);
    expect(all[0]).toBe('Periodo: Del 01/01/2026 al 30/11/2026   ·   Incluye los casos archivados');
    const indicator = (label: string): string[] => all.slice(all.indexOf(label) + 1, all.indexOf(label) + 3);
    expect(indicator('Total')).toEqual(['4', '']);
    expect(indicator('Sin resolver')).toEqual(['1', '']);
    expect(indicator('Pendientes')).toEqual(['2', '']);
    expect(indicator('Resueltos')).toEqual(['1', '25% del total']);
    expect(indicator('Vencidos')).toEqual(['1', 'abiertos fuera de plazo']);
    expect(indicator('Tiempo de resolución')).toEqual(['3 h', 'promedio, casos resueltos en la app']);
    expect(indicator('Cumplimiento SLA')).toEqual(['50%', 'casos con prioridad']);
    expect(indicator('Estimado vs real')).toEqual(['75%', '1 h 30 min de 2 h']);
  });

  it('says so when the archived cases were left out, and when there is nothing to measure', () => {
    const all = texts(document([ticket()], { includeArchived: false, now }));

    expect(all[0]).toBe('Periodo: Todas las fechas   ·   Sin los casos archivados');
    expect(all.slice(all.indexOf('Tiempo de resolución') + 1, all.indexOf('Tiempo de resolución') + 2)).toEqual(['-']);
    expect(all.slice(all.indexOf('Estimado vs real') + 1, all.indexOf('Estimado vs real') + 3)).toEqual(['-', 'sin estimaciones']);
  });

  it('gives each breakdown as a table, with the numbers of the summary', () => {
    const rows = [
      ticket({ status: 'RESOLVED', assignee: { name: 'Ana Torres' }, module: { name: 'Facturas', parent: { name: 'Ventas' } }, priority: 'HIGH', supportTypes: [TRAINING, FAILURE] }),
      ticket({ date: day('2026-10-20'), company: { name: 'Corporación Ñandú' }, supportTypes: [TRAINING] }),
      ticket({ date: day('2026-10-21'), status: 'UNRESOLVED' }),
    ];
    const built = document(rows);
    const cells = (title: string): string[][] => breakdown(built, title).map((row) => row.cells);

    expect(cells('Casos por mes')).toEqual([
      ['oct 2026', '2', '0', '2'],
      ['nov 2026', '1', '1', '0'],
    ]);
    expect(cells('Casos por responsable')).toEqual([
      ['Sin asignar', '1', '1', '0', '2'],
      ['Ana Torres', '0', '0', '1', '1'],
    ]);
    expect(cells('Casos por empresa')).toEqual([
      ['ACME', '1', '0', '1', '2'],
      ['Corporación Ñandú', '0', '1', '0', '1'],
    ]);
    expect(cells('Casos por módulo')).toEqual([
      ['Ventas > Facturas', '1'],
      ['Sin módulo', '2'],
    ]);
    expect(cells('Casos por prioridad')).toEqual([
      ['Alta', '1'],
      ['Sin prioridad', '2'],
    ]);
    expect(cells('Casos por tipo de soporte')).toEqual([
      ['Capacitación', '2'],
      ['Falla del sistema', '1'],
      ['Sin tipo', '1'],
    ]);
  });

  it('draws next to each row a bar as long as its cases are of the longest row', () => {
    const rows = [...cases(8, { module: { name: 'Ventas', parent: null } }), ...cases(4, { module: { name: 'Compras', parent: null } }), ...cases(2, { module: { name: 'Bodega', parent: null } })];

    const [first, second, third] = breakdown(document(rows), 'Casos por módulo');

    expect(first.cells).toEqual(['Ventas', '8']);
    expect(first.bar).toBeGreaterThan(100);
    expect(second.bar).toBeCloseTo(first.bar / 2);
    expect(third.bar).toBeCloseTo(first.bar / 4);
  });

  it('splits the bar of a company or a responsible by status, and paints a support type in its colour', () => {
    const rows = [
      ...cases(3, { status: 'RESOLVED', supportTypes: [FAILURE] }),
      ...cases(1, { status: 'UNRESOLVED' }),
      ...cases(2, { company: { name: 'Beta' } }),
    ];
    const built = document(rows);
    const canvas = (title: string, row: number): Rect[] => stretches(rowsOf(built, title)[row]);

    // ACME: three resolved and one unresolved, of four. The bar is whole because no company has more.
    const acme = canvas('Casos por empresa', 0);
    expect(acme.map((stretch) => stretch.color)).toEqual(['#12b76a', '#e5484d']);
    expect(acme[0].w).toBeCloseTo(acme[1].w * 3);
    // Beta has half the cases, all of them pending.
    const beta = canvas('Casos por empresa', 1);
    expect(beta.map((stretch) => stretch.color)).toEqual(['#b97a00']);
    expect(beta[0].w).toBeCloseTo((acme[0].w + acme[1].w) / 2);

    expect(canvas('Casos por tipo de soporte', 0)).toMatchObject([{ color: '#e5484d' }]);
  });

  // A type has the colour its team chose. On the white of the page, a bar in white is not there
  // for whoever reads the report, and its row reads as a type with fewer cases than the next one.
  it('draws a thin line around every bar, so the one of a support type in white is still seen', () => {
    const white = { supportType: { name: 'Consulta', color: '#ffffff' } };
    const built = document([...cases(2, { supportTypes: [white], status: 'RESOLVED' }), ticket({ supportTypes: [FAILURE] })]);

    for (const title of ['Casos por mes', 'Casos por responsable', 'Casos por empresa', 'Casos por prioridad', 'Casos por tipo de soporte']) {
      for (const row of rowsOf(built, title)) {
        const painted = stretches(row);
        const lines = drawn(row).filter((rect) => rect.color === undefined);
        // One line, in a grey that shows on white, from the start of the bar to its end.
        expect(lines).toEqual([{ type: 'rect', x: 0, y: 1, w: painted.reduce((sum, rect) => sum + rect.w, 0), h: 8, lineColor: '#98a2b3', lineWidth: 0.5 }]);
        // Drawn last, over the stretches.
        expect(drawn(row).at(-1)).toBe(lines[0]);
      }
    }
    const [consulta] = rowsOf(built, 'Casos por tipo de soporte');
    expect(texts(consulta)).toEqual(['Consulta', '2']);
    expect(stretches(consulta)).toMatchObject([{ color: '#ffffff' }]);
  });

  describe('bar', () => {
    it('is as long as its parts are of the longest, one stretch after another with a line around them all, and nothing for no cases', () => {
      expect(bar([{ value: 5, color: '#111111' }], 10, 200)).toEqual({
        canvas: [
          { type: 'rect', x: 0, y: 1, w: 100, h: 8, color: '#111111' },
          { type: 'rect', x: 0, y: 1, w: 100, h: 8, lineColor: '#98a2b3', lineWidth: 0.5 },
        ],
      });
      expect(
        bar(
          [
            { value: 5, color: '#111111' },
            { value: 0, color: '#222222' },
            { value: 5, color: '#333333' },
          ],
          10,
          200,
        ),
      ).toEqual({
        canvas: [
          { type: 'rect', x: 0, y: 1, w: 100, h: 8, color: '#111111' },
          { type: 'rect', x: 100, y: 1, w: 100, h: 8, color: '#333333' },
          { type: 'rect', x: 0, y: 1, w: 200, h: 8, lineColor: '#98a2b3', lineWidth: 0.5 },
        ],
      });
      expect(bar([{ value: 0, color: '#111111' }], 0, 200)).toEqual({ canvas: [] });
    });
  });

  // pdfmake never makes a "*" column narrower than its longest word: with one, a name without
  // spaces widened its table past the edge of the sheet, and the counts and the bars went with it.
  it('keeps every table inside the page, whatever the names: a long one without spaces goes on in the next line', async () => {
    // The longest names the catalogs take, without a space to break them at.
    const person = `${'jose.perez.administracion.sistemas'.padEnd(68, '.contabilidad')}@example.com`;
    const rows = [
      ticket({ company: { name: 'x'.repeat(200) }, assignee: { name: person }, module: { name: 'm'.repeat(80), parent: { name: 'p'.repeat(80) } }, supportTypes: [{ supportType: { name: 't'.repeat(60), color: '#0c7beb' } }] }),
      ticket({ assignee: { name: 'Ana Torres' }, supportTypes: [TRAINING] }),
    ];
    expect(person).toHaveLength(80);

    // Uncompressed, the file says in plain text where each rectangle and each line of text is put.
    const file = (await renderPdf({ ...document(rows), compress: false })).toString('latin1');

    const [left, right] = [36, 595.28 - 36];
    const rectangles = [...file.matchAll(/(-?[\d.]+) -?[\d.]+ (-?[\d.]+) -?[\d.]+ re\b/g)].map((found) => ({ from: Number(found[1]), to: Number(found[1]) + Number(found[2]) }));
    const lines = [...file.matchAll(/1 0 0 1 (-?[\d.]+) -?[\d.]+ Tm/g)].map((found) => Number(found[1]));
    // The header cells, the bars and every line of text start and end between the two margins.
    expect(rectangles.length).toBeGreaterThan(20);
    expect(lines.length).toBeGreaterThan(40);
    expect(Math.min(...rectangles.map((rect) => rect.from), ...lines)).toBeGreaterThanOrEqual(left - 0.5);
    expect(Math.max(...rectangles.map((rect) => rect.to))).toBeLessThanOrEqual(right + 0.5);
    expect(Math.max(...lines)).toBeLessThan(right);
    // The name is all there, cut into the lines its column has room for. Each line of text is
    // written in hexadecimal, in pieces with the spacing between them.
    const written = [...file.matchAll(/\[([^\]]*)\] TJ/g)].map((found) => [...found[1].matchAll(/<([0-9a-f]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    const company = written.filter((line) => /^x+$/.test(line));
    expect(company.length).toBeGreaterThan(1);
    expect(company.join('')).toHaveLength(200);
  });

  // A document is to be read: a hundred companies would bury the ones that matter. The spreadsheet has them all.
  it('lists the fifteen companies with most cases, and says how many more there are', () => {
    expect(PDF_COMPANIES).toBe(15);
    const rows = Array.from({ length: 18 }, (_, index) => cases(index + 1, { company: { name: `Empresa ${String(index + 1).padStart(2, '0')}` } })).flat();

    const built = document(rows);
    const companies = breakdown(built, 'Las 15 empresas con más casos');

    expect(companies).toHaveLength(16);
    expect(companies[0].cells.slice(0, 1)).toEqual(['Empresa 18']);
    expect(companies[14].cells.slice(0, 1)).toEqual(['Empresa 04']);
    // The three that are left out have 3, 2 and 1 cases.
    expect(companies[15].cells).toEqual(['y 3 empresas más, con 6 casos']);
  });

  it('lists every company when there are fifteen or fewer', () => {
    const rows = Array.from({ length: 15 }, (_, index) => ticket({ company: { name: `Empresa ${index + 1}` } }));

    const companies = breakdown(document(rows), 'Casos por empresa');

    expect(companies).toHaveLength(15);
    expect(texts(document(rows)).join(' ')).not.toContain('más, con');
  });

  it('counts one company and one case left out in the singular', () => {
    const rows = [...Array.from({ length: 15 }, (_, index) => cases(2, { company: { name: `Empresa ${index + 1}` } })).flat(), ticket({ company: { name: 'Zeta' } })];

    expect(breakdown(document(rows), 'Las 15 empresas con más casos').at(-1)?.cells).toEqual(['y 1 empresa más, con 1 caso']);
  });

  it('says that there are no cases instead of drawing empty tables', () => {
    const built = document([]);

    expect(texts(built)).toContain('No hay casos en este periodo.');
    // Only the indicators, all of them at zero.
    expect(tables(built)).toHaveLength(1);
  });

  it('is drawn as a PDF, with names that Helvetica cannot write and more rows than fit in a page', async () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, index) => ticket({ date: day(`20${String(index + 10)}-01-15`), assignee: { name: `Persona ${index + 1}` }, module: { name: `Módulo ${index + 1}`, parent: null } })),
      ticket({ company: { name: 'Café “El Ñandú” ✓ 東京' }, supportTypes: [{ supportType: { name: 'Consulta → rápida', color: '#64748b' } }] }),
    ];

    const file = await renderPdf(document(rows));

    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    // The breakdowns of thirty months, people and modules do not fit in one page.
    expect(file.toString('latin1').match(/\/Type \/Page\b/g)?.length).toBeGreaterThan(1);
  });
});
