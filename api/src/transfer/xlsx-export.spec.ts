import { BadRequestException } from '@nestjs/common';
import ExcelJS from 'exceljs';
import { XLSX_EXPORT_LIMIT } from '../common/xlsx';
import { active, exportRow, serviceOn } from './testing';

afterEach(() => jest.restoreAllMocks());

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
