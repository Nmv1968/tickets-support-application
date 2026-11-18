import { BadRequestException, StreamableFile } from '@nestjs/common';
import ExcelJS from 'exceljs';
import type { Response } from 'express';
import { formatDateOnly, todayDateOnly } from '../common/labels';
import { day } from '../common/testing';
import { XLSX_EXPORT_LIMIT } from '../common/xlsx';
import type { PrismaService } from '../prisma.service';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

describe('dashboard', () => {
  /** A case with the columns the dashboard and its report read. */
  const ticket = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 7,
    date: day('2026-11-02'),
    time: null,
    description: 'No abre la factura',
    status: 'PENDING',
    priority: null,
    createdAt: new Date('2026-11-02T14:00:00.000Z'),
    resolvedAt: null,
    dueAt: null,
    promisedDate: null,
    archivedAt: null,
    estimatedMinutes: null,
    spentMinutes: 0,
    company: { name: 'ACME' },
    assignees: [],
    module: null,
    supportTypes: [],
    createdBy: null,
    ...changes,
  });
  const cases = (count: number, changes: Record<string, unknown>): Record<string, unknown>[] => Array.from({ length: count }, () => ticket(changes));

  /** The controller and its service over a fake database with these cases. The filters go through the real `buildWhere`. */
  const setup = (tickets: Record<string, unknown>[] = [], total = tickets.length) => {
    const db = { ticket: { findMany: jest.fn().mockResolvedValue(tickets), count: jest.fn().mockResolvedValue(total) } };
    return { db, controller: new DashboardController(new DashboardService(db as unknown as PrismaService)), res: { set: jest.fn() } };
  };
  interface CaseQuery {
    where: unknown;
    select: Record<string, unknown>;
    orderBy?: unknown;
  }
  /** What the query of the cases asked the database for. */
  const asked = (db: { ticket: { findMany: jest.Mock } }): CaseQuery => (db.ticket.findMany.mock.calls as [CaseQuery][])[0][0];

  it('counts the cases of each company under the name it has in the catalog', async () => {
    const { db, controller } = setup([...cases(2, { company: { name: 'Corporación Ñandú' } }), ...cases(3, {})]);

    const { byCompany } = await controller.get();

    expect(byCompany).toEqual([
      { name: 'ACME', total: 3 },
      { name: 'Corporación Ñandú', total: 2 },
    ]);
    expect(asked(db).select.company).toEqual({ select: { name: true } });
  });

  // The chart has room for ten bars. The spreadsheet of the report lists them all.
  it('gives the screen the ten companies with most cases', async () => {
    const tickets = Array.from({ length: 12 }, (_, index) => cases(index + 1, { company: { name: `Empresa ${String(index + 1).padStart(2, '0')}` } })).flat();

    const { byCompany } = await setup(tickets).controller.get();

    expect(byCompany).toHaveLength(10);
    expect(byCompany[0]).toEqual({ name: 'Empresa 12', total: 12 });
    expect(byCompany[9]).toEqual({ name: 'Empresa 03', total: 3 });
  });

  // "Cliente" is a responsible of the catalog like the others: nothing in a case marks it apart.
  it('counts the cases of each responsible, and the ones nobody is responsible for under "Sin asignar"', async () => {
    const ana = { assignee: { name: 'Ana Torres' } };
    const client = { assignee: { name: 'Cliente' } };
    // The resolved case has both: it counts for each of them, as a case with two support types.
    const tickets = [...cases(2, { assignees: [ana] }), ...cases(1, { assignees: [client, ana], status: 'RESOLVED' }), ...cases(3, {})];
    const { db, controller } = setup(tickets);

    const { byAssignee } = await controller.get();

    expect(byAssignee).toEqual([
      { name: 'Ana Torres', unresolved: 0, pending: 2, resolved: 1, total: 3 },
      { name: 'Sin asignar', unresolved: 0, pending: 3, resolved: 0, total: 3 },
      { name: 'Cliente', unresolved: 0, pending: 0, resolved: 1, total: 1 },
    ]);
    expect(asked(db).select.assignees).toEqual({ select: { assignee: { select: { name: true } } } });
  });

  it('counts the cases of each support type with its colour: a case with two in both, and the ones without any as "Sin tipo"', async () => {
    const training = { supportType: { name: 'Capacitación', color: '#0c7beb' } };
    const failure = { supportType: { name: 'Falla del sistema', color: '#e5484d' } };
    const { db, controller } = setup([...cases(2, { supportTypes: [failure] }), ...cases(1, { supportTypes: [training, failure] }), ...cases(4, {})]);

    const { bySupportType } = await controller.get();

    expect(bySupportType).toEqual([
      { name: 'Falla del sistema', color: '#e5484d', total: 3 },
      { name: 'Capacitación', color: '#0c7beb', total: 1 },
      { name: 'Sin tipo', color: null, total: 4 },
    ]);
    expect(asked(db).select.supportTypes).toEqual({ select: { supportType: { select: { name: true, color: true } } } });
  });

  // An archived case is work that was done: putting it away does not take it out of the numbers.
  it('counts the archived cases with the rest, unless it is asked to leave them out', async () => {
    const { db, controller } = setup();

    await controller.get();
    expect(JSON.stringify(db.ticket.findMany.mock.calls)).not.toContain('archivedAt');

    await controller.get(undefined, undefined, 'exclude');
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [{ archivedAt: null }] } }));

    // Only that word leaves them out. Anything else is the screen as it opens: with them.
    await controller.get(undefined, undefined, 'only');
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  it('counts each module under its full name, so submodules with the same name are not added together', async () => {
    const tickets = [
      ...cases(1, { module: { name: 'Reportes', parent: null } }),
      ...cases(3, { module: { name: 'Reportes', parent: { name: 'Ventas' } } }),
      ...cases(5, { module: { name: 'Reportes', parent: { name: 'Compras' } } }),
      ...cases(2, { module: null }),
    ];
    const { db, controller } = setup(tickets);

    const { byModule } = await controller.get();

    expect(byModule).toEqual([
      { name: 'Compras > Reportes', total: 5 },
      { name: 'Ventas > Reportes', total: 3 },
      { name: 'Reportes', total: 1 },
    ]);
    // The name of the parent only comes back when the query asks for it.
    expect(asked(db).select.module).toEqual({ select: { name: true, parent: { select: { name: true } } } });
  });

  it('gives the screen the last twelve months that have cases', async () => {
    const tickets = Array.from({ length: 14 }, (_, index) => ticket({ date: day(`20${10 + index}-03-15`) }));

    const { monthly } = await setup(tickets).controller.get();

    expect(monthly).toHaveLength(12);
    expect(monthly[0]).toEqual({ month: '2012-03', total: 1, resolved: 0, open: 1 });
    expect(monthly[11].month).toBe('2023-03');
  });

  it('counts only the cases dated inside the range asked for', async () => {
    const { db, controller } = setup();

    await controller.get('2026-09-01', '2026-09-30');
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { AND: [{ date: { gte: day('2026-09-01') } }, { date: { lte: day('2026-09-30') } }] } }),
    );

    await controller.get(undefined, '2026-09-30');
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { AND: [{ date: { lte: day('2026-09-30') } }] } }));

    await controller.get();
    expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {} }));
  });

  // Counted without that end of the range, the numbers would cover cases the person did not ask for.
  it('refuses a day that does not exist in the range, and counts nothing', async () => {
    const { db, controller } = setup();

    const failure = await controller.get('2026-09-01', '2026-09-31').catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(BadRequestException);
    expect(failure).toHaveProperty('message', 'El filtro "Hasta" no es válido. Debe ser una fecha real con el formato AAAA-MM-DD.');
    expect(db.ticket.findMany).not.toHaveBeenCalled();
  });

  describe('report files', () => {
    const formats = [
      ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['pdf', 'application/pdf'],
    ] as const;
    const sample = [ticket({ id: 1, status: 'RESOLVED' }), ticket({ id: 2, company: { name: 'Corporación Ñandú' } })];
    const bytes = async (file: StreamableFile): Promise<Buffer> => {
      const chunks: Buffer[] = [];
      for await (const chunk of file.getStream()) chunks.push(chunk as Buffer);
      return Buffer.concat(chunks);
    };

    it.each(formats)('%s: answers with the file, named after the report and the day', async (format, type) => {
      const { controller, res } = setup(sample);

      expect(await controller[format](res as unknown as Response)).toBeInstanceOf(StreamableFile);

      expect(res.set).toHaveBeenCalledWith({
        'Content-Type': type,
        'Content-Disposition': `attachment; filename="reporte-soporte-${formatDateOnly(todayDateOnly())}.${format}"`,
      });
    });

    // The report is the screen, to take away: the same cases behind both.
    it.each(formats)('%s: covers the cases of the screen, by the same period and the same choice about the archived ones', async (format) => {
      const { db, controller, res } = setup(sample);

      await controller.get('2026-09-01', '2026-09-30', 'exclude');
      await controller[format](res as unknown as Response, '2026-09-01', '2026-09-30', 'exclude');

      const [[screen], [file]] = db.ticket.findMany.mock.calls as [{ where: unknown }][];
      expect(file.where).toEqual({ AND: [{ archivedAt: null }, { date: { gte: day('2026-09-01') } }, { date: { lte: day('2026-09-30') } }] });
      expect(file.where).toEqual(screen.where);
    });

    it.each(formats)('%s: refuses a day that does not exist in the range, with the error alone', async (format) => {
      const { db, controller, res } = setup(sample);

      await expect(controller[format](res as unknown as Response, '2026-02-30')).rejects.toBeInstanceOf(BadRequestException);

      expect(db.ticket.findMany).not.toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });

    it('xlsx: is the workbook of the report, with every case of the period in its data sheet by case number', async () => {
      const { db, controller, res } = setup(sample);

      const file = await bytes(await controller.xlsx(res as unknown as Response, '2026-11-01', '2026-11-30'));

      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file as unknown as Parameters<typeof workbook.xlsx.load>[0]);
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
      expect(workbook.getWorksheet('Resumen')?.getCell('B2').value).toBe('Del 01/11/2026 al 30/11/2026');
      expect(workbook.getWorksheet('Resumen')?.getCell('B3').value).toBe('Incluidos');
      expect((workbook.getWorksheet('Datos')?.getColumn(1).values as unknown[]).slice(1)).toEqual(['Código', 'SOP-00001', 'SOP-00002']);
      // What the sheet of data needs of each case comes in the same query, in a known order.
      expect(asked(db).orderBy).toEqual({ id: 'asc' });
      expect(asked(db).select).toMatchObject({ id: true, description: true, archivedAt: true, createdBy: { select: { name: true } } });
      expect(asked(db)).not.toHaveProperty('take');
    });

    // Never cut short: a report with part of the cases and nothing that says so reads as the whole.
    it('xlsx: refuses more than 20000 cases after counting them, without loading any', async () => {
      const { db, controller, res } = setup([], XLSX_EXPORT_LIMIT + 1);

      const refused = controller.xlsx(res as unknown as Response, '2020-01-01', undefined, 'exclude');

      await expect(refused).rejects.toBeInstanceOf(BadRequestException);
      await expect(refused).rejects.toThrow(
        'El reporte en Excel admite hasta 20000 casos y el periodo elegido tiene 20001. ' +
          'Acota el periodo con las fechas "Desde" y "Hasta" y descarga el reporte por partes.',
      );
      expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [{ archivedAt: null }, { date: { gte: day('2020-01-01') } }] } });
      expect(db.ticket.findMany).not.toHaveBeenCalled();
      expect(res.set).not.toHaveBeenCalled();
    });

    it('xlsx: builds the report for a period that is at the limit', async () => {
      const { controller, res } = setup(sample, XLSX_EXPORT_LIMIT);

      await expect(controller.xlsx(res as unknown as Response)).resolves.toBeInstanceOf(StreamableFile);
    });

    // It holds the numbers, not the cases: as many as the screen itself counts.
    it('pdf: is a PDF, built from the numbers without counting the cases against a limit', async () => {
      const { db, controller, res } = setup(sample, XLSX_EXPORT_LIMIT + 1);

      const file = await bytes(await controller.pdf(res as unknown as Response));

      expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(db.ticket.count).not.toHaveBeenCalled();
      // The light query of the screen: no description of each case travels for a page of totals.
      expect(asked(db).select).not.toHaveProperty('description');
    });
  });
});
