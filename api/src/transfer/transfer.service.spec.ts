import { inflateSync } from 'node:zlib';
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
  RULE_MESSAGE_MAX,
  RULE_TITLE_MAX,
  TEMPLATE_COLUMNS,
  TEMPLATE_ROWS,
  TEMPLATE_VALUES_SHEET,
  TransferService,
  XLSX_EXPORT_LIMIT,
  buildTemplate,
  decodeCsv,
  describeFilters,
  describeSelection,
  excelMoment,
  notesText,
  parseCsv,
  pdfSafe,
  supportTypesText,
  toDateOnly,
  toStatus,
  toTimeOnly,
} from './transfer.service';
import type { FilterNames } from './transfer.service';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
/** What every list and export asks for unless the filter says otherwise: the cases that are not archived. */
const active = { archivedAt: null };

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

    it('reads an empty cell as pending, and "Pendiente" however it is written', () => {
      expect(toStatus('')).toBe('PENDING');
      expect(toStatus('   ')).toBe('PENDING');
      expect(toStatus('PENDIENTE')).toBe('PENDING');
      expect(toStatus(' pendientes ')).toBe('PENDING');
    });

    // Taken for pending, the closed cases of an old sheet would come in as open ones.
    it('gives nothing for a word that is none of the three statuses', () => {
      for (const word of ['Cerrado', 'Solucionado', 'en revisión', 'Anulado', 'no resuelto', 'x']) expect(toStatus(word)).toBeNull();
    });
  });

  describe('decodeCsv', () => {
    const text = 'Fecha;Empresa;Módulo\n27/07/2023;Corporación Ñandú;Facturación';

    it('reads a file in UTF-8, with or without the mark Excel puts at its start', () => {
      expect(decodeCsv(Buffer.from(text, 'utf8'))).toBe(text);
      expect(parseCsv(decodeCsv(Buffer.from(`\ufeff${text}`, 'utf8')))[0]).toEqual(['Fecha', 'Empresa', 'Módulo']);
    });

    // What "CSV (delimitado por comas)" of Excel writes on Windows: one byte per letter.
    it('reads a file that is not UTF-8 as the Windows code page of Western Europe', () => {
      expect(decodeCsv(Buffer.from(text, 'latin1'))).toBe(text);
      // The bytes that code page has and Latin-1 does not: the euro sign, the long dash, the curly quotes.
      expect(decodeCsv(Buffer.from([0x80, 0x20, 0x96, 0x20, 0x93, 0xf1, 0x94]))).toBe('€ – “ñ”');
    });

    it('leaves plain text as it is', () => {
      expect(decodeCsv(Buffer.from('Fecha,Empresa\n7/27/2023,ACME', 'latin1'))).toBe('Fecha,Empresa\n7/27/2023,ACME');
      expect(decodeCsv(Buffer.alloc(0))).toBe('');
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

describe('toTimeOnly', () => {
  it('reads a time cell of Excel, which arrives as a date on its day zero', () => {
    expect(toTimeOnly(new Date('1899-12-30T14:35:00.000Z'))).toBe('14:35');
    expect(toTimeOnly(new Date('1899-12-30T00:00:00.000Z'))).toBe('00:00');
    // 14:35 as the sum of fractions gives it: a hair before the minute.
    expect(toTimeOnly(new Date('1899-12-30T14:34:59.999Z'))).toBe('14:35');
  });

  it('reads the part of a day gone by, alone or after the day of a date', () => {
    expect(toTimeOnly(0.5)).toBe('12:00');
    expect(toTimeOnly((14 * 60 + 35) / 1440)).toBe('14:35');
    expect(toTimeOnly(45000.25)).toBe('06:00');
    expect(toTimeOnly(0)).toBe('00:00');
  });

  it('reads a time written as text, on either clock', () => {
    expect(toTimeOnly('14:35')).toBe('14:35');
    expect(toTimeOnly(' 9:05 ')).toBe('09:05');
    expect(toTimeOnly('14:35:20')).toBe('14:35');
    expect(toTimeOnly('14h35')).toBe('14:35');
    expect(toTimeOnly('2:35 PM')).toBe('14:35');
    expect(toTimeOnly('2:35 p. m.')).toBe('14:35');
    expect(toTimeOnly('12:10 am')).toBe('00:10');
    expect(toTimeOnly('12:10 pm')).toBe('12:10');
  });

  it('gives nothing for an empty cell or for what is not a time of day', () => {
    for (const value of [null, undefined, '', '   ', 'por la tarde', '25:00', '14:60', '13:00 pm', '0:30 am', -0.5, new Date('x')]) {
      expect(toTimeOnly(value)).toBeNull();
    }
  });
});

describe('spreadsheet import', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
  const people = [{ id: 3, name: 'Ana' }];
  const companies = [
    { id: 2, name: 'ACME' },
    { id: 5, name: 'Corporación Ñandú' },
  ];
  const types = [
    { id: 11, name: 'Capacitación' },
    { id: 12, name: 'Falla del sistema' },
  ];
  const modules = [
    { id: 21, name: 'Ventas', parent: null },
    { id: 22, name: 'Facturas', parent: { name: 'Ventas' } },
    { id: 23, name: 'Reportes', parent: { name: 'Ventas' } },
    { id: 24, name: 'Reportes', parent: { name: 'Compras' } },
  ];
  const csv = (...lines: string[]): { buffer: Buffer; originalname: string } => ({
    buffer: Buffer.from(lines.join('\n'), 'utf8'),
    originalname: 'casos.csv',
  });
  const HEADERS = 'Fecha,Empresa,Descripción,Estado,Responsable,Observación';
  /** The import as a person runs it without ticking anything: a real one, with dates as the team sheet writes them. */
  const plain = { dryRun: false, dateOrder: 'mdy', createMissing: false } as const;
  const adding = { ...plain, createMissing: true };

  /** What a catalog answers when the import adds entries to it: each name with an id, in a row from the one given. */
  const creating = (firstId: number): jest.Mock => {
    let id = firstId;
    return jest.fn().mockImplementation(({ data }: { data: { name: string }[] }) => Promise.resolve(data.map((entry) => ({ id: id++, name: entry.name }))));
  };
  /** A fake database with the catalogs above and the cases given, which records what the import writes. */
  const database = (cases: Record<string, unknown>[] = [], sla: Record<string, unknown>[] = []) => {
    const db = {
      // The work of a transaction is done at once, with the database itself as its client.
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db)),
      /** The lock of a catalog is all the import asks for in plain SQL. */
      $executeRaw: jest.fn().mockResolvedValue(1),
      ticket: { findMany: jest.fn().mockResolvedValue(cases), create: jest.fn().mockResolvedValue({}) },
      assignee: { findMany: jest.fn().mockResolvedValue(people), createManyAndReturn: creating(90) },
      company: { findMany: jest.fn().mockResolvedValue(companies), createManyAndReturn: creating(80) },
      supportType: { findMany: jest.fn().mockResolvedValue(types), createManyAndReturn: creating(70) },
      systemModule: { findMany: jest.fn().mockResolvedValue(modules) },
      slaPolicy: { findMany: jest.fn().mockResolvedValue(sla) },
    };
    return db;
  };
  /** What the import stored of each case, in order: the fields named. */
  const stored = (db: ReturnType<typeof database>, ...fields: string[]): unknown[][] =>
    db.ticket.create.mock.calls.map(([call]: [{ data: Record<string, unknown> }]) => fields.map((field) => call.data[field]));
  const nothingAdded = (db: ReturnType<typeof database>): void => {
    expect(db.company.createManyAndReturn).not.toHaveBeenCalled();
    expect(db.assignee.createManyAndReturn).not.toHaveBeenCalled();
    expect(db.supportType.createManyAndReturn).not.toHaveBeenCalled();
    // Nor is there a lock to wait for when there is nothing to add.
    expect(db.$transaction).not.toHaveBeenCalled();
  };
  /** How the import reads a catalog of names, and how it gets back the entries it adds. */
  const named = { select: { id: true, name: true } };

  it('stores each row with the day of the case as its last activity and with its search keys', async () => {
    const db = database();
    const sheet = csv(HEADERS, '7/27/2023,CORPORACIÓN Ñandú,No abre la Facturación,Pendiente,Ana,Se REINICIÓ el servicio');

    await serviceOn(db).import(sheet, plain, user);

    const midday = new Date('2023-07-27T12:00:00.000Z');
    expect(db.ticket.create).toHaveBeenCalledTimes(1);
    // Neither `createdAt` nor `updatedAt`: the registration moment is the time of the import.
    expect(db.ticket.create).toHaveBeenCalledWith({
      data: {
        date: day('2023-07-27'),
        time: null,
        companyId: 5,
        description: 'No abre la Facturación',
        searchText: 'corporacion nandu no abre la facturacion',
        status: 'PENDING',
        assigneeId: 3,
        priority: null,
        dueAt: null,
        moduleId: null,
        createdById: 1,
        lastActivityAt: midday,
        notes: { create: { text: 'Se REINICIÓ el servicio', searchText: 'se reinicio el servicio', createdAt: midday } },
      },
    });
    nothingAdded(db);
  });

  // A case points at entries of the catalogs. The sheet only has names, typed as each person types them.
  it('finds what a row names in the catalogs however the sheet spells it, among everything they hold', async () => {
    const db = database();
    const sheet = csv(HEADERS, '7/27/2023,acme,Uno,,ANA,', '7/27/2023,  corporacion   nandu ,Dos,,ana,');

    const result = await serviceOn(db).import(sheet, plain, user);

    expect(result).toMatchObject({ toCreate: 2, rejected: 0 });
    expect(stored(db, 'companyId', 'assigneeId', 'searchText')).toEqual([
      [2, 3, 'acme uno'],
      [5, 3, 'corporacion nandu dos'],
    ]);
    // The preview shows each case with the names it will have, which are the ones of the catalogs.
    expect(result.sample.map((row) => [row.company, row.assignee])).toEqual([
      ['ACME', 'Ana'],
      ['Corporación Ñandú', 'Ana'],
    ]);
    // Deactivated entries included: a sheet that names one of them means that one.
    for (const catalog of [db.company, db.assignee, db.supportType]) {
      expect(catalog.findMany).toHaveBeenCalledWith({ select: { id: true, name: true } });
    }
    const [modulesQuery] = db.systemModule.findMany.mock.calls[0] as [object];
    expect(modulesQuery).not.toHaveProperty('where');
  });

  describe('a row with a value that does not exist', () => {
    const sheet = csv(
      'Fecha,Empresa,Descripción,Responsable,Tipo de soporte',
      '7/27/2023,ACME,Uno,Ana,Capacitación',
      '7/27/2023,Beta  Sur,Dos,Ana,',
      '7/27/2023,ACME,Tres,José Pérez,',
      '7/27/2023,BETA SUR,Cuatro,jose perez,Consulta',
      '7/27/2023,ACME,Cinco,,consulta',
    );

    it('is rejected: it is not imported, and the answer says which row it is and why', async () => {
      const db = database();

      const result = await serviceOn(db).import(sheet, plain, user);

      expect(result).toMatchObject({ createMissing: false, totalRows: 5, toCreate: 1, rejected: 4 });
      // The header is row 1 of the sheet.
      expect(result.rejectedSample).toEqual([
        { row: 3, reasons: ['La empresa «Beta Sur» no existe'] },
        { row: 4, reasons: ['El responsable «José Pérez» no existe'] },
        { row: 5, reasons: ['La empresa «BETA SUR» no existe', 'El responsable «jose perez» no existe', 'El tipo de soporte «Consulta» no existe'] },
        { row: 6, reasons: ['El tipo de soporte «consulta» no existe'] },
      ]);
      // One entry per value however it is spelled from row to row, as it is first written.
      expect(result.unknown).toEqual({ companies: ['Beta Sur'], assignees: ['José Pérez'], supportTypes: ['Consulta'], modules: [], priorities: [], statuses: [] });
      expect(result.created).toEqual({ companies: [], assignees: [], supportTypes: [] });
      expect(stored(db, 'description')).toEqual([['Uno']]);
      nothingAdded(db);
    });

    it('is imported when the import is asked to add what is missing: companies, responsibles and support types', async () => {
      const db = database();

      const result = await serviceOn(db).import(sheet, adding, user);

      expect(result).toMatchObject({ createMissing: true, toCreate: 5, rejected: 0, rejectedSample: [] });
      expect(result.unknown).toMatchObject({ companies: ['Beta Sur'], assignees: ['José Pérez'], supportTypes: ['Consulta'] });
      expect(result.created).toEqual({ companies: ['Beta Sur'], assignees: ['José Pérez'], supportTypes: ['Consulta'] });
      // Each one once, under its first spelling, tidied as the catalogs tidy a name.
      expect(db.company.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Beta Sur' }], ...named }]]);
      // A name is all a responsible has: nobody becomes a user of the app by being named in a sheet.
      expect(db.assignee.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'José Pérez' }], ...named }]]);
      expect(db.supportType.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Consulta', color: '#64748b' }], ...named }]]);
      expect(stored(db, 'description', 'companyId', 'assigneeId', 'supportTypes')).toEqual([
        ['Uno', 2, 3, { create: [{ supportTypeId: 11 }] }],
        ['Dos', 80, 3, undefined],
        ['Tres', 2, 90, undefined],
        ['Cuatro', 80, 90, { create: [{ supportTypeId: 70 }] }],
        ['Cinco', 2, null, { create: [{ supportTypeId: 70 }] }],
      ]);
      expect(result.sample.map((row) => [row.company, row.assignee, row.supportTypes])).toEqual([
        ['ACME', 'Ana', ['Capacitación']],
        ['Beta Sur', 'Ana', []],
        ['ACME', 'José Pérez', []],
        ['Beta Sur', 'José Pérez', ['Consulta']],
        ['ACME', null, ['Consulta']],
      ]);
    });

    it('is told apart in a preview, which says what the import would add and writes nothing', async () => {
      const db = database();
      const service = serviceOn(db);

      const without = await service.import(sheet, { ...plain, dryRun: true }, user);
      const withIt = await service.import(sheet, { ...adding, dryRun: true }, user);

      expect(without).toMatchObject({ dryRun: true, toCreate: 1, rejected: 4, created: { companies: [], assignees: [], supportTypes: [] } });
      expect(withIt).toMatchObject({ dryRun: true, toCreate: 5, rejected: 0, created: { companies: ['Beta Sur'], assignees: ['José Pérez'], supportTypes: ['Consulta'] } });
      expect(db.ticket.create).not.toHaveBeenCalled();
      nothingAdded(db);
    });

    // A module is a piece of the software and a priority is one of four: neither comes from a sheet.
    it('stays rejected for a module or a priority, whatever the import is asked to add', async () => {
      const db = database();
      const withBoth = csv(
        'Fecha,Empresa,Descripción,Prioridad,Módulo',
        '7/27/2023,ACME,Uno,Alta,Ventas',
        '7/27/2023,Gamma,Dos,Urgente,Ventas',
        '7/27/2023,ACME,Tres,,Bodega',
        '7/27/2023,ACME,Cuatro,URGENTE,bodega',
      );

      const result = await serviceOn(db).import(withBoth, adding, user);

      expect(result).toMatchObject({ toCreate: 1, rejected: 3 });
      expect(result.rejectedSample).toEqual([
        { row: 3, reasons: ['La prioridad «Urgente» no existe'] },
        { row: 4, reasons: ['El módulo «Bodega» no existe'] },
        { row: 5, reasons: ['El módulo «bodega» no existe', 'La prioridad «URGENTE» no existe'] },
      ]);
      expect(result.unknown).toEqual({ companies: ['Gamma'], assignees: [], supportTypes: [], modules: ['Bodega'], priorities: ['Urgente'], statuses: [] });
      // "Gamma" does not exist either, but the only row that names it is not imported: adding it would leave a company with no case.
      expect(result.created).toEqual({ companies: [], assignees: [], supportTypes: [] });
      nothingAdded(db);
      expect(stored(db, 'description')).toEqual([['Uno']]);
    });

    // The three statuses are all there are. Taken for pending, the "Cerrado" of an old sheet would
    // bring its closed cases in as open ones: on the board, and in the bell as forgotten.
    it('is rejected for a status that is none of the three, whatever the import is asked to add: it is not taken for a pending case', async () => {
      const db = database();
      const withStatuses = csv(
        HEADERS,
        '7/27/2023,ACME,Uno,Cerrado,,',
        '7/27/2023,ACME,Dos,RESUELTA,,',
        '7/27/2023,ACME,Tres,cerrado,,',
        '7/27/2023,ACME,Cuatro,,,',
        '7/27/2023,ACME,Cinco,Solucionado,,',
        '7/27/2023,ACME,Seis,sin resover,,',
        '7/27/2023,ACME,Siete,pendiente,,',
      );

      const result = await serviceOn(db).import(withStatuses, adding, user);

      expect(result).toMatchObject({ toCreate: 4, rejected: 3 });
      expect(result.rejectedSample).toEqual([
        { row: 2, reasons: ['El estado «Cerrado» no existe'] },
        { row: 4, reasons: ['El estado «cerrado» no existe'] },
        { row: 6, reasons: ['El estado «Solucionado» no existe'] },
      ]);
      expect(result.unknown).toEqual({ companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: ['Cerrado', 'Solucionado'] });
      expect(result.created).toEqual({ companies: [], assignees: [], supportTypes: [] });
      // An empty cell is still a pending case, and the three statuses are read as they always were.
      expect(stored(db, 'description', 'status')).toEqual([
        ['Dos', 'RESOLVED'],
        ['Cuatro', 'PENDING'],
        ['Seis', 'UNRESOLVED'],
        ['Siete', 'PENDING'],
      ]);
      nothingAdded(db);
    });

    // "Sin tipo" is the row the reports give the cases without a type. The catalog refuses that
    // name, and so does the import: as a type of its own it would be a second row with that label.
    it('is rejected for "Sin tipo" as a support type, which the import is never to add', async () => {
      const db = database();
      const withNoType = csv('Fecha,Empresa,Descripción,Tipo de soporte', '7/27/2023,ACME,Uno,Sin tipo', '7/27/2023,ACME,Dos,"Capacitación, SIN  TIPO"', '7/27/2023,ACME,Tres,Consulta');
      const refused = (written: string): string => `«${written}» no es un tipo de soporte: deja la celda vacía si el caso no tiene ninguno`;

      const result = await serviceOn(db).import(withNoType, adding, user);
      const withoutAdding = await serviceOn(database()).import(withNoType, { ...plain, dryRun: true }, user);

      expect(result).toMatchObject({ toCreate: 1, rejected: 2 });
      expect(result.rejectedSample).toEqual([
        { row: 2, reasons: [refused('Sin tipo')] },
        { row: 3, reasons: [refused('SIN TIPO')] },
      ]);
      // It is not a value the system lacks: it is one it cannot have.
      expect(result.unknown.supportTypes).toEqual(['Consulta']);
      expect(result.created.supportTypes).toEqual(['Consulta']);
      expect(db.supportType.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Consulta', color: '#64748b' }], ...named }]]);
      expect(stored(db, 'description')).toEqual([['Tres']]);
      // Asked to add nothing, the import gives the same reason: the name is not missing, it cannot be.
      expect(withoutAdding.rejectedSample.map((row) => row.reasons)).toEqual([[refused('Sin tipo')], [refused('SIN TIPO')], ['El tipo de soporte «Consulta» no existe']]);
      expect(withoutAdding.unknown.supportTypes).toEqual(['Consulta']);
    });

    // As a person who adds a company by hand: one at a time, and after looking. The catalogs were
    // read before the sheet was, and someone may have registered "Beta Sur" in the meantime.
    it('adds what is missing behind the lock of each catalog, and takes what someone registered meanwhile instead of adding it again', async () => {
      const db = database();
      // Read again behind the lock, the companies are one more: the one the sheet was going to add, written another way.
      db.company.findMany.mockResolvedValueOnce(companies).mockResolvedValue([...companies, { id: 44, name: 'BETA SUR' }]);

      const result = await serviceOn(db).import(sheet, adding, user);

      expect(db.company.createManyAndReturn).not.toHaveBeenCalled();
      // The answer says what this import added.
      expect(result.created).toEqual({ companies: [], assignees: ['José Pérez'], supportTypes: ['Consulta'] });
      expect(stored(db, 'description', 'companyId')).toEqual([
        ['Uno', 2],
        ['Dos', 44],
        ['Tres', 2],
        ['Cuatro', 44],
        ['Cinco', 2],
      ]);
      // A transaction per catalog, each with the lock of its own.
      expect(db.$transaction).toHaveBeenCalledTimes(3);
      expect(new Set(db.$executeRaw.mock.calls.map(([, key]: unknown[]) => key)).size).toBe(3);
      // In each, the lock comes first, then the names are read again, and only then is anything added.
      const moment = (mock: jest.Mock, call: number): number => mock.mock.invocationCallOrder[call];
      expect(moment(db.$executeRaw, 1)).toBeLessThan(moment(db.assignee.findMany, 1));
      expect(moment(db.assignee.findMany, 1)).toBeLessThan(moment(db.assignee.createManyAndReturn, 0));
      expect(moment(db.assignee.createManyAndReturn, 0)).toBeLessThan(moment(db.ticket.create, 0));
    });

    it('is listed among the first twenty, and counted with all the others', async () => {
      const lines = Array.from({ length: 25 }, (_, index) => `7/27/2023,No existe ${index},Caso ${index},,,`);

      const result = await serviceOn(database()).import(csv(HEADERS, ...lines), { ...plain, dryRun: true }, user);

      expect(result.rejected).toBe(25);
      expect(result.rejectedSample).toHaveLength(20);
      expect(result.rejectedSample.at(-1)).toEqual({ row: 21, reasons: ['La empresa «No existe 19» no existe'] });
      expect(result.unknown.companies).toHaveLength(25);
    });

    // A person looks for the row in the spreadsheet: its number there is the one that helps.
    it('carries the number the row has in a spreadsheet, blank rows and a title above the headers included', async () => {
      const workbook = new ExcelJS.Workbook();
      const page = workbook.addWorksheet('Casos');
      page.getRow(1).values = ['Casos de marzo'];
      page.getRow(3).values = ['Fecha', 'Empresa', 'Descripción'];
      page.getRow(4).values = [day('2026-03-02'), 'ACME', 'Uno'];
      page.getRow(7).values = [day('2026-03-03'), 'Delta', 'Dos'];
      const file = { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), originalname: 'marzo.xlsx' };

      const result = await serviceOn(database()).import(file, { ...plain, dryRun: true }, user);

      expect(result).toMatchObject({ totalRows: 2, toCreate: 1, rejected: 1 });
      expect(result.rejectedSample).toEqual([{ row: 7, reasons: ['La empresa «Delta» no existe'] }]);
    });
  });

  // Those words cannot be the name of a responsible: on a case they already mean that it has none.
  it('reads "Sin asignar" and "Ninguno" as a case nobody is responsible for, not as a person to look for or to add', async () => {
    const db = database();
    const sheet = csv(HEADERS, '7/27/2023,ACME,Uno,,Sin asignar,', '7/27/2023,ACME,Dos,,NINGUNO,', '7/27/2023,ACME,Tres,,,');

    const result = await serviceOn(db).import(sheet, adding, user);

    expect(result).toMatchObject({ toCreate: 3, rejected: 0, created: { assignees: [] } });
    expect(result.unknown.assignees).toEqual([]);
    expect(stored(db, 'assigneeId')).toEqual([[null], [null], [null]]);
    nothingAdded(db);
  });

  // Importing the same file again must stay harmless, and so must importing an exported one.
  it('leaves a case that is already stored alone, whatever else its row says', async () => {
    const db = database([{ date: day('2023-07-27'), company: { name: 'Acme' }, description: 'no ABRE la facturación' }]);
    const sheet = csv(HEADERS, '7/27/2023,ACME,No abre la facturación,Pendiente,Alguien que no existe,');

    const result = await serviceOn(db).import(sheet, adding, user);

    expect(result).toMatchObject({ duplicates: 1, toCreate: 0, rejected: 0 });
    expect(result.unknown.assignees).toEqual([]);
    expect(db.ticket.create).not.toHaveBeenCalled();
    nothingAdded(db);
  });

  // "CSV (delimitado por comas)" of Excel on Windows is not UTF-8: each accented letter is one byte
  // of the Windows code page. Read as UTF-8, "Módulo" was not the title of a column, and neither
  // "Corporación Ñandú" nor "Crítica" was found.
  it('reads a CSV that Excel saved in the Windows code page, with the accents of its titles and of its names', async () => {
    const db = database();
    const lines = [
      'Fecha;Empresa;Descripción;Prioridad;Módulo;Responsable;Tipo de soporte;Observación',
      '27/07/2023;Corporación Ñandú;No abre la facturación;Crítica;Ventas > Facturas;Ana;Capacitación;Se reinició',
    ];
    const sheet = { buffer: Buffer.from(lines.join('\r\n'), 'latin1'), originalname: 'casos.csv' };

    const result = await serviceOn(db).import(sheet, { ...plain, dateOrder: 'dmy' }, user);

    expect(result.columns).toMatchObject({ description: 'Descripción', module: 'Módulo', note: 'Observación' });
    expect(result).toMatchObject({ toCreate: 1, rejected: 0 });
    expect(result.unknown).toEqual({ companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: [] });
    expect(stored(db, 'companyId', 'description', 'priority', 'moduleId', 'assigneeId', 'supportTypes')).toEqual([
      [5, 'No abre la facturación', 'CRITICAL', 22, 3, { create: [{ supportTypeId: 11 }] }],
    ]);
    nothingAdded(db);
  });

  it('imports a case that a rejected row above also described', async () => {
    const db = database();
    const sheet = csv(HEADERS, '7/27/2023,ACME,No imprime,,Nadie,', '7/27/2023,ACME,No imprime,,Ana,', '7/27/2023,ACME,No imprime,,Ana,');

    const result = await serviceOn(db).import(sheet, plain, user);

    // The second row is the case; the third repeats it.
    expect(result).toMatchObject({ rejected: 1, toCreate: 1, duplicates: 1 });
    expect(stored(db, 'description', 'assigneeId')).toEqual([['No imprime', 3]]);
  });

  describe('support types', () => {
    it('reads them from every column whose title starts with "tipo", several to a cell, each once', async () => {
      const db = database();
      const sheet = csv(
        'Fecha;Empresa;Descripción;Tipo de soporte;Otro tipo de soporte;Tipos',
        '27/7/2023;ACME;Uno;Capacitación;falla del sistema;',
        '27/7/2023;ACME;Dos;capacitacion, Falla del Sistema;CAPACITACIÓN;Capacitación',
        '27/7/2023;ACME;Tres;;;"Falla del sistema ; Capacitación"',
        '27/7/2023;ACME;Cuatro;;;',
      );

      const result = await serviceOn(db).import(sheet, { ...plain, dateOrder: 'dmy' }, user);

      expect(result.columns.supportTypes).toBe('Tipo de soporte, Otro tipo de soporte, Tipos');
      expect(result).toMatchObject({ toCreate: 4, rejected: 0 });
      expect(stored(db, 'supportTypes')).toEqual([
        [{ create: [{ supportTypeId: 11 }, { supportTypeId: 12 }] }],
        [{ create: [{ supportTypeId: 11 }, { supportTypeId: 12 }] }],
        [{ create: [{ supportTypeId: 12 }, { supportTypeId: 11 }] }],
        [undefined],
      ]);
      expect(result.sample[1].supportTypes).toEqual(['Capacitación', 'Falla del sistema']);
    });

    it('takes a cell that is the name of a type as that type, even with a comma in the name', async () => {
      const db = database();
      db.supportType.findMany.mockResolvedValue([...types, { id: 13, name: 'Consulta, no falla' }]);
      const sheet = csv('Fecha,Empresa,Descripción,Tipo de soporte', '7/27/2023,ACME,Uno,"consulta, no falla"', '7/27/2023,ACME,Dos,"Consulta, Capacitación"');

      const result = await serviceOn(db).import(sheet, plain, user);

      expect(stored(db, 'description', 'supportTypes')).toEqual([['Uno', { create: [{ supportTypeId: 13 }] }]]);
      expect(result.rejectedSample).toEqual([{ row: 3, reasons: ['El tipo de soporte «Consulta» no existe'] }]);
    });

    it('rejects a row with more types than a case can carry', async () => {
      const many = Array.from({ length: 21 }, (_, index) => `Tipo ${index + 1}`);
      const sheet = csv('Fecha,Empresa,Descripción,Tipo de soporte', `7/27/2023,ACME,Uno,"${many.join(', ')}"`);

      const result = await serviceOn(database()).import(sheet, { ...adding, dryRun: true }, user);

      expect(result).toMatchObject({ toCreate: 0, rejected: 1, created: { supportTypes: [] } });
      expect(result.rejectedSample).toEqual([{ row: 2, reasons: ['Un caso no puede tener más de 20 tipos de soporte'] }]);
    });
  });

  describe('modules', () => {
    const sheet = (...names: string[]): { buffer: Buffer; originalname: string } =>
      csv('Fecha,Empresa,Descripción,Módulo', ...names.map((name, index) => `7/27/2023,ACME,Caso ${index + 1},${name}`));

    it('finds a module by its full name, and by its own name while only one module has it', async () => {
      const db = database();

      const result = await serviceOn(db).import(sheet('Ventas > Facturas', 'facturas', 'VENTAS>reportes', 'compras  >  Reportes', 'ventas', ''), plain, user);

      expect(result.columns.module).toBe('Módulo');
      expect(result).toMatchObject({ toCreate: 6, rejected: 0 });
      expect(stored(db, 'moduleId')).toEqual([[22], [22], [23], [24], [21], [null]]);
      // The preview names each module in full, as the case will show it.
      expect(result.sample.map((row) => row.module)).toEqual(['Ventas > Facturas', 'Ventas > Facturas', 'Ventas > Reportes', 'Compras > Reportes', 'Ventas']);
    });

    // Assigned to either "Reportes", the case would land in the wrong module half of the time.
    it('rejects an own name that several modules share, and says how to write it', async () => {
      const result = await serviceOn(database()).import(sheet('Reportes'), { ...plain, dryRun: true }, user);

      expect(result).toMatchObject({ toCreate: 0, rejected: 1 });
      expect(result.rejectedSample).toEqual([
        { row: 2, reasons: ['Hay más de un módulo llamado «Reportes»: escribe su nombre completo, por ejemplo «Ventas > Reportes»'] },
      ]);
      // It exists, more than once: it is not one of the values the system lacks.
      expect(result.unknown.modules).toEqual([]);
    });

    it('means the top module when its name is also the own name of a submodule', async () => {
      const db = database();
      db.systemModule.findMany.mockResolvedValue([...modules, { id: 25, name: 'Ventas', parent: { name: 'Compras' } }]);

      await serviceOn(db).import(sheet('Ventas', 'Compras > Ventas'), plain, user);

      expect(stored(db, 'moduleId')).toEqual([[21], [25]]);
    });
  });

  describe('priorities', () => {
    it('reads a priority by its name, and gives the case the deadline its SLA sets from the registration', async () => {
      const db = database([], [{ priority: 'CRITICAL', hours: 4 }]);
      const sheet = csv('Fecha,Empresa,Descripción,Prioridad', '7/27/2023,ACME,Uno,Crítica', '7/27/2023,ACME,Dos,critica', '7/27/2023,ACME,Tres,ALTA', '7/27/2023,ACME,Cuatro,');
      const before = Date.now();

      const result = await serviceOn(db).import(sheet, plain, user);

      expect(result.columns.priority).toBe('Prioridad');
      expect(result.sample.map((row) => row.priority)).toEqual(['CRITICAL', 'CRITICAL', 'HIGH', null]);
      expect(stored(db, 'priority')).toEqual([['CRITICAL'], ['CRITICAL'], ['HIGH'], [null]]);
      // The registration is the moment of the import, not the day of the case: four hours from now.
      const [[critical], , [high], [none]] = stored(db, 'dueAt') as [Date | null][];
      expect(critical?.getTime()).toBeGreaterThanOrEqual(before + 4 * 3_600_000);
      expect(critical?.getTime()).toBeLessThanOrEqual(Date.now() + 4 * 3_600_000);
      // No hours set for "Alta": no deadline, as in a case registered by hand.
      expect(high).toBeNull();
      expect(none).toBeNull();
    });

    it('does not read the SLA for a sheet without priorities', async () => {
      const db = database();

      await serviceOn(db).import(csv(HEADERS, '7/27/2023,ACME,Uno,,,'), plain, user);

      expect(db.slaPolicy.findMany).not.toHaveBeenCalled();
    });
  });

  it('takes the time of a case from its own column or from the date cell, and from nowhere else', async () => {
    const db = database();
    const sheet = csv(
      'Fecha,Hora,Empresa,Descripción',
      '27/07/2023,2:35 pm,ACME,Con hora en su columna',
      // The date is repeated from the row above; the time is not.
      ',,ACME,Sin hora',
      '28/07/2023,no sé,ACME,Con algo que no es una hora',
    );

    const result = await serviceOn(db).import(sheet, { ...plain, dateOrder: 'dmy' }, user);

    expect(result.columns.time).toBe('Hora');
    expect(result.sample.map((row) => [row.date, row.time])).toEqual([
      ['2023-07-27', '14:35'],
      ['2023-07-27', null],
      ['2023-07-28', null],
    ]);
    expect(stored(db, 'time')).toEqual([['14:35'], [null], [null]]);
  });

  it('previews without writing: repeats the date above, skips rows already stored and incomplete rows', async () => {
    const db = database([{ date: day('2023-07-27'), company: { name: 'Acme' }, description: 'no ABRE la facturación' }]);
    const sheet = csv(
      HEADERS,
      '7/27/2023,ACME,No abre la facturación,Pendiente,Ana,',
      ',ACME,No imprime,Resuelto,Ana,Se cambió el cable',
      ',,Sin empresa,Pendiente,,',
      ',ACME,No imprime,Resuelto,Ana,',
    );

    const result = await serviceOn(db).import(sheet, { ...plain, dryRun: true }, user);

    expect(result).toMatchObject({ dryRun: true, totalRows: 4, skippedEmpty: 1, duplicates: 2, toCreate: 1, rejected: 0 });
    expect(result.sample).toEqual([
      {
        date: '2023-07-27',
        time: null,
        company: 'ACME',
        description: 'No imprime',
        status: 'RESOLVED',
        priority: null,
        module: null,
        assignee: 'Ana',
        supportTypes: [],
        note: 'Se cambió el cable',
      },
    ]);
    expect(db.ticket.create).not.toHaveBeenCalled();
    nothingAdded(db);
  });
});

// The template is only useful if the import reads it as written: these tests pass the file the
// service produces back through the import, empty and filled in.
describe('import template', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
  const catalogs = {
    companies: [
      { id: 2, name: 'Zeta' },
      { id: 5, name: 'Corporación Ñandú' },
      { id: 6, name: 'ACME' },
    ],
    people: [
      { id: 4, name: 'Luis Ñáñez' },
      { id: 3, name: 'Ana' },
    ],
    types: [
      { id: 12, name: 'Falla del sistema' },
      { id: 11, name: 'Capacitación' },
    ],
    modules: [
      { id: 21, name: 'Ventas', parent: null },
      { id: 22, name: 'Facturas', parent: { name: 'Ventas' } },
      { id: 23, name: 'Inventario', parent: null },
    ],
  };
  const nothing = { companies: [], people: [], types: [], modules: [] };
  const database = (has: { [K in keyof typeof catalogs]: (typeof catalogs)[K] } = catalogs) => ({
    ticket: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn() },
    assignee: { findMany: jest.fn().mockResolvedValue(has.people), createManyAndReturn: jest.fn() },
    company: { findMany: jest.fn().mockResolvedValue(has.companies), createManyAndReturn: jest.fn() },
    supportType: { findMany: jest.fn().mockResolvedValue(has.types), createManyAndReturn: jest.fn() },
    systemModule: { findMany: jest.fn().mockResolvedValue(has.modules) },
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
  /** The values of a column of a sheet, from its first row down. */
  const columnValues = (sheet: ExcelJS.Worksheet, column: number): unknown[] => (sheet.getColumn(column).values as unknown[]).slice(1);
  const preview = { dryRun: true, dateOrder: 'dmy', createMissing: false } as const;
  const HEADERS = ['Fecha', 'Hora', 'Empresa', 'Descripción', 'Estado', 'Prioridad', 'Módulo', 'Responsable', 'Tipo de soporte', 'Otro tipo de soporte', 'Observación'];

  it('has the sheet to fill in first, with one column per field the import reads', async () => {
    const workbook = await open(await serviceOn(database()).template());

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(['Casos', 'Valores del sistema', 'Instrucciones']);
    expect((workbook.worksheets[0].getRow(1).values as unknown[]).slice(1)).toEqual(HEADERS);
    expect(TEMPLATE_COLUMNS.map((column) => column.header)).toEqual(HEADERS);
    expect(TEMPLATE_COLUMNS.filter((column) => column.required).map((column) => column.header)).toEqual(['Empresa', 'Descripción']);
  });

  it('is read by the import as it comes: every column found and no case in it', async () => {
    const db = database();
    const service = serviceOn(db);
    const file = { buffer: await service.template(), originalname: 'plantilla-casos-soporte.xlsx' };

    const result = await service.import(file, preview, user);

    expect(result.columns).toEqual({
      date: 'Fecha',
      time: 'Hora',
      company: 'Empresa',
      description: 'Descripción',
      status: 'Estado',
      priority: 'Prioridad',
      module: 'Módulo',
      assignee: 'Responsable',
      supportTypes: 'Tipo de soporte, Otro tipo de soporte',
      note: 'Observación',
    });
    // The rows that only carry cell checks are not rows of the sheet.
    expect(result).toMatchObject({ totalRows: 0, skippedEmpty: 0, toCreate: 0, rejected: 0 });
  });

  it('imports what a person fills in: a date cell, a time, and a value from each of its lists', async () => {
    const db = database();
    const service = serviceOn(db);
    const workbook = await open(await service.template());
    const sheet = workbook.worksheets[0];
    // Day 3 of month 4: read as a date cell it cannot be taken for March 4th, whatever order is chosen.
    // The time as Excel stores it when a person types 14:35 in the cell: the part of the day gone by.
    sheet.addRow([day('2026-04-03'), (14 * 60 + 35) / 1440, 'ACME', 'No imprime', 'Sin resolver', 'Crítica', 'Ventas > Facturas', 'Luis Ñáñez', 'Capacitación', 'Falla del sistema', 'Se cambió el cable']);
    sheet.addRow([null, null, 'Corporación Ñandú', 'No abre', 'Resuelto', 'Baja', 'Inventario', 'Ana', null, 'Capacitación', null]);
    sheet.addRow([null, null, 'Zeta', 'Pide una capacitación', null, null, null, null, null, null, null]);

    const result = await service.import(await asUpload(workbook), { ...preview, dateOrder: 'mdy' }, user);

    expect(result).toMatchObject({ totalRows: 3, skippedEmpty: 0, toCreate: 3, rejected: 0 });
    expect(result.unknown).toEqual({ companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: [] });
    expect(result.sample).toEqual([
      {
        date: '2026-04-03',
        time: '14:35',
        company: 'ACME',
        description: 'No imprime',
        status: 'UNRESOLVED',
        priority: 'CRITICAL',
        module: 'Ventas > Facturas',
        assignee: 'Luis Ñáñez',
        supportTypes: ['Capacitación', 'Falla del sistema'],
        note: 'Se cambió el cable',
      },
      {
        date: '2026-04-03',
        time: null,
        company: 'Corporación Ñandú',
        description: 'No abre',
        status: 'RESOLVED',
        priority: 'LOW',
        module: 'Inventario',
        assignee: 'Ana',
        supportTypes: ['Capacitación'],
        note: null,
      },
      {
        date: '2026-04-03',
        time: null,
        company: 'Zeta',
        description: 'Pide una capacitación',
        status: 'PENDING',
        priority: null,
        module: null,
        assignee: null,
        supportTypes: [],
        note: null,
      },
    ]);
  });

  // The person sees what exists before typing, and the lists of "Casos" read these same cells.
  it('shows what the system has in a sheet of its own, in sight: one column per catalog', async () => {
    const db = database();
    const lists = (await open(await serviceOn(db).template())).worksheets[1];

    expect(lists.name).toBe(TEMPLATE_VALUES_SHEET);
    expect(lists.state).toBe('visible');
    // Each catalog in the order the screens list it, whatever order the database gives.
    expect([1, 2, 3, 4, 5, 6].map((column) => columnValues(lists, column))).toEqual([
      ['Empresas', 'ACME', 'Corporación Ñandú', 'Zeta'],
      ['Estados', 'Pendiente', 'Resuelto', 'Sin resolver'],
      ['Prioridades', 'Baja', 'Media', 'Alta', 'Crítica'],
      ['Módulos', 'Inventario', 'Ventas', 'Ventas > Facturas'],
      ['Responsables', 'Ana', 'Luis Ñáñez'],
      ['Tipos de soporte', 'Capacitación', 'Falla del sistema'],
    ]);
    // What a new case can take: the active entries, and nothing that was deactivated.
    for (const catalog of [db.company, db.assignee, db.supportType]) {
      expect(catalog.findMany).toHaveBeenCalledWith({ where: { active: true }, select: { name: true } });
    }
    expect(db.systemModule.findMany).toHaveBeenCalledWith({ where: { active: true }, select: { name: true, parent: { select: { name: true } } } });
  });

  it('checks the cells a person fills in, from the first row to the last one covered', async () => {
    const workbook = await open(await serviceOn(database()).template());
    const sheet = workbook.worksheets[0];
    const list = (range: string): string => `'Valores del sistema'!${range}`;

    for (const row of [2, TEMPLATE_ROWS + 1]) {
      expect(sheet.getCell(`A${row}`).dataValidation).toMatchObject({ type: 'date', operator: 'between', showErrorMessage: true });
      expect(sheet.getCell(`B${row}`).dataValidation).toMatchObject({ type: 'decimal', operator: 'between', showErrorMessage: true });
      // Each list is the column of its catalog, from under the title to its last value.
      const lists: [string, string][] = [
        ['C', list('$A$2:$A$4')],
        ['E', list('$B$2:$B$4')],
        ['F', list('$C$2:$C$5')],
        ['G', list('$D$2:$D$4')],
        ['H', list('$E$2:$E$3')],
        ['I', list('$F$2:$F$3')],
        ['J', list('$F$2:$F$3')],
      ];
      for (const [column, formula] of lists) {
        // Strict: Excel refuses a value that is not in the list, as the import would reject its row.
        expect(sheet.getCell(`${column}${row}`).dataValidation).toMatchObject({ type: 'list', formulae: [formula], allowBlank: true, showErrorMessage: true, errorStyle: 'stop' });
      }
      // Free text: nothing to check.
      expect(sheet.getCell(`D${row}`).dataValidation).toBeUndefined();
      expect(sheet.getCell(`K${row}`).dataValidation).toBeUndefined();
    }
    expect(sheet.getCell(`A${TEMPLATE_ROWS + 2}`).dataValidation).toBeUndefined();
    expect(sheet.getCell(`C${TEMPLATE_ROWS + 2}`).dataValidation).toBeUndefined();
    expect(sheet.getColumn(1).numFmt).toBe('dd/mm/yyyy');
    expect(sheet.getColumn(2).numFmt).toBe('hh:mm');
  });

  it('tells the person who types a value that is not registered where to register it first', async () => {
    const sheet = (await open(await serviceOn(database()).template())).worksheets[0];
    const refusal = (cell: string): { errorTitle?: string; error?: string } => sheet.getCell(cell).dataValidation;

    expect(refusal('C2')).toMatchObject({
      errorTitle: 'Empresa no registrada',
      error: 'Elige una empresa de la lista. Si no está, regístrala primero en Configuración > Empresas y descarga la plantilla otra vez.',
    });
    expect(refusal('G2').error).toContain('regístralo primero en Configuración > Módulos');
    expect(refusal('H2').error).toContain('regístralo primero en Configuración > Responsables');
    expect(refusal('I2').error).toContain('regístralo primero en Configuración > Tipos de soporte');
    expect(refusal('J2')).toEqual(refusal('I2'));
    // A status and a priority are not registered anywhere: the message names the ones there are.
    expect(refusal('E2').error).toBe('Elige Pendiente, Resuelto, Sin resolver. Vacío se toma como Pendiente.');
    expect(refusal('F2').error).toBe('Elige Baja, Media, Alta, Crítica. Vacía: el caso queda sin prioridad.');
    // Excel cuts a longer title or message, or reports the file as damaged.
    for (const cell of ['A2', 'B2', 'C2', 'E2', 'F2', 'G2', 'H2', 'I2', 'J2']) {
      expect(refusal(cell).errorTitle?.length).toBeLessThanOrEqual(RULE_TITLE_MAX);
      expect(refusal(cell).error?.length).toBeLessThanOrEqual(RULE_MESSAGE_MAX);
    }
  });

  // Set cell by cell, ExcelJS writes ranges that overlap ("A10:A2001" next to "A2:A2001"), and Excel
  // then reports the file as damaged. Each rule must leave as the one range it covers.
  it('writes each cell rule as one range', () => {
    const sheet = buildTemplate({ companies: ['ACME'], modules: ['Ventas'], assignees: ['Ana'], supportTypes: ['Capacitación'] }).worksheets[0];
    const rules = (sheet as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model;

    expect(Object.keys(rules).sort()).toEqual(['A', 'B', 'C', 'E', 'F', 'G', 'H', 'I', 'J'].map((column) => `${column}2:${column}${TEMPLATE_ROWS + 1}`));
  });

  // There are no cells to point a list at. The column is left open: the import is what rejects.
  it('gives no list for a catalog with nothing registered, says so in the help of its columns, and still imports', async () => {
    const service = serviceOn(database(nothing));
    const file = await service.template();
    const [sheet, lists, guide] = (await open(file)).worksheets;
    const note = (cell: string): string => JSON.stringify(sheet.getCell(cell).note);

    for (const cell of ['C2', 'G2', 'H2', 'I2', 'J2']) expect(sheet.getCell(cell).dataValidation).toBeUndefined();
    // The lists that do not come from a catalog are always there.
    expect(sheet.getCell('E2').dataValidation).toMatchObject({ type: 'list' });
    expect(sheet.getCell('F2').dataValidation).toMatchObject({ type: 'list' });
    expect([1, 4, 5, 6].map((column) => columnValues(lists, column))).toEqual([['Empresas'], ['Módulos'], ['Responsables'], ['Tipos de soporte']]);

    expect(note('C1')).toContain('Obligatoria. Empresa que reporta el caso. Todavía no hay empresas registradas en Configuración > Empresas.');
    expect(note('G1')).toContain('Todavía no hay módulos registrados en Configuración > Módulos.');
    expect(note('H1')).toContain('Todavía no hay responsables registrados en Configuración > Responsables.');
    expect(note('I1')).toContain('Todavía no hay tipos de soporte registrados en Configuración > Tipos de soporte.');
    expect(note('J1')).toContain('Todavía no hay tipos de soporte registrados en Configuración > Tipos de soporte.');
    // No list to choose from: the help does not send the person to one.
    for (const cell of ['C1', 'G1', 'H1', 'I1', 'J1']) expect(note(cell)).not.toContain('Se elige de la lista');
    expect(note('E1')).not.toContain('Todavía no hay');
    expect(JSON.stringify(guide.getSheetValues())).toContain('Todavía no hay empresas registradas en Configuración > Empresas.');

    expect(await service.import({ buffer: file, originalname: 'plantilla-casos-soporte.xlsx' }, preview, user)).toMatchObject({ totalRows: 0 });
  });

  it('says where each list comes from while its catalog has something to choose from', async () => {
    const workbook = await open(await serviceOn(database()).template());
    const [sheet, , guide] = workbook.worksheets;
    const note = (cell: string): string => JSON.stringify(sheet.getCell(cell).note);

    expect(note('C1')).toContain('Obligatoria. Empresa que reporta el caso. Se elige de la lista: las empresas registradas en Configuración > Empresas.');
    expect(note('G1')).toContain('Vacío: sin módulo. Se elige de la lista: los módulos registrados en Configuración > Módulos.');
    expect(note('H1')).toContain('Vacío: sin asignar. Se elige de la lista: los responsables registrados en Configuración > Responsables.');
    expect(note('J1')).toContain('Se elige de la lista: los tipos de soporte registrados en Configuración > Tipos de soporte.');
    expect(JSON.stringify(sheet.getRow(1).values)).not.toContain('Todavía no hay');
    expect(JSON.stringify(guide.getSheetValues())).not.toContain('Todavía no hay');
  });

  it('words each status and each priority the way the import reads it back', async () => {
    expect(['Pendiente', 'Resuelto', 'Sin resolver'].map(toStatus)).toEqual(['PENDING', 'RESOLVED', 'UNRESOLVED']);

    const db = database();
    const service = serviceOn(db);
    const workbook = await open(await service.template());
    const [sheet, lists] = workbook.worksheets;
    for (const priority of columnValues(lists, 3).slice(1)) sheet.addRow([null, null, 'ACME', `Caso de prioridad ${String(priority)}`, null, priority]);

    const result = await service.import(await asUpload(workbook), preview, user);

    expect(result.sample.map((row) => row.priority)).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
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
    // What happens to a value that is not registered is the first thing a person asks.
    expect(guideText).toContain('se rechaza: no se importa');
    // A status that is none of the three is one of those values, and one the import never adds.
    expect(guideText).toContain('una prioridad o un estado que no existe en el sistema se rechaza');
    expect(guideText).toContain('los módulos, las prioridades y los estados, no.');
    expect(guideText).toContain('Valores del sistema');
  });
});

describe('export', () => {
  afterEach(() => jest.restoreAllMocks());

  /** A case as the export query returns it. */
  const exportRow = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 7,
    date: day('2026-11-02'),
    company: { name: 'ACME' },
    description: 'No abre la factura',
    status: 'PENDING',
    assignee: { name: 'Ana' },
    priority: 'HIGH',
    module: { name: 'Facturas' },
    supportTypes: [],
    estimatedMinutes: 30,
    spentMinutes: 0,
    promisedDate: null,
    dueAt: null,
    resolvedAt: null,
    archivedAt: null,
    createdAt: new Date(2026, 10, 2, 9, 0),
    notes: [],
    ...changes,
  });

  describe('describeFilters', () => {
    const names: FilterNames = { assignee: 'Ana Pérez', company: 'ACME', module: 'Ventas > Facturas', supportType: 'Capacitación', createdBy: 'José Pérez' };
    /** Every filter of the list on its own, with the text the PDF header gives it. */
    const alone: [TicketFilters, string][] = [
      [{ status: ['PENDING'] }, 'Estado: Pendiente'],
      [{ status: ['UNRESOLVED', 'RESOLVED'] }, 'Estado: Sin resolver, Resuelto'],
      [{ assignee: 12 }, 'Responsable: Ana Pérez'],
      [{ assignee: 'none' }, 'Responsable: sin asignar'],
      [{ companyId: 9 }, 'Empresa: ACME'],
      [{ priority: 'HIGH' }, 'Prioridad: Alta'],
      [{ moduleId: 4 }, 'Módulo: Ventas > Facturas'],
      [{ supportType: 5 }, 'Tipo de soporte: Capacitación'],
      [{ createdBy: 3 }, 'Registrado por: José Pérez'],
      [{ from: '2026-01-05' }, 'Desde: 05/01/2026'],
      [{ to: '2026-01-31' }, 'Hasta: 31/01/2026'],
      [{ overdue: true }, 'Solo vencidos'],
      [{ stale: true }, 'Solo olvidados'],
      [{ promise: 'any' }, 'Solo con promesa de entrega'],
      [{ promise: 'overdue' }, 'Solo promesa de entrega vencida'],
      [{ promise: 'today' }, 'Solo promesa de entrega para hoy'],
      [{ promise: 'soon' }, 'Solo promesa de entrega próxima'],
      [{ promise: 'due' }, 'Solo promesa de entrega vencida, para hoy o próxima'],
      [{ archived: 'only' }, 'Solo archivados'],
      [{ archived: 'all' }, 'Incluye archivados'],
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
        archived: 'all',
        promise: 'due',
        stale: '1',
        overdue: '1',
        to: '2026-01-31',
        from: '2026-01-05',
        createdBy: '3',
        supportType: '5',
        moduleId: '4',
        priority: 'HIGH',
        companyId: '9',
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
          'Tipo de soporte: Capacitación',
          'Registrado por: José Pérez',
          'Desde: 05/01/2026',
          'Hasta: 31/01/2026',
          'Solo vencidos',
          'Solo olvidados',
          'Solo promesa de entrega vencida, para hoy o próxima',
          'Incluye archivados',
          'Búsqueda: "factura"',
        ].join('  ·  '),
      );
      expect(describeFilters({ moduleId: 4, status: ['RESOLVED'] }, names)).toBe('Estado: Resuelto  ·  Módulo: Ventas > Facturas');
    });

    it('is empty when nothing filters', () => {
      expect(describeFilters({}, names)).toBe('');
      expect(describeFilters(parseTicketFilters({}), names)).toBe('');
      expect(describeFilters({ sort: 'company', dir: 'asc', page: 3, pageSize: 25 }, names)).toBe('');
      expect(describeFilters({ status: [], overdue: false, stale: false, q: '' }, names)).toBe('');
    });

    it('leaves out what the query string sent wrong, as the query does', () => {
      // A wrong day in the range is not among them: the parser refuses it, so it never gets here.
      const wrong = { status: ['a', 'b'], assignee: 'yo', companyId: 'ACME', moduleId: 'x', supportType: 'x', priority: 'URGENT', promise: 'pronto', archived: 'no' };
      expect(describeFilters(parseTicketFilters(wrong), names)).toBe('');
      expect(describeFilters(parseTicketFilters({ ...wrong, to: '2026-02-28' }), names)).toBe('Hasta: 28/02/2026');
    });

    it('reads a repeated parameter', () => {
      expect(describeFilters(parseTicketFilters({ status: ['RESOLVED', 'PENDING'], companyId: ['9', '10'] }), names)).toBe(
        'Estado: Pendiente, Resuelto  ·  Empresa: ACME',
      );
    });

    it('says so when the record a filter points at does not exist', () => {
      const nothing: FilterNames = { assignee: null, company: null, module: null, supportType: null, createdBy: null };
      expect(describeFilters({ assignee: 99 }, nothing)).toBe('Responsable: id 99 (no existe)');
      expect(describeFilters({ companyId: 99 }, nothing)).toBe('Empresa: id 99 (no existe)');
      expect(describeFilters({ moduleId: 0 }, nothing)).toBe('Módulo: id 0 (no existe)');
      expect(describeFilters({ supportType: 99 }, nothing)).toBe('Tipo de soporte: id 99 (no existe)');
      expect(describeFilters({ createdBy: 99 }, nothing)).toBe('Registrado por: id 99 (no existe)');
      expect(describeFilters({ assignee: 'none' }, nothing)).toBe('Responsable: sin asignar');
    });
  });

  // An archived case is out of the file unless its filter asks for it. A header that only said
  // "todos los casos", or only the other filters, would promise the archived ones too.
  describe('describeSelection', () => {
    const names: FilterNames = { assignee: null, company: 'ACME', module: null, supportType: null, createdBy: null };

    it('says that the archived cases are left out, with or without other filters', () => {
      expect(describeSelection({}, names)).toBe('Sin filtros: todos los casos sin archivar');
      expect(describeSelection(parseTicketFilters({ sort: 'date', archived: 'no' }), names)).toBe('Sin filtros: todos los casos sin archivar');
      expect(describeSelection({ companyId: 9, status: ['PENDING'] }, names)).toBe('Filtros: Estado: Pendiente  ·  Empresa: ACME  ·  Sin archivados');
    });

    it('words the filter of archived cases when it is the one that decides', () => {
      expect(describeSelection({ archived: 'all' }, names)).toBe('Filtros: Incluye archivados');
      expect(describeSelection({ companyId: 9, archived: 'only' }, names)).toBe('Filtros: Empresa: ACME  ·  Solo archivados');
    });
  });

  describe('supportTypesText', () => {
    const carrying = (...names: string[]): { supportType: { name: string } }[] => names.map((name) => ({ supportType: { name } }));

    it('lists the types of a case by name, and is empty for a case without any', () => {
      expect(supportTypesText(carrying('Falla del sistema', 'capacitación', 'Ámbito'))).toBe('Ámbito, capacitación, Falla del sistema');
      expect(supportTypesText(carrying('Capacitación'))).toBe('Capacitación');
      expect(supportTypesText([])).toBe('');
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
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active, { status: { in: ['PENDING'] } }] } });
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
      const where = { AND: [active, { moduleId: 4 }] };
      expect(db.ticket.count).toHaveBeenCalledWith({ where });
      expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: [{ id: 'asc' }] }));
      expect(paragraphs()).toContain('Filtros: Módulo: Ventas > Facturas  ·  Sin archivados');
      expect(paragraphs()).toContain('Total: 1   ·   Resueltos: 0   ·   Pendientes: 1   ·   Sin resolver: 0');
    });

    it('says that there are no filters only when there are none, and that the archived cases are not in it', async () => {
      const paragraphs = watchDocument();
      const db = { ticket: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };

      // The order is not a filter.
      await serviceOn(db).pdf(parseTicketFilters({ sort: 'date', dir: 'asc' }));

      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active] } });
      expect(paragraphs()).toContain('Sin filtros: todos los casos sin archivar');
    });

    it('lists the support types of each case in a column of their own', async () => {
      const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
      const types = [{ supportType: { name: 'Falla del sistema' } }, { supportType: { name: 'Capacitación' } }];
      const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue([exportRow({ supportTypes: types }), exportRow({ id: 8 })]) } };

      await serviceOn(db).pdf({});

      const content = print.mock.calls[0][0].content as { table?: { widths: unknown[]; body: unknown[][] } }[];
      const table = content.find((part) => part.table)?.table;
      const [titles, first, second] = table?.body ?? [];
      // pdfmake rewrites each cell in place while it lays the table out: by then every one is an object with its text.
      const text = (cell: unknown): unknown => (cell as { text: unknown }).text;
      const column = titles.findIndex((title) => text(title) === 'Tipos de soporte');
      expect(column).toBeGreaterThan(0);
      expect(text(first[column])).toBe('Capacitación, Falla del sistema');
      expect(text(second[column])).toBe('');
      // One width per column: pdfmake refuses a table whose rows and widths do not match.
      expect(table?.widths).toHaveLength(titles.length);
    });

    // pdfmake never makes a "*" column narrower than its longest word: with one, a web address in
    // a description widened the table past the edge of the sheet, and the status, the responsible,
    // the support types and the observations of every case went with it.
    it('keeps the table inside the page when a description has a long word without spaces: it goes on in the next line', async () => {
      const address = `https://erp.example.com/${'a'.repeat(200)}`;
      const cases = [exportRow({ description: `No abre ${address}`, notes: [{ text: 'Se revisó con el cliente', createdAt: new Date(2026, 10, 2, 10, 0) }] }), exportRow({ id: 8 })];
      const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

      // The file keeps what it draws compressed. Inflated, it says in plain text where each
      // rectangle and each line of text is put.
      const file = (await serviceOn(db).pdf({}))
        .toString('latin1')
        .split('endstream')
        .map((part) => part.split(/stream\r?\n/)[1] ?? '')
        .map((stream) => {
          try {
            return inflateSync(Buffer.from(stream, 'latin1')).toString('latin1');
          } catch {
            // Not a compressed part: nothing is drawn in it.
            return '';
          }
        })
        .join('\n');

      // An A4 sheet on its side, with 28 pt of margin at each side.
      const [left, right] = [28, 841.89 - 28];
      const rectangles = [...file.matchAll(/(-?[\d.]+) -?[\d.]+ (-?[\d.]+) -?[\d.]+ re\b/g)].map((found) => ({ from: Number(found[1]), to: Number(found[1]) + Number(found[2]) }));
      const lines = [...file.matchAll(/1 0 0 1 (-?[\d.]+) -?[\d.]+ Tm/g)].map((found) => Number(found[1]));
      // The header cells and every line of text start and end between the two margins.
      expect(rectangles.length).toBeGreaterThan(8);
      expect(lines.length).toBeGreaterThan(20);
      expect(Math.min(...rectangles.map((rect) => rect.from), ...lines)).toBeGreaterThanOrEqual(left - 0.5);
      expect(Math.max(...rectangles.map((rect) => rect.to))).toBeLessThanOrEqual(right + 0.5);
      expect(Math.max(...lines)).toBeLessThan(right);
      // The word is all there, cut into the lines its column has room for. Each line of text is
      // written in hexadecimal, in pieces with the spacing between them.
      const written = [...file.matchAll(/\[([^\]]*)\] TJ/g)].map((found) => [...found[1].matchAll(/<([0-9a-f]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
      const pieces = written.filter((line) => /^a+$/.test(line));
      expect(pieces.length).toBeGreaterThan(1);
      expect(written.join('')).toContain('a'.repeat(200));
    });

    // The header says "Incluye archivados" for the whole file. Which of its cases they are, only each row can say.
    it('marks each archived case under its code, and no other', async () => {
      const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
      const cases = [exportRow({ id: 7, archivedAt: new Date(2026, 10, 5, 9, 0) }), exportRow({ id: 8 })];
      const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

      const file = await serviceOn(db).pdf({ archived: 'all' });

      expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      const content = print.mock.calls[0][0].content as { table?: { body: unknown[][] } }[];
      const [, archived, other] = content.find((part) => part.table)?.table?.body ?? [];
      /** Every text of a cell, in the order it is read. */
      const lines = (cell: unknown): unknown[] => {
        const { text, stack } = cell as { text?: unknown; stack?: unknown[] };
        return stack ? stack.flatMap(lines) : [text];
      };
      expect(lines(archived[0])).toEqual(['SOP-00007', '(archivado)']);
      expect(lines(other[0])).toEqual(['SOP-00008']);
    });

    it('names in its header the company, the support type and the user its filters point at', async () => {
      const paragraphs = watchDocument();
      const named = (name: string): { findUnique: jest.Mock } => ({ findUnique: jest.fn().mockResolvedValue({ name }) });
      const db = {
        ticket: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([exportRow()]) },
        company: named('ACME'),
        supportType: named('Capacitación'),
        user: named('José Pérez'),
      };

      await serviceOn(db).pdf({ companyId: 9, supportType: 5, createdBy: 3, archived: 'only' });

      expect(db.company.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { name: true } });
      expect(db.supportType.findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { name: true } });
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { name: true } });
      expect(paragraphs()).toContain('Filtros: Empresa: ACME  ·  Tipo de soporte: Capacitación  ·  Registrado por: José Pérez  ·  Solo archivados');
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

      const file = await serviceOn(db).xlsx({ companyId: 9 });

      const [cell] = await sheetRows(file);
      expect(cell('Código')).toBe('SOP-00007');
      expect(cell('Empresa')).toBe('ACME');
      expect(cell('Estado')).toBe('Pendiente');
      expect(cell('Responsable')).toBe('Ana');
      expect(cell('Observación')).toBe('11/11/2026: Se llamó al cliente\n11/11/2026: Se reinició el servicio');
      const where = { AND: [active, { companyId: 9 }] };
      expect(db.ticket.count).toHaveBeenCalledWith({ where });
      expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where }));
    });

    // An archived case is out of the list on screen, and the file is that list.
    it('leaves the archived cases out unless the filter asks for them', async () => {
      const db = { ticket: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([exportRow()]) } };

      await serviceOn(db).xlsx({});
      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [active] } }));

      await serviceOn(db).xlsx({ archived: 'all' });
      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
    });

    // With the filter on "Todos" the file has both kinds of case, and nothing else tells them apart.
    it('says of each case whether it is archived, in the last column', async () => {
      const cases = [exportRow({ id: 1, archivedAt: new Date(2026, 10, 5, 9, 0) }), exportRow({ id: 2 })];
      const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

      const file = await serviceOn(db).xlsx({ archived: 'all' });

      expect((await sheetRows(file)).map((cell) => [cell('Código'), cell('Archivado')])).toEqual([
        ['SOP-00001', 'Sí'],
        ['SOP-00002', 'No'],
      ]);
      // After the columns the file already had: whoever reads them by position finds each where it was.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      const headers = (workbook.worksheets[0].getRow(1).values as unknown[]).slice(1);
      expect(headers.slice(-2)).toEqual(['Resuelto el', 'Archivado']);
      expect(headers).toHaveLength(18);
    });

    it('leaves the responsible empty for a case nobody is responsible for', async () => {
      const db = { ticket: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([exportRow({ assignee: null })]) } };

      const [cell] = await sheetRows(await serviceOn(db).xlsx({}));

      expect(cell('Responsable')).toBe('');
    });

    it('lists the support types of each case in one cell, by name', async () => {
      const types = [{ supportType: { name: 'Falla del sistema' } }, { supportType: { name: 'Capacitación' } }];
      const cases = [exportRow({ id: 1, supportTypes: types }), exportRow({ id: 2 })];
      const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

      const rows = await sheetRows(await serviceOn(db).xlsx({ supportType: 5 }));

      expect(rows.map((cell) => cell('Tipos de soporte'))).toEqual(['Capacitación, Falla del sistema', '']);
      // The filter chooses the cases that carry the type; each case still lists all of its own.
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active, { supportTypes: { some: { supportTypeId: 5 } } }] } });
      const [query] = db.ticket.findMany.mock.calls[0] as [{ include: { supportTypes: unknown } }];
      expect(query.include.supportTypes).toEqual({ select: { supportType: { select: { name: true } } } });
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
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active, { status: { in: ['PENDING'] } }] } });
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

  // People export, look at the file, and import it again, there or in another installation.
  describe('an exported spreadsheet, imported back', () => {
    const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
    const cases = [
      exportRow({
        id: 1,
        time: '14:35',
        priority: 'CRITICAL',
        module: { name: 'Facturas', parent: { name: 'Ventas' } },
        supportTypes: [{ supportType: { name: 'Falla del sistema' } }, { supportType: { name: 'Capacitación' } }],
        notes: [{ text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 2, 10, 0) }],
      }),
      // Archived: its row says so in a column the import does not read.
      exportRow({ id: 2, description: 'Pide un reporte', status: 'RESOLVED', assignee: null, priority: null, module: null, archivedAt: new Date(2026, 10, 5, 9, 0) }),
    ];
    /** A system with the catalogs the cases above use, and the cases given. */
    const database = (storedCases: Record<string, unknown>[]) => ({
      ticket: { count: jest.fn().mockResolvedValue(storedCases.length), findMany: jest.fn().mockResolvedValue(storedCases), create: jest.fn() },
      company: { findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'ACME' }]), createManyAndReturn: jest.fn() },
      assignee: { findMany: jest.fn().mockResolvedValue([{ id: 3, name: 'Ana' }]), createManyAndReturn: jest.fn() },
      supportType: {
        findMany: jest.fn().mockResolvedValue([
          { id: 11, name: 'Capacitación' },
          { id: 12, name: 'Falla del sistema' },
        ]),
        createManyAndReturn: jest.fn(),
      },
      systemModule: { findMany: jest.fn().mockResolvedValue([{ id: 22, name: 'Facturas', parent: { name: 'Ventas' } }]) },
      slaPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const exported = async (): Promise<{ buffer: Buffer; originalname: string }> => ({
      buffer: await serviceOn(database(cases)).xlsx({ archived: 'all' }),
      originalname: 'casos-soporte-2026-11-12.xlsx',
    });

    it('creates nothing where those cases already are: no case, and nothing in the catalogs', async () => {
      const db = database(cases);

      const result = await serviceOn(db).import(await exported(), { dryRun: false, dateOrder: 'dmy', createMissing: true }, user);

      expect(result).toMatchObject({ totalRows: 2, duplicates: 2, toCreate: 0, rejected: 0 });
      expect(result.created).toEqual({ companies: [], assignees: [], supportTypes: [] });
      expect(db.ticket.create).not.toHaveBeenCalled();
      for (const catalog of [db.company, db.assignee, db.supportType]) expect(catalog.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('is read whole where they are not: every column the import knows, and every value found in the catalogs', async () => {
      const file = await exported();
      const result = await serviceOn(database([])).import(file, { dryRun: true, dateOrder: 'dmy', createMissing: false }, user);

      // The file has the column that says which cases are archived, and the import takes it for none of its own.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      expect(workbook.worksheets[0].getRow(1).values).toContain('Archivado');
      expect(Object.values(result.columns).join(', ')).not.toContain('Archivado');
      expect(result.columns).toEqual({
        date: 'Fecha del caso',
        time: 'Hora del caso',
        company: 'Empresa',
        description: 'Descripción',
        status: 'Estado',
        priority: 'Prioridad',
        module: 'Módulo',
        assignee: 'Responsable',
        supportTypes: 'Tipos de soporte',
        note: 'Observación',
      });
      expect(result).toMatchObject({ toCreate: 2, rejected: 0, rejectedSample: [] });
      expect(result.unknown).toEqual({ companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: [] });
      expect(result.sample).toEqual([
        {
          date: '2026-11-02',
          time: '14:35',
          company: 'ACME',
          description: 'No abre la factura',
          status: 'PENDING',
          priority: 'CRITICAL',
          module: 'Ventas > Facturas',
          assignee: 'Ana',
          supportTypes: ['Capacitación', 'Falla del sistema'],
          note: 'Se llamó al cliente',
        },
        {
          date: '2026-11-02',
          time: null,
          company: 'ACME',
          description: 'Pide un reporte',
          status: 'RESOLVED',
          priority: null,
          module: null,
          assignee: null,
          supportTypes: [],
          note: null,
        },
      ]);
    });
  });
});
