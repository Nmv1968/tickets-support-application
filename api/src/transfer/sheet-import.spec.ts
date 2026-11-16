import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { searchKey } from '../common/labels';
import { ADMIN_USER, day } from '../common/testing';
import { IMPORT_TRANSACTION } from './sheet-import';
import { MAX_CSV_ROWS, MAX_IMPORT_ROWS } from './sheet-reading';
import { serviceOn } from './testing';

describe('spreadsheet import', () => {
  const user = ADMIN_USER;
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

  /**
   * What a catalog answers when the import adds entries to it: each name with an id, in a row from
   * the one given. As the unique index of the catalog with `skipDuplicates`, it skips a name with
   * the key of one in `registered`: an entry someone else added after the import read the catalog.
   */
  const creating = (firstId: number, registered: string[] = []): jest.Mock => {
    let id = firstId;
    const taken = new Set(registered.map(searchKey));
    return jest
      .fn()
      .mockImplementation(({ data }: { data: { name: string }[] }) =>
        Promise.resolve(data.filter((entry) => !taken.has(searchKey(entry.name))).map((entry) => ({ id: id++, name: entry.name }))),
      );
  };
  /** A fake database with the catalogs above and the cases given, which records what the import writes. */
  const database = (cases: Record<string, unknown>[] = [], sla: Record<string, unknown>[] = []) => {
    const db = {
      // The work of a transaction is done at once, with the database itself as its client.
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> => work(db)),
      /** The ids of the cases, taken from the sequence of the table: from 100 on here. */
      $queryRaw: jest.fn((_sql: TemplateStringsArray, count: number) => Promise.resolve(Array.from({ length: count }, (_, index) => ({ id: 100 + index })))),
      ticket: { findMany: jest.fn().mockResolvedValue(cases), createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ticketSupportType: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      ticketNote: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
      assignee: { findMany: jest.fn().mockResolvedValue(people), createManyAndReturn: creating(90) },
      company: { findMany: jest.fn().mockResolvedValue(companies), createManyAndReturn: creating(80) },
      supportType: { findMany: jest.fn().mockResolvedValue(types), createManyAndReturn: creating(70) },
      systemModule: { findMany: jest.fn().mockResolvedValue(modules) },
      slaPolicy: { findMany: jest.fn().mockResolvedValue(sla) },
    };
    return db;
  };
  /**
   * What the import stored of each case, in order: the fields named. `supportTypes` is the ids of
   * the types the case got, in their order, and `note` the text of its observation.
   */
  const stored = (db: ReturnType<typeof database>, ...fields: string[]): unknown[][] => {
    type Rows = [{ data: Record<string, unknown>[] }][];
    const rows = (mock: jest.Mock): Record<string, unknown>[] => (mock.mock.calls as Rows).flatMap(([call]) => call.data);
    const [types, notes] = [rows(db.ticketSupportType.createMany), rows(db.ticketNote.createMany)];
    return rows(db.ticket.createMany).map((data) =>
      fields.map((field) => {
        if (field === 'supportTypes') return types.filter((type) => type.ticketId === data.id).map((type) => type.supportTypeId);
        if (field === 'note') return notes.find((note) => note.ticketId === data.id)?.text ?? null;
        return data[field];
      }),
    );
  };
  const nothingAdded = (db: ReturnType<typeof database>): void => {
    expect(db.company.createManyAndReturn).not.toHaveBeenCalled();
    expect(db.assignee.createManyAndReturn).not.toHaveBeenCalled();
    expect(db.supportType.createManyAndReturn).not.toHaveBeenCalled();
  };
  /** How the import reads a catalog of names, and how it gets back the entries it adds. */
  const named = { select: { id: true, name: true } };
  /** How it adds them: a name whose key another entry has is skipped, and that entry taken. */
  const adds = { skipDuplicates: true, ...named };

  it('stores each row with the day of the case as its last activity and with its search keys', async () => {
    const db = database();
    const sheet = csv(HEADERS, '7/27/2023,CORPORACIÓN Ñandú,No abre la Facturación,Pendiente,Ana,Se REINICIÓ el servicio');

    await serviceOn(db).import(sheet, plain, user);

    const midday = new Date('2023-07-27T12:00:00.000Z');
    expect(db.ticket.createMany).toHaveBeenCalledTimes(1);
    // Neither `createdAt` nor `updatedAt`: the registration moment is the time of the import.
    expect(db.ticket.createMany).toHaveBeenCalledWith({
      data: [
        {
          id: 100,
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
        },
      ],
    });
    // The observation points at the case by the id the case got from the sequence.
    expect(db.ticketNote.createMany).toHaveBeenCalledWith({
      data: [{ ticketId: 100, text: 'Se REINICIÓ el servicio', searchText: 'se reinicio el servicio', createdAt: midday }],
    });
    expect(db.ticketSupportType.createMany).not.toHaveBeenCalled();
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
      // With the key the list of cases orders the companies by.
      expect(db.company.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Beta Sur', sortKey: 'beta sur' }], ...adds }]]);
      // A name is all a responsible has, with its key: nobody becomes a user of the app by being named in a sheet.
      expect(db.assignee.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'José Pérez', nameKey: 'jose perez' }], ...adds }]]);
      expect(db.supportType.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Consulta', nameKey: 'consulta', color: '#64748b' }], ...adds }]]);
      expect(stored(db, 'description', 'companyId', 'assigneeId', 'supportTypes')).toEqual([
        ['Uno', 2, 3, [11]],
        ['Dos', 80, 3, []],
        ['Tres', 2, 90, []],
        ['Cuatro', 80, 90, [70]],
        ['Cinco', 2, null, [70]],
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
      expect(db.ticket.createMany).not.toHaveBeenCalled();
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
      expect(db.supportType.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Consulta', nameKey: 'consulta', color: '#64748b' }], ...adds }]]);
      expect(stored(db, 'description')).toEqual([['Tres']]);
      // Asked to add nothing, the import gives the same reason: the name is not missing, it cannot be.
      expect(withoutAdding.rejectedSample.map((row) => row.reasons)).toEqual([[refused('Sin tipo')], [refused('SIN TIPO')], ['El tipo de soporte «Consulta» no existe']]);
      expect(withoutAdding.unknown.supportTypes).toEqual(['Consulta']);
    });

    // As a person who goes to add a company by hand and finds it there. The catalogs were read
    // before the sheet was, and someone may have registered "Beta Sur" in the meantime: the unique
    // index of the companies makes the import skip it, and the import reads it then.
    it('takes what someone registered meanwhile instead of adding it again', async () => {
      const db = database();
      db.company.createManyAndReturn = creating(80, ['BETA SUR']);
      // Read again, the companies are one more: the one the sheet was going to add, written another way.
      db.company.findMany.mockResolvedValueOnce(companies).mockResolvedValue([...companies, { id: 44, name: 'BETA SUR' }]);

      const result = await serviceOn(db).import(sheet, adding, user);

      expect(db.company.createManyAndReturn.mock.calls).toEqual([[{ data: [{ name: 'Beta Sur', sortKey: 'beta sur' }], ...adds }]]);
      // The answer says what this import added.
      expect(result.created).toEqual({ companies: [], assignees: ['José Pérez'], supportTypes: ['Consulta'] });
      expect(stored(db, 'description', 'companyId')).toEqual([
        ['Uno', 2],
        ['Dos', 44],
        ['Tres', 2],
        ['Cuatro', 44],
        ['Cinco', 2],
      ]);
      // One transaction for everything. The catalog is read again only after the name was skipped, and the cases come last.
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      const moment = (mock: jest.Mock, call: number): number => mock.mock.invocationCallOrder[call];
      expect(moment(db.company.createManyAndReturn, 0)).toBeLessThan(moment(db.company.findMany, 1));
      expect(moment(db.supportType.createManyAndReturn, 0)).toBeLessThan(moment(db.ticket.createMany, 0));
    });

    it('reads a catalog only once when every name it lacked went in', async () => {
      const db = database();

      await serviceOn(db).import(sheet, adding, user);

      expect([db.company.findMany, db.assignee.findMany, db.supportType.findMany].map((mock) => mock.mock.calls.length)).toEqual([1, 1, 1]);
    });

    // Two imports that add two of the same names, each in the other order, would wait for each
    // other: each one for the name the other has just written. In one order they cannot.
    it('adds the names of a catalog in the order of their keys, and answers them in the order of the sheet', async () => {
      const db = database();
      const names = csv(HEADERS, '7/27/2023,Zeta Nueva,Uno,,,', '7/27/2023,alfa nueva,Dos,,,', '7/27/2023,Óptica Sur,Tres,,,', '7/27/2023,Beta Sur,Cuatro,,,');

      const result = await serviceOn(db).import(names, adding, user);

      type Call = [{ data: { name: string }[] }];
      expect((db.company.createManyAndReturn.mock.calls as Call[]).map(([call]) => call.data.map((entry) => entry.name))).toEqual([
        ['alfa nueva', 'Beta Sur', 'Óptica Sur', 'Zeta Nueva'],
      ]);
      expect(result.created.companies).toEqual(['Zeta Nueva', 'alfa nueva', 'Óptica Sur', 'Beta Sur']);
      expect(stored(db, 'description', 'companyId')).toEqual([
        ['Uno', 83],
        ['Dos', 80],
        ['Tres', 82],
        ['Cuatro', 81],
      ]);
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
    expect(db.ticket.createMany).not.toHaveBeenCalled();
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
      [5, 'No abre la facturación', 'CRITICAL', 22, 3, [11]],
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
        [[11, 12]],
        [[11, 12]],
        [[12, 11]],
        [[]],
      ]);
      expect(result.sample[1].supportTypes).toEqual(['Capacitación', 'Falla del sistema']);
    });

    it('takes a cell that is the name of a type as that type, even with a comma in the name', async () => {
      const db = database();
      db.supportType.findMany.mockResolvedValue([...types, { id: 13, name: 'Consulta, no falla' }]);
      const sheet = csv('Fecha,Empresa,Descripción,Tipo de soporte', '7/27/2023,ACME,Uno,"consulta, no falla"', '7/27/2023,ACME,Dos,"Consulta, Capacitación"');

      const result = await serviceOn(db).import(sheet, plain, user);

      expect(stored(db, 'description', 'supportTypes')).toEqual([['Uno', [13]]]);
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
    expect(db.ticket.createMany).not.toHaveBeenCalled();
    nothingAdded(db);
  });

  it('refuses a sheet with more rows than one import stores, before reading any of them, in the preview too', async () => {
    const rows = (count: number): string[] => Array.from({ length: count }, (_, index) => `7/27/2023,ACME,Caso ${index + 1},,,`);

    await expect(serviceOn(database()).import(csv(HEADERS, ...rows(MAX_IMPORT_ROWS + 1)), { ...plain, dryRun: true }, user)).rejects.toThrow(
      new BadRequestException(
        `El archivo tiene ${MAX_IMPORT_ROWS + 1} filas debajo de los encabezados y se pueden importar hasta ${MAX_IMPORT_ROWS} a la vez. Divídelo en varios archivos.`,
      ),
    );
    const db = database();
    await expect(serviceOn(db).import(csv(HEADERS, ...rows(MAX_IMPORT_ROWS + 1)), plain, user)).rejects.toThrow(BadRequestException);
    expect(db.ticket.createMany).not.toHaveBeenCalled();
    // As many as it stores are read.
    await expect(serviceOn(database()).import(csv(HEADERS, ...rows(MAX_IMPORT_ROWS)), { ...plain, dryRun: true }, user)).resolves.toMatchObject({
      toCreate: MAX_IMPORT_ROWS,
    });
  });

  // Every record of a CSV is an array in memory, and 20 MB of empty lines are twenty million of them.
  it('stops reading a CSV once it has more rows than any sheet it imports could have, and says so', async () => {
    const tooMany = new BadRequestException(
      `El archivo tiene más de ${MAX_IMPORT_ROWS} filas debajo de los encabezados y se pueden importar hasta ${MAX_IMPORT_ROWS} a la vez. Divídelo en varios archivos.`,
    );
    const emptyLines = { buffer: Buffer.alloc(20 * 1024 * 1024, '\n'), originalname: 'vacio.csv' };

    await expect(serviceOn(database()).import(emptyLines, { ...plain, dryRun: true }, user)).rejects.toThrow(tooMany);
    // The headers as far down as they may be, then the most rows an import takes: read, and counted.
    const title = Array.from({ length: MAX_CSV_ROWS - MAX_IMPORT_ROWS - 2 }, () => 'Casos del año');
    const rows = Array.from({ length: MAX_IMPORT_ROWS }, (_, index) => `7/27/2023,ACME,Caso ${index + 1},,,`);
    await expect(serviceOn(database()).import(csv(...title, HEADERS, ...rows), { ...plain, dryRun: true }, user)).resolves.toMatchObject({
      toCreate: MAX_IMPORT_ROWS,
    });
    await expect(serviceOn(database()).import(csv(...title, HEADERS, ...rows, 'una más'), { ...plain, dryRun: true }, user)).rejects.toThrow(tooMany);
  });

  // ExcelJS inflates the whole file into memory before a row can be counted: see xlsx-size.ts.
  it('refuses an .xlsx too large once uncompressed before ExcelJS opens it', async () => {
    const workbook = new ExcelJS.Workbook();
    const page = workbook.addWorksheet('Casos');
    page.addRow(['Fecha', 'Empresa', 'Descripción']);
    // Each description its own, so that the sheet keeps them all: over 50 MB together, in a file of a few.
    for (let index = 0; index < 11_000; index++) page.addRow([day('2026-03-02'), 'ACME', `${index} ${'No imprime. '.repeat(400)}`]);
    const file = { buffer: Buffer.from(await workbook.xlsx.writeBuffer()), originalname: 'marzo.xlsx' };
    const opened = jest.spyOn(ExcelJS.Workbook.prototype, 'xlsx', 'get');

    await expect(serviceOn(database()).import(file, { ...plain, dryRun: true }, user)).rejects.toThrow(
      /^El archivo Excel ocupa 5\d MB sin comprimir y se pueden importar hasta 50 MB a la vez\. Divídelo en varios archivos\.$/,
    );
    expect(opened).not.toHaveBeenCalled();
    opened.mockRestore();
  });

  // A failure halfway used to leave part of the sheet in, with the companies it had added; importing
  // the file again skipped that part as duplicates, and nobody could tell which rows had gone in.
  describe('all or nothing', () => {
    type Row = Record<string, unknown>;
    type Table = 'company' | 'assignee' | 'supportType' | 'ticket' | 'ticketSupportType' | 'ticketNote';
    type Tables = Record<Table, Row[]>;
    const sheet = csv(
      'Fecha,Empresa,Descripción,Responsable,Tipo de soporte,Observación',
      '7/27/2023,ACME,Uno,Ana,Capacitación,Se llamó al cliente',
      '7/27/2023,Beta Sur,Dos,José Pérez,Consulta,',
      '7/27/2023,ACME,Tres,,,Espera respuesta',
      '7/27/2023,Beta Sur,Cuatro,Ana,,',
      '7/27/2023,ACME,Cinco,José Pérez,Consulta,',
    );

    /**
     * A database that keeps what is written, as PostgreSQL does: a write outside a transaction is in
     * at once, and the writes of a transaction are in when its work ends well, none of them when it
     * fails. `failing` makes the write of that row of that table fail, counted from 1 across the
     * import: the fourth case of the sheet, say. `events` says where each write was.
     */
    const keeping = (failing?: { table: Table; row: number }) => {
      const kept: Tables = { company: [...companies], assignee: [...people], supportType: [...types], ticket: [], ticketSupportType: [], ticketNote: [] };
      const events: string[] = [];
      const written: Partial<Record<Table, number>> = {};
      let nextEntry = 80;
      let nextCase = 100;
      const insert = (tables: Tables, table: Table, rows: Row[], where: string): void => {
        events.push(`${where}: ${table}`);
        for (const row of rows) {
          written[table] = (written[table] ?? 0) + 1;
          if (failing?.table === table && failing.row === written[table]) throw new Error(`The database refused row ${failing.row} of ${table}`);
          tables[table].push(row);
        }
      };
      const clientOf = (tables: Tables, where: string) => {
        const catalog = (table: 'company' | 'assignee' | 'supportType') => ({
          findMany: () => Promise.resolve(tables[table].map(({ id, name }) => ({ id, name }))),
          createManyAndReturn: ({ data }: { data: Row[] }) => {
            const added: Row[] = data.map((row) => ({ ...row, id: nextEntry++ }));
            insert(tables, table, added, where);
            return Promise.resolve(added.map(({ id, name }) => ({ id, name })));
          },
        });
        const many = (table: Table) => ({
          createMany: ({ data }: { data: Row[] }) => {
            insert(tables, table, data, where);
            return Promise.resolve({ count: data.length });
          },
        });
        return {
          $queryRaw: (_sql: TemplateStringsArray, count: number) => Promise.resolve(Array.from({ length: count }, () => ({ id: nextCase++ }))),
          company: catalog('company'),
          assignee: catalog('assignee'),
          supportType: catalog('supportType'),
          ticket: {
            findMany: () => Promise.resolve([]),
            ...many('ticket'),
            // One case at a time, as the import stored them before.
            create: ({ data }: { data: Row }) => {
              insert(tables, 'ticket', [data], where);
              return Promise.resolve({});
            },
          },
          ticketSupportType: many('ticketSupportType'),
          ticketNote: many('ticketNote'),
          systemModule: { findMany: () => Promise.resolve(modules) },
          slaPolicy: { findMany: () => Promise.resolve([]) },
        };
      };
      const db = {
        ...clientOf(kept, 'outside'),
        $transaction: jest.fn(async (work: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
          const pending = structuredClone(kept);
          events.push('begin');
          try {
            const answer = await work(clientOf(pending, 'in'));
            Object.assign(kept, pending);
            events.push('commit');
            return answer;
          } catch (error) {
            events.push('rollback');
            throw error;
          }
        }),
      };
      return { db, kept, events };
    };
    const untouched = (kept: Tables): void => {
      expect(kept).toEqual({ company: companies, assignee: people, supportType: types, ticket: [], ticketSupportType: [], ticketNote: [] });
    };

    it('stores nothing when a case fails: neither the cases before it nor what it added to the catalogs', async () => {
      const { db, kept } = keeping({ table: 'ticket', row: 4 });

      await expect(serviceOn(db).import(sheet, adding, user)).rejects.toThrow('The database refused row 4 of ticket');

      untouched(kept);
    });

    it('stores nothing when the last write fails: the observations, after every case and its types', async () => {
      const { db, kept, events } = keeping({ table: 'ticketNote', row: 2 });

      await expect(serviceOn(db).import(sheet, adding, user)).rejects.toThrow('The database refused row 2 of ticketNote');

      untouched(kept);
      expect(events.at(-1)).toBe('rollback');
    });

    it('stores everything in one transaction: what the catalogs lacked, one catalog after the other, then the cases', async () => {
      const { db, kept, events } = keeping();

      const result = await serviceOn(db).import(sheet, adding, user);

      expect(result).toMatchObject({ toCreate: 5, rejected: 0, created: { companies: ['Beta Sur'], assignees: ['José Pérez'], supportTypes: ['Consulta'] } });
      expect(events).toEqual([
        'begin',
        'in: company',
        'in: assignee',
        'in: supportType',
        'in: ticket',
        'in: ticketSupportType',
        'in: ticketNote',
        'commit',
      ]);
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), IMPORT_TRANSACTION);
      // In the order of the sheet, each with the ids of what it names and its rows in the other tables.
      expect(kept.ticket.map((row) => [row.id, row.description, row.companyId, row.assigneeId])).toEqual([
        [100, 'Uno', 2, 3],
        [101, 'Dos', 80, 81],
        [102, 'Tres', 2, null],
        [103, 'Cuatro', 80, 3],
        [104, 'Cinco', 2, 81],
      ]);
      expect(kept.ticketSupportType).toEqual([
        { ticketId: 100, supportTypeId: 11 },
        { ticketId: 101, supportTypeId: 82 },
        { ticketId: 104, supportTypeId: 82 },
      ]);
      expect(kept.ticketNote.map((note) => [note.ticketId, note.text])).toEqual([
        [100, 'Se llamó al cliente'],
        [102, 'Espera respuesta'],
      ]);
      expect(kept.company.at(-1)).toEqual({ id: 80, name: 'Beta Sur', sortKey: 'beta sur' });
    });

    // Prisma gives an interactive transaction 5 s unless told otherwise: a sheet of thousands of rows
    // can take longer on a slow server.
    it('gives its transaction a time limit for a large sheet', () => {
      expect(IMPORT_TRANSACTION.timeout).toBeGreaterThanOrEqual(60_000);
      expect(IMPORT_TRANSACTION.maxWait).toBeGreaterThan(2_000);
    });

    it('says in Spanish that nothing was stored when the transaction runs out of time', async () => {
      const { db, kept } = keeping();
      db.$transaction.mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Transaction already closed: the timeout for this transaction was 120000 ms', {
          code: 'P2028',
          clientVersion: Prisma.prismaVersion.client,
        }),
      );

      const failure = serviceOn(db).import(sheet, adding, user);

      await expect(failure).rejects.toThrow(ServiceUnavailableException);
      await expect(failure).rejects.toThrow(/no se guardó nada/);
      untouched(kept);
    });
  });
});
