import { BadRequestException } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { TicketsService } from '../tickets/tickets.service';
import { DashboardController } from './dashboard.controller';

const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

describe('dashboard', () => {
  /** A case with the columns the dashboard reads. */
  const ticket = (changes: Record<string, unknown> = {}): Record<string, unknown> => ({
    date: day('2026-11-02'),
    status: 'PENDING',
    company: 'ACME',
    priority: null,
    assigneeId: null,
    assignedToClient: false,
    moduleId: null,
    createdAt: new Date('2026-11-02T14:00:00.000Z'),
    resolvedAt: null,
    dueAt: null,
    estimatedMinutes: null,
    spentMinutes: 0,
    ...changes,
  });
  const cases = (count: number, changes: Record<string, unknown>): Record<string, unknown>[] => Array.from({ length: count }, () => ticket(changes));

  /** The controller over a fake database with these cases and modules. The filters go through the real `buildWhere`. */
  const setup = (tickets: Record<string, unknown>[] = [], modules: Record<string, unknown>[] = []) => {
    const db = {
      ticket: { findMany: jest.fn().mockResolvedValue(tickets) },
      user: { findMany: jest.fn().mockResolvedValue([]) },
      systemModule: { findMany: jest.fn().mockResolvedValue(modules) },
    };
    const prisma = db as unknown as PrismaService;
    return { db, controller: new DashboardController(prisma, new TicketsService(prisma, {} as SettingsService)) };
  };

  it('counts each module under its full name, so submodules with the same name are not added together', async () => {
    const modules = [
      { id: 1, name: 'Reportes', parent: null },
      { id: 2, name: 'Reportes', parent: { name: 'Ventas' } },
      { id: 3, name: 'Reportes', parent: { name: 'Compras' } },
    ];
    const { db, controller } = setup([...cases(1, { moduleId: 1 }), ...cases(3, { moduleId: 2 }), ...cases(5, { moduleId: 3 }), ...cases(2, { moduleId: null })], modules);

    const { byModule } = await controller.get();

    expect(byModule).toEqual([
      { name: 'Compras > Reportes', total: 5 },
      { name: 'Ventas > Reportes', total: 3 },
      { name: 'Reportes', total: 1 },
    ]);
    expect(db.systemModule.findMany).toHaveBeenCalledWith({ select: { id: true, name: true, parent: { select: { name: true } } } });
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
});
