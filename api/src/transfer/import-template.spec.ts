import ExcelJS from 'exceljs';
import { ADMIN_USER, day } from '../common/testing';
import { RULE_MESSAGE_MAX, RULE_TITLE_MAX, TEMPLATE_COLUMNS, TEMPLATE_ROWS, TEMPLATE_VALUES_SHEET, buildTemplate } from './import-template';
import { toStatus } from './sheet-reading';
import { serviceOn } from './testing';

// The template is only useful if the import reads it as written: these tests pass the file the
// service produces back through the import, empty and filled in.
describe('import template', () => {
  const user = ADMIN_USER;
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
    ticket: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
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
