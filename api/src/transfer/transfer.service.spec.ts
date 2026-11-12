import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import PdfPrinter from 'pdfmake';
import type { AuthUser } from '../common/auth';
import { searchKey } from '../common/labels';
import type { PrismaService } from '../prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { TicketsService, parseTicketFilters } from '../tickets/tickets.service';
import type { TicketFilters } from '../tickets/tickets.service';
import {
  PDF_EXPORT_LIMIT,
  TEMPLATE_COLUMNS,
  TEMPLATE_ROWS,
  TransferService,
  XLSX_EXPORT_LIMIT,
  buildTemplate,
  describeFilters,
  excelMoment,
  notesText,
  parseCsv,
  pdfSafe,
  toDateOnly,
  toStatus,
} from './transfer.service';
import type { FilterNames } from './transfer.service';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/**
 * A TransferService over a fake database: an object with only the Prisma calls the test expects.
 * The filters go through the real `buildWhere`, with both reminders off.
 */
function serviceOn(db: object): TransferService {
  const prisma = db as PrismaService;
  const settings: Pick<SettingsService, 'reminderRules'> = {
    reminderRules: () => Promise.resolve({ staleBefore: null, promiseSoonDays: 0 }),
  };
  return new TransferService(prisma, new TicketsService(prisma, settings as SettingsService), settings as SettingsService);
}

describe('spreadsheet import parsing', () => {
  describe('toDateOnly', () => {
    it('reads month/day/year text, the format of the team sheet', () => {
      expect(toDateOnly('7/27/2023', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('1/2/2023', 'mdy')).toBe('2023-01-02');
    });

    it('reads day/month/year text when that order is chosen', () => {
      expect(toDateOnly('1/2/2023', 'dmy')).toBe('2023-02-01');
      expect(toDateOnly('27-07-2023', 'dmy')).toBe('2023-07-27');
    });

    it('treats a number above 12 as the day whatever order is chosen', () => {
      expect(toDateOnly('27/7/2023', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('7/27/2023', 'dmy')).toBe('2023-07-27');
    });

    it('reads date cells, ISO text, two-digit years and Excel serial numbers', () => {
      expect(toDateOnly(new Date(Date.UTC(2023, 6, 27)), 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('2023-07-27', 'dmy')).toBe('2023-07-27');
      expect(toDateOnly('7/27/23', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly(45134, 'mdy')).toBe('2023-07-27');
    });

    it('returns null for empty or impossible dates', () => {
      expect(toDateOnly('', 'mdy')).toBeNull();
      expect(toDateOnly(null, 'mdy')).toBeNull();
      expect(toDateOnly('pendiente', 'mdy')).toBeNull();
      expect(toDateOnly('2/30/2023', 'mdy')).toBeNull();
    });
  });

  describe('toStatus', () => {
    it('maps the labels used in the sheet, including typos', () => {
      expect(toStatus('Resuelto')).toBe('RESOLVED');
      expect(toStatus('RESUELTA')).toBe('RESOLVED');
      expect(toStatus('Sin resover')).toBe('UNRESOLVED');
      expect(toStatus('Sin resolver')).toBe('UNRESOLVED');
      expect(toStatus('Pendiente')).toBe('PENDING');
    });

    it('falls back to pending for empty or unknown values', () => {
      expect(toStatus('')).toBe('PENDING');
      expect(toStatus('en revisión')).toBe('PENDING');
    });
  });

  describe('parseCsv', () => {
    it('handles quotes, embedded delimiters, line breaks and a BOM', () => {
      const csv = '﻿Fecha,Empresa,Descripción\r\n7/27/2023,"ACME, S.A.","Dijo ""no abre""\nsegunda línea"\r\n';
      expect(parseCsv(csv)).toEqual([
        ['Fecha', 'Empresa', 'Descripción'],
        ['7/27/2023', 'ACME, S.A.', 'Dijo "no abre"\nsegunda línea'],
      ]);
    });

    it('detects semicolons, the delimiter Excel uses in Spanish locales', () => {
      expect(parseCsv('Fecha;Empresa\n27/7/2023;ACME')).toEqual([
        ['Fecha', 'Empresa'],
        ['27/7/2023', 'ACME'],
      ]);
    });
  });

  describe('searchKey', () => {
    it('removes accents, case and extra spaces', () => {
      expect(searchKey('  CORPORACIÓN   M&M ')).toBe('corporacion m&m');
      expect(searchKey('Ñandú')).toBe('nandu');
    });
  });
});

describe('spreadsheet import', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
  const people = [{ id: 3, name: 'Ana', username: 'ana' }];
  const csv = (...lines: string[]): { buffer: Buffer; originalname: string } => ({
    buffer: Buffer.from(lines.join('\n'), 'utf8'),
    originalname: 'casos.csv',
  });
  const HEADERS = 'Fecha,Empresa,Descripción,Estado,Responsable,Observación';

  it('stores each row with the day of the case as its last activity and with its search keys', async () => {
    const db = {
      ticket: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
      user: { findMany: jest.fn().mockResolvedValue(people), create: jest.fn() },
    };
    const sheet = csv(HEADERS, '7/27/2023,CORPORACIÓN Ñandú,No abre la Facturación,Pendiente,Ana,Se REINICIÓ el servicio');

    await serviceOn(db).import(sheet, { dryRun: false, dateOrder: 'mdy' }, user);

    const midday = new Date('2023-07-27T12:00:00.000Z');
    expect(db.ticket.create).toHaveBeenCalledTimes(1);
    // Neither `createdAt` nor `updatedAt`: the registration moment is the time of the import.
    expect(db.ticket.create).toHaveBeenCalledWith({
      data: {
        date: day('2023-07-27'),
        company: 'CORPORACIÓN Ñandú',
        description: 'No abre la Facturación',
        searchText: 'corporacion nandu no abre la facturacion',
        status: 'PENDING',
        assigneeId: 3,
        assignedToClient: false,
        createdById: 1,
        lastActivityAt: midday,
        notes: { create: { text: 'Se REINICIÓ el servicio', searchText: 'se reinicio el servicio', createdAt: midday } },
      },
    });
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('creates the people it does not know and leaves a case of the client without a person', async () => {
    const db = {
      ticket: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn().mockResolvedValue({}) },
      user: { findMany: jest.fn().mockResolvedValue(people), create: jest.fn().mockResolvedValue({ id: 9 }) },
    };
    const sheet = csv(HEADERS, '7/27/2023,ACME,No imprime,Resuelto,José Pérez,', '7/28/2023,ACME,No abre,Sin resolver,CLIENTE,');

    const result = await serviceOn(db).import(sheet, { dryRun: false, dateOrder: 'mdy' }, user);

    expect(result.newPeople).toEqual(['José Pérez']);
    expect(db.user.create).toHaveBeenCalledWith({ data: { username: 'jose.perez', name: 'José Pérez' } });
    expect(db.ticket.create.mock.calls).toMatchObject([
      [{ data: { company: 'ACME', description: 'No imprime', assigneeId: 9, assignedToClient: false } }],
      [{ data: { company: 'ACME', description: 'No abre', assigneeId: null, assignedToClient: true } }],
    ]);
  });

  it('previews without writing: repeats the date above, skips rows already stored and incomplete rows', async () => {
    const db = {
      ticket: {
        findMany: jest.fn().mockResolvedValue([{ date: day('2023-07-27'), company: 'Acme', description: 'no ABRE la facturación' }]),
        create: jest.fn(),
      },
      user: { findMany: jest.fn().mockResolvedValue(people), create: jest.fn() },
    };
    const sheet = csv(
      HEADERS,
      '7/27/2023,ACME,No abre la facturación,Pendiente,Ana,',
      ',ACME,No imprime,Resuelto,Luis,Se cambió el cable',
      ',,Sin empresa,Pendiente,,',
      ',ACME,No imprime,Resuelto,Luis,',
    );

    const result = await serviceOn(db).import(sheet, { dryRun: true, dateOrder: 'mdy' }, user);

    expect(result).toMatchObject({ dryRun: true, totalRows: 4, skippedEmpty: 1, duplicates: 2, toCreate: 1, newPeople: ['Luis'] });
    expect(result.sample).toEqual([
      { date: '2023-07-27', company: 'ACME', description: 'No imprime', status: 'RESOLVED', assignee: 'Luis', toClient: false, note: 'Se cambió el cable' },
    ]);
    expect(db.ticket.create).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });
});

// The template is only useful if the import reads it as written: these tests pass the file the
// service produces back through the import, empty and filled in.
describe('import template', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
  const people = [
    { id: 3, name: 'Ana', username: 'ana' },
    { id: 4, name: 'Luis Ñáñez', username: 'luis' },
  ];
  const database = (): { ticket: { findMany: jest.Mock; create: jest.Mock }; user: { findMany: jest.Mock; create: jest.Mock } } => ({
    ticket: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    user: { findMany: jest.fn().mockResolvedValue(people), create: jest.fn() },
  });
  const open = async (file: Buffer): Promise<ExcelJS.Workbook> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    return workbook;
  };
  const asUpload = async (workbook: ExcelJS.Workbook): Promise<{ buffer: Buffer; originalname: string }> => ({
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    originalname: 'plantilla-casos-soporte.xlsx',
  });

  it('has the sheet to fill in first, with one column per field the import reads', async () => {
    const workbook = await open(await serviceOn(database()).template());

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Casos', 'Listas', 'Instrucciones']);
    const headers = (workbook.worksheets[0].getRow(1).values as unknown[]).slice(1);
    expect(headers).toEqual(['Fecha', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Observación']);
    expect(TEMPLATE_COLUMNS.map((column) => column.header)).toEqual(headers);
    expect(TEMPLATE_COLUMNS.filter((column) => column.required).map((column) => column.header)).toEqual(['Empresa', 'Descripción']);
  });

  it('is read by the import as it comes: every column found and no case in it', async () => {
    const db = database();
    const service = serviceOn(db);
    const file = { buffer: await service.template(), originalname: 'plantilla-casos-soporte.xlsx' };

    const result = await service.import(file, { dryRun: true, dateOrder: 'dmy' }, user);

    expect(result.columns).toEqual({
      date: 'Fecha',
      company: 'Empresa',
      description: 'Descripción',
      status: 'Estado',
      assignee: 'Responsable',
      note: 'Observación',
    });
    // The rows that only carry cell checks are not rows of the sheet.
    expect(result).toMatchObject({ totalRows: 0, skippedEmpty: 0, toCreate: 0 });
  });

  it('imports what a person fills in: a date cell, a status and a name from its lists, the client', async () => {
    const db = database();
    const service = serviceOn(db);
    const workbook = await open(await service.template());
    const sheet = workbook.worksheets[0];
    // Day 3 of month 4: read as a date cell it cannot be taken for March 4th, whatever order is chosen.
    sheet.addRow([day('2026-04-03'), 'ACME', 'No imprime', 'Sin resolver', 'Luis Ñáñez', 'Se cambió el cable']);
    sheet.addRow([null, 'ACME', 'No abre', 'Resuelto', 'Cliente', null]);
    sheet.addRow([null, 'Beta', 'Pide una capacitación', null, null, null]);

    const result = await service.import(await asUpload(workbook), { dryRun: true, dateOrder: 'mdy' }, user);

    expect(result).toMatchObject({ totalRows: 3, skippedEmpty: 0, toCreate: 3, newPeople: [] });
    expect(result.sample).toEqual([
      { date: '2026-04-03', company: 'ACME', description: 'No imprime', status: 'UNRESOLVED', assignee: 'Luis Ñáñez', toClient: false, note: 'Se cambió el cable' },
      { date: '2026-04-03', company: 'ACME', description: 'No abre', status: 'RESOLVED', assignee: 'Cliente', toClient: true, note: null },
      { date: '2026-04-03', company: 'Beta', description: 'Pide una capacitación', status: 'PENDING', assignee: null, toClient: false, note: null },
    ]);
  });

  it('checks the cells a person fills in, from the first row to the last one covered', async () => {
    const db = database();
    const workbook = await open(await serviceOn(db).template());
    const [sheet, lists] = workbook.worksheets;

    // The people offered are the active ones.
    expect(db.user.findMany).toHaveBeenCalledWith({ where: { active: true }, orderBy: { name: 'asc' }, select: { name: true } });
    expect((lists.getColumn(1).values as unknown[]).slice(1)).toEqual(['Cliente', 'Ana', 'Luis Ñáñez']);
    expect(lists.state).toBe('hidden');

    for (const row of [2, TEMPLATE_ROWS + 1]) {
      expect(sheet.getCell(`A${row}`).dataValidation).toMatchObject({ type: 'date', operator: 'between', showErrorMessage: true });
      expect(sheet.getCell(`D${row}`).dataValidation).toMatchObject({ type: 'list', formulae: ['"Pendiente,Resuelto,Sin resolver"'], showErrorMessage: true });
      // A name that is not in the list is allowed: the import creates that person.
      const person = sheet.getCell(`E${row}`).dataValidation;
      expect(person).toMatchObject({ type: 'list', formulae: ['Listas!$A$1:$A$3'] });
      expect(person.showErrorMessage).toBeFalsy();
    }
    expect(sheet.getCell(`A${TEMPLATE_ROWS + 2}`).dataValidation).toBeUndefined();
    expect(sheet.getColumn(1).numFmt).toBe('dd/mm/yyyy');
  });

  // Set cell by cell, ExcelJS writes ranges that overlap ("A10:A2001" next to "A2:A2001"), and Excel
  // then reports the file as damaged. Each rule must leave as the one range it covers.
  it('writes each cell rule as one range', () => {
    const sheet = buildTemplate(['Ana']).worksheets[0];
    const rules = (sheet as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model;

    expect(Object.keys(rules).sort()).toEqual([`A2:A${TEMPLATE_ROWS + 1}`, `D2:D${TEMPLATE_ROWS + 1}`, `E2:E${TEMPLATE_ROWS + 1}`]);
  });

  it('words each status the way the import reads it back', () => {
    expect(['Pendiente', 'Resuelto', 'Sin resolver'].map(toStatus)).toEqual(['PENDING', 'RESOLVED', 'UNRESOLVED']);
  });

  it('explains every column on its header and in the instructions sheet', async () => {
    const workbook = await open(await serviceOn(database()).template());
    const [sheet, , guide] = workbook.worksheets;
    const guideText = JSON.stringify(guide.getSheetValues());

    TEMPLATE_COLUMNS.forEach((column, index) => {
      const note = sheet.getRow(1).getCell(index + 1).note;
      expect(typeof note === 'string' ? note : JSON.stringify(note)).toContain(column.required ? 'Obligatoria' : 'Opcional');
      expect(guideText).toContain(column.header);
    });
    expect(guideText).toContain('importar dos veces el mismo archivo no duplica');
  });
});

describe('export', () => {
  afterEach(() => jest.restoreAllMocks());

  /** A case as the export query returns it. */
  const exportRow = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 7,
    date: day('2026-11-02'),
    company: 'ACME',
    description: 'No abre la factura',
    status: 'PENDING',
    assignedToClient: false,
    assignee: { name: 'Ana' },
    priority: 'HIGH',
    module: { name: 'Facturas' },
    estimatedMinutes: 30,
    spentMinutes: 0,
    promisedDate: null,
    dueAt: null,
    resolvedAt: null,
    createdAt: new Date(2026, 10, 2, 9, 0),
    notes: [],
    ...changes,
  });

  describe('describeFilters', () => {
    const names: FilterNames = { assignee: 'Ana Pérez', module: 'Ventas > Facturas' };
    /** Every filter of the list on its own, with the text the PDF header gives it. */
    const alone: [TicketFilters, string][] = [
      [{ status: ['PENDING'] }, 'Estado: Pendiente'],
      [{ status: ['UNRESOLVED', 'RESOLVED'] }, 'Estado: Sin resolver, Resuelto'],
      [{ assignee: 12 }, 'Responsable: Ana Pérez'],
      [{ assignee: 'client' }, 'Responsable: Cliente'],
      [{ assignee: 'none' }, 'Responsable: sin asignar'],
      [{ company: 'ACME' }, 'Empresa: ACME'],
      [{ priority: 'HIGH' }, 'Prioridad: Alta'],
      [{ moduleId: 4 }, 'Módulo: Ventas > Facturas'],
      [{ from: '2026-01-05' }, 'Desde: 05/01/2026'],
      [{ to: '2026-01-31' }, 'Hasta: 31/01/2026'],
      [{ overdue: true }, 'Solo vencidos'],
      [{ stale: true }, 'Solo olvidados'],
      [{ promise: 'any' }, 'Solo con promesa de entrega'],
      [{ promise: 'overdue' }, 'Solo promesa de entrega vencida'],
      [{ promise: 'today' }, 'Solo promesa de entrega para hoy'],
      [{ promise: 'soon' }, 'Solo promesa de entrega próxima'],
      [{ promise: 'due' }, 'Solo promesa de entrega vencida, para hoy o próxima'],
      [{ q: 'factura' }, 'Búsqueda: "factura"'],
    ];

    it.each(alone)('describes %j on its own', (filters, text) => {
      expect(describeFilters(filters, names)).toBe(text);
    });

    it('is tried above with every filter the list reads', () => {
      // The parser answers with one key per parameter it knows. These four order and page the list.
      const notFilters = ['sort', 'dir', 'page', 'pageSize'];
      const filterKeys = Object.keys(parseTicketFilters({})).filter((key) => !notFilters.includes(key));
      const tried = new Set(alone.flatMap(([filters]) => Object.keys(filters)));
      expect([...tried].sort()).toEqual(filterKeys.sort());
    });

    it('joins several filters, always in the same order', () => {
      const filters = parseTicketFilters({
        q: 'factura',
        promise: 'due',
        stale: '1',
        overdue: '1',
        to: '2026-01-31',
        from: '2026-01-05',
        moduleId: '4',
        priority: 'HIGH',
        company: 'ACME',
        assignee: '12',
        status: 'PENDING,UNRESOLVED',
      });
      expect(describeFilters(filters, names)).toBe(
        [
          'Estado: Sin resolver, Pendiente',
          'Responsable: Ana Pérez',
          'Empresa: ACME',
          'Prioridad: Alta',
          'Módulo: Ventas > Facturas',
          'Desde: 05/01/2026',
          'Hasta: 31/01/2026',
          'Solo vencidos',
          'Solo olvidados',
          'Solo promesa de entrega vencida, para hoy o próxima',
          'Búsqueda: "factura"',
        ].join('  ·  '),
      );
      expect(describeFilters({ moduleId: 4, status: ['RESOLVED'] }, names)).toBe('Estado: Resuelto  ·  Módulo: Ventas > Facturas');
    });

    it('is empty when nothing filters', () => {
      expect(describeFilters({}, names)).toBe('');
      expect(describeFilters(parseTicketFilters({}), names)).toBe('');
      expect(describeFilters({ sort: 'company', dir: 'asc', page: 3, pageSize: 25 }, names)).toBe('');
      expect(describeFilters({ status: [], company: '', overdue: false, stale: false, q: '' }, names)).toBe('');
    });

    it('leaves out what the query string sent wrong, as the query does', () => {
      // A wrong day in the range is not among them: the parser refuses it, so it never gets here.
      const wrong = { status: ['a', 'b'], assignee: 'yo', moduleId: 'x', priority: 'URGENT', promise: 'pronto' };
      expect(describeFilters(parseTicketFilters(wrong), names)).toBe('');
      expect(describeFilters(parseTicketFilters({ ...wrong, to: '2026-02-28' }), names)).toBe('Hasta: 28/02/2026');
    });

    it('reads a repeated parameter', () => {
      expect(describeFilters(parseTicketFilters({ status: ['RESOLVED', 'PENDING'], company: ['ACME', 'Otra'] }), names)).toBe(
        'Estado: Pendiente, Resuelto  ·  Empresa: ACME',
      );
    });

    it('says so when the person or the module of the filter does not exist', () => {
      const nothing: FilterNames = { assignee: null, module: null };
      expect(describeFilters({ assignee: 99 }, nothing)).toBe('Responsable: id 99 (no existe)');
      expect(describeFilters({ moduleId: 0 }, nothing)).toBe('Módulo: id 0 (no existe)');
      expect(describeFilters({ assignee: 'client' }, nothing)).toBe('Responsable: Cliente');
    });
  });

  describe('notesText', () => {
    it('gives a single observation as it is, and nothing without observations', () => {
      expect(notesText([])).toBe('');
      expect(notesText([{ text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 11, 23, 30) }])).toBe('Se llamó al cliente');
    });

    it('dates several observations with the day on the server clock', () => {
      // Just after midnight and late at night: the UTC day of one of them is not the 11th in any zone but UTC itself.
      const notes = [
        { text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 11, 0, 30) },
        { text: 'Se reinició el servicio', createdAt: new Date(2026, 10, 11, 23, 30) },
      ];
      expect(notesText(notes)).toBe('11/11/2026: Se llamó al cliente\n11/11/2026: Se reinició el servicio');
    });
  });

  describe('excelMoment', () => {
    it('shifts a moment so that its UTC reading, which is what Excel shows, is the local time', () => {
      expect(excelMoment(new Date(2026, 10, 11, 23, 30))?.toISOString()).toBe('2026-11-11T23:30:00.000Z');
      expect(excelMoment(null)).toBeNull();
    });
  });

  describe('pdfSafe', () => {
    it('keeps Spanish text and line breaks', () => {
      const text = 'Señor Núñez: ¿cómo está la «facturación»?\n¡Lista!';
      expect(pdfSafe(text)).toBe(text);
    });

    it('replaces typographic marks with their plain form and anything else Helvetica lacks with "?"', () => {
      expect(pdfSafe('“Hola” ‘mundo’ – — …')).toBe('"Hola" \'mundo\' - - ...');
      expect(pdfSafe('Listo ✓ → fin')).toBe('Listo ? ? fin');
    });
  });

  describe('pdf', () => {
    /** Watches the real pdfmake and gives the text of each paragraph of the document it was handed. */
    const watchDocument = (): (() => unknown[]) => {
      const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
      return () => {
        const { content } = print.mock.calls[0][0];
        return (Array.isArray(content) ? content : [content]).map((part) => (typeof part === 'object' && 'text' in part ? part.text : null));
      };
    };

    it('refuses more than 5000 cases after counting them, without loading any', async () => {
      expect(PDF_EXPORT_LIMIT).toBe(5000);
      const db = { ticket: { count: jest.fn().mockResolvedValue(5001), findMany: jest.fn() } };

      const refused = serviceOn(db).pdf({ status: ['PENDING'] });

      await expect(refused).rejects.toBeInstanceOf(BadRequestException);
      await expect(refused).rejects.toThrow(
        'La exportación a PDF admite hasta 5000 casos y la selección actual tiene 5001. ' +
          'Acota los filtros (por ejemplo, por fechas, estado o responsable) o exporta a Excel.',
      );
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [{ status: { in: ['PENDING'] } }] } });
      expect(db.ticket.findMany).not.toHaveBeenCalled();
    });

    it('does not offer Excel for a selection that Excel would refuse too', async () => {
      const db = { ticket: { count: jest.fn().mockResolvedValue(20001), findMany: jest.fn() } };

      await expect(serviceOn(db).pdf({})).rejects.toThrow(
        'La exportación a PDF admite hasta 5000 casos y la selección actual tiene 20001. ' +
          'Acota los filtros (por ejemplo, por fechas, estado o responsable).',
      );
    });

    it('builds the document for 5000 cases or fewer, headed by the filters its query ran with', async () => {
      const paragraphs = watchDocument();
      const db = {
        ticket: { count: jest.fn().mockResolvedValue(5000), findMany: jest.fn().mockResolvedValue([exportRow()]) },
        systemModule: { findUnique: jest.fn().mockResolvedValue({ name: 'Facturas', parent: { name: 'Ventas' } }) },
      };

      const file = await serviceOn(db).pdf({ moduleId: 4, dir: 'asc' });

      expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const where = { AND: [{ moduleId: 4 }] };
      expect(db.ticket.count).toHaveBeenCalledWith({ where });
      expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: [{ id: 'asc' }] }));
      expect(paragraphs()).toContain('Filtros: Módulo: Ventas > Facturas');
      expect(paragraphs()).toContain('Total: 1   ·   Resueltos: 0   ·   Pendientes: 1   ·   Sin resolver: 0');
    });

    it('says that there are no filters only when there are none', async () => {
      const paragraphs = watchDocument();
      const db = { ticket: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };

      // The order is not a filter.
      await serviceOn(db).pdf(parseTicketFilters({ sort: 'date', dir: 'asc' }));

      expect(db.ticket.count).toHaveBeenCalledWith({ where: {} });
      expect(paragraphs()).toContain('Sin filtros: todos los casos');
    });
  });

  describe('xlsx', () => {
    /** The rows of the sheet of an exported file, read by the title of their column. */
    const sheetRows = async (file: Buffer): Promise<((header: string) => unknown)[]> => {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      const [, headers, ...rows] = workbook.worksheets[0].getSheetValues() as unknown[][];
      return rows.map((row) => (header: string) => row[headers.indexOf(header)]);
    };

    it('writes one row per case, with its observations dated by the server clock', async () => {
      const notes = [
        { text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 11, 0, 30) },
        { text: 'Se reinició el servicio', createdAt: new Date(2026, 10, 11, 23, 30) },
      ];
      const db = { ticket: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([exportRow({ notes })]) } };

      const file = await serviceOn(db).xlsx({ company: 'ACME' });

      const [cell] = await sheetRows(file);
      expect(cell('Código')).toBe('SOP-00007');
      expect(cell('Empresa')).toBe('ACME');
      expect(cell('Estado')).toBe('Pendiente');
      expect(cell('Responsable')).toBe('Ana');
      expect(cell('Observación')).toBe('11/11/2026: Se llamó al cliente\n11/11/2026: Se reinició el servicio');
      const where = { AND: [{ company: { equals: 'ACME', mode: 'insensitive' } }] };
      expect(db.ticket.count).toHaveBeenCalledWith({ where });
      expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    it('names a submodule with its parent, as the list does', async () => {
      const cases = [
        exportRow({ id: 1, module: { name: 'Reportes', parent: { name: 'Ventas' } } }),
        exportRow({ id: 2, module: { name: 'Reportes', parent: { name: 'Compras' } } }),
        exportRow({ id: 3, module: { name: 'Ventas', parent: null } }),
        exportRow({ id: 4, module: null }),
      ];
      const db = { ticket: { count: jest.fn().mockResolvedValue(4), findMany: jest.fn().mockResolvedValue(cases) } };

      const rows = await sheetRows(await serviceOn(db).xlsx({}));

      expect(rows.map((cell) => cell('Módulo'))).toEqual(['Ventas > Reportes', 'Compras > Reportes', 'Ventas', '']);
      // The name of the parent only comes back when the query asks for it.
      const [query] = db.ticket.findMany.mock.calls[0] as [{ include: { module: unknown } }];
      expect(query.include.module).toEqual({ select: { name: true, parent: { select: { name: true } } } });
    });

    it('refuses more than 20000 cases after counting them, without loading any', async () => {
      expect(XLSX_EXPORT_LIMIT).toBe(20_000);
      const db = { ticket: { count: jest.fn().mockResolvedValue(20_001), findMany: jest.fn() } };

      const refused = serviceOn(db).xlsx({ status: ['PENDING'] });

      await expect(refused).rejects.toBeInstanceOf(BadRequestException);
      await expect(refused).rejects.toThrow(
        'La exportación a Excel admite hasta 20000 casos y la selección actual tiene 20001. ' +
          'Acota los filtros (por ejemplo, por fechas, estado o responsable) y exporta por partes.',
      );
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [{ status: { in: ['PENDING'] } }] } });
      expect(db.ticket.findMany).not.toHaveBeenCalled();
    });
  });

  // The count has just checked the selection against the limit. A `take` on top of it would cut
  // the file, without notice, when a case is registered between the count and the read.
  it.each(['xlsx', 'pdf'] as const)('%s: loads the whole selection when it is at the limit, without a cut', async (format) => {
    const limit = { xlsx: XLSX_EXPORT_LIMIT, pdf: PDF_EXPORT_LIMIT }[format];
    const db = { ticket: { count: jest.fn().mockResolvedValue(limit), findMany: jest.fn().mockResolvedValue([exportRow()]) } };

    await expect(serviceOn(db)[format]({})).resolves.toBeInstanceOf(Buffer);

    expect(db.ticket.findMany).toHaveBeenCalledTimes(1);
    const [query] = db.ticket.findMany.mock.calls[0] as [object];
    expect(query).not.toHaveProperty('take');
  });
});
