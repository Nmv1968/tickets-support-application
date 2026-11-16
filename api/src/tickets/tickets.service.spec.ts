import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_USER, day } from '../common/testing';
import type { PrismaService } from '../prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { FAILURE, NOW, TODAY, TRAINING, USER_ERROR, carrying, stored } from './testing';
import type { TicketFilters } from './ticket-filters';
import { TicketInput } from './ticket-input';
import type { StoredTicket } from './ticket-mappers';
import { TicketsService } from './tickets.service';

describe('TicketsService', () => {
  const user = ADMIN_USER;
  /** With the reminder at 48 hours, a case not touched since before this moment is forgotten. */
  const CUTOFF = new Date(NOW.getTime() - 48 * 3_600_000);
  const open = { status: { not: 'RESOLVED' } };
  /** What every list asks for unless the filter says otherwise: the cases that are not archived. */
  const active = { archivedAt: null };
  const COMPANY_NAMES: Record<number, string> = { 2: 'ACME', 5: 'Corporación Ñandú' };

  /**
   * A TicketsService over a fake database: an object with only the Prisma calls the test expects.
   * `staleHours` is the forgotten-case reminder; 0 turns it off. Advance notice of promises: 3 days.
   */
  function serviceOn(db: object, staleHours = 48): TicketsService {
    const settings: Pick<SettingsService, 'staleHours' | 'reminderRules'> = {
      staleHours: () => Promise.resolve(staleHours),
      reminderRules: () => Promise.resolve({ staleBefore: staleHours ? new Date(NOW.getTime() - staleHours * 3_600_000) : null, promiseSoonDays: 3 }),
    };
    return new TicketsService(db as PrismaService, settings as SettingsService);
  }

  /** A case as the list and the detail queries return it. */
  const row = (changes: Partial<StoredTicket> = {}): Record<string, unknown> => ({
    ...stored(changes),
    createdBy: null,
    notes: [],
    attachments: [],
    history: [],
    _count: { notes: 0, attachments: 0 },
  });

  /** A fake database that holds one case and records what is written to it. */
  const caseDb = (found: Record<string, unknown> | null = row()) => ({
    $transaction: jest.fn((queries: unknown[]) => Promise.all(queries)),
    ticket: {
      findUnique: jest.fn().mockResolvedValue(found),
      create: jest.fn().mockResolvedValue({ id: 7 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: found ? 1 : 0 }),
    },
    ticketNote: { create: jest.fn().mockResolvedValue({}), deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
    ticketHistory: { createMany: jest.fn().mockResolvedValue({ count: 0 }) },
    // The catalogs: the companies 2 and 5, any responsible, and the three support types above.
    company: { findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(where.id in COMPANY_NAMES ? { name: COMPANY_NAMES[where.id] } : null)) },
    assignee: { findUnique: jest.fn().mockResolvedValue({ name: 'Luis' }) },
    supportType: {
      findMany: jest.fn(({ where }: { where: { id: { in: number[] } } }) =>
        Promise.resolve([FAILURE, TRAINING, USER_ERROR].filter((type) => where.id.in.includes(type.id)).map(({ id, name }) => ({ id, name }))),
      ),
    },
  });

  /** A fake database whose list of cases is `rows`. */
  const listDb = (rows: Record<string, unknown>[], total = rows.length) => ({
    $transaction: jest.fn((queries: unknown[]) => Promise.all(queries)),
    ticket: { findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(total) },
  });

  beforeAll(() => jest.useFakeTimers({ now: NOW }));
  afterAll(() => jest.useRealTimers());

  describe('list', () => {
    it('asks for the page requested and says which one it answered', async () => {
      const db = listDb([], 120);

      expect(await serviceOn(db).list({ page: 3, pageSize: 25 })).toEqual({ items: [], total: 120, page: 3, pageSize: 25 });
      // Counted with the same filter as the page: the archived cases are in neither.
      const where = { AND: [active] };
      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where, orderBy: [{ id: 'desc' }], skip: 50, take: 25 }));
      expect(db.ticket.count).toHaveBeenLastCalledWith({ where });
    });

    // The database compares text by code point: by the name itself, "Óptica" and "acme" would go
    // after "Zapatería". The key of the name is in lowercase and without accents.
    it('orders by company by the key of its name, and the cases of one company by number', async () => {
      const db = listDb([]);

      await serviceOn(db).list({ sort: 'company', dir: 'asc' });

      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: [{ company: { sortKey: 'asc' } }, { id: 'asc' }] }));
    });

    it('lists the archived cases only when the filter asks for them', async () => {
      const db = listDb([]);

      await serviceOn(db).list({ archived: 'only' });
      expect(db.ticket.count).toHaveBeenLastCalledWith({ where: { AND: [{ archivedAt: { not: null } }] } });

      await serviceOn(db).list({ archived: 'all' });
      expect(db.ticket.count).toHaveBeenLastCalledWith({ where: {} });
    });

    it('shows each case with its company, its responsible, its support types by name and whether it is archived', async () => {
      const archivedAt = new Date('2026-11-05T12:00:00.000Z');
      const rows = [
        row({ id: 1, supportTypes: carrying(FAILURE, USER_ERROR, TRAINING), createdById: 4 }),
        row({ id: 2, companyId: 5, company: { id: 5, name: 'Corporación Ñandú' }, assigneeId: null, assignee: null, archivedAt, createdById: null }),
      ];

      const { items } = await serviceOn(listDb(rows)).list({ archived: 'all' });

      expect(items[0]).toMatchObject({
        code: 'SOP-00001',
        companyId: 2,
        company: 'ACME',
        assigneeId: 3,
        assigneeName: 'Ana',
        supportTypes: [TRAINING, USER_ERROR, FAILURE],
        archivedAt: null,
        createdById: 4,
      });
      expect(items[1]).toMatchObject({ companyId: 5, company: 'Corporación Ñandú', assigneeId: null, assigneeName: null, supportTypes: [], archivedAt, createdById: null });
      // The responsible is a person of the catalog or nobody: the client is no longer a switch of the case.
      expect(items[0]).not.toHaveProperty('assignedToClient');
    });

    it('answers the first 50 cases when no page is asked for', async () => {
      const db = listDb([], 120);

      expect(await serviceOn(db).list({})).toEqual({ items: [], total: 120, page: 1, pageSize: 50 });
      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ skip: 0, take: 50 }));
    });

    it('marks a case as forgotten only when it is open and its last activity is before the cut-off', async () => {
      const rows = [
        row({ id: 1, lastActivityAt: new Date(CUTOFF.getTime() - 1) }),
        row({ id: 2, lastActivityAt: CUTOFF }),
        row({ id: 3, lastActivityAt: new Date(CUTOFF.getTime() + 1) }),
        row({ id: 4, status: 'RESOLVED', lastActivityAt: new Date(CUTOFF.getTime() - 1) }),
      ];

      const { items } = await serviceOn(listDb(rows)).list({});
      expect(items.map((item) => [item.code, item.stale])).toEqual([
        ['SOP-00001', true],
        ['SOP-00002', false],
        ['SOP-00003', false],
        ['SOP-00004', false],
      ]);

      const reminderOff = await serviceOn(listDb(rows), 0).list({});
      expect(reminderOff.items.map((item) => item.stale)).toEqual([false, false, false, false]);
    });
  });

  describe('reminders', () => {
    it('shows promises that are due, forgotten cases oldest first and cases past their deadline', async () => {
      const db = {
        ticket: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce([row({ id: 1 })])
            .mockResolvedValueOnce([row({ id: 2 })])
            .mockResolvedValueOnce([row({ id: 3 })]),
        },
      };

      const result = await serviceOn(db).reminders();

      const [promises, forgotten, overdue] = db.ticket.findMany.mock.calls.map(([query]) => query as Record<string, unknown>);
      // "Due" is overdue, today or within the 3 days of advance notice: up to 14/11/2026.
      expect(promises).toMatchObject({
        where: { AND: [active, { ...open, promisedDate: { lte: day('2026-11-14') } }] },
        orderBy: [{ promisedDate: 'asc' }, { id: 'asc' }],
      });
      expect(forgotten).toMatchObject({ where: { AND: [active, { ...open, lastActivityAt: { lt: CUTOFF } }] }, orderBy: { lastActivityAt: 'asc' } });
      expect(overdue).toMatchObject({ where: { AND: [active, { ...open, dueAt: { lt: NOW } }] }, orderBy: { dueAt: 'asc' } });
      expect(result).toMatchObject({
        staleHours: 48,
        promiseSoonDays: 3,
        promises: [{ code: 'SOP-00001' }],
        stale: [{ code: 'SOP-00002' }],
        overdue: [{ code: 'SOP-00003' }],
      });
    });

    it('shows no forgotten case, and does not look for any, when that reminder is off', async () => {
      const db = { ticket: { findMany: jest.fn().mockResolvedValue([]) } };

      const result = await serviceOn(db, 0).reminders();

      expect(result).toEqual({ staleHours: 0, promiseSoonDays: 3, promises: [], stale: [], overdue: [] });
      expect(db.ticket.findMany).toHaveBeenCalledTimes(2);
      expect(JSON.stringify(db.ticket.findMany.mock.calls)).not.toContain('lastActivityAt');
    });

    // An archived case is put away: the bell does not ring for it, whatever its promise or its deadline.
    it('never looks among the archived cases, in any of its three lists', async () => {
      const db = { ticket: { findMany: jest.fn().mockResolvedValue([]) } };

      await serviceOn(db).reminders();

      const wheres = db.ticket.findMany.mock.calls.map(([query]: [{ where: { AND: unknown[] } }]) => query.where.AND);
      expect(wheres).toHaveLength(3);
      for (const conditions of wheres) expect(conditions).toContainEqual(active);
    });
  });

  // Only the writes that are someone working on the case move `lastActivityAt`: see `activityStamp`.
  describe('last activity of a case', () => {
    it('moves when an observation is added', async () => {
      const db = caseDb();

      await serviceOn(db).addNote(7, '  Se REINICIÓ el servicio ', user);

      expect(db.ticketNote.create).toHaveBeenCalledWith({
        data: { ticketId: 7, text: 'Se REINICIÓ el servicio', searchText: 'se reinicio el servicio', authorId: 1 },
      });
      expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { lastActivityAt: NOW } });
    });

    it('does not move when an observation is deleted', async () => {
      const db = caseDb();

      await serviceOn(db).removeNote(7, 4);

      expect(db.ticketNote.deleteMany).toHaveBeenCalledWith({ where: { id: 4, ticketId: 7 } });
      expect(db.ticket.update).not.toHaveBeenCalled();
      expect(db.ticket.updateMany).not.toHaveBeenCalled();
    });

    it('moves when the message for the client is saved', async () => {
      const db = caseDb();

      await serviceOn(db).saveCustomerReply(7, ' Listo ');

      expect(db.ticket.updateMany).toHaveBeenCalledWith({ where: { id: 7 }, data: { customerReply: 'Listo', lastActivityAt: NOW } });
    });

    it('moves when the timer starts', async () => {
      const db = caseDb();

      await serviceOn(db).startTimer(7);

      expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { timerStartedAt: NOW, lastActivityAt: NOW } });
    });

    it('moves when the timer stops, which adds its minutes', async () => {
      const started = new Date(NOW.getTime() - 25 * 60_000);
      const db = caseDb(row({ spentMinutes: 10, timerStartedAt: started }));

      await serviceOn(db).stopTimer(7);

      expect(db.ticket.updateMany).toHaveBeenCalledWith({
        where: { id: 7, timerStartedAt: started },
        data: { timerStartedAt: null, spentMinutes: { increment: 25 }, lastActivityAt: NOW },
      });
      expect(db.ticket.update).not.toHaveBeenCalled();
    });

    it('does not move when the timer was already in the state asked for', async () => {
      const running = caseDb(row({ timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) }));
      await serviceOn(running).startTimer(7);
      expect(running.ticket.update).not.toHaveBeenCalled();

      const stopped = caseDb();
      await serviceOn(stopped).stopTimer(7);
      expect(stopped.ticket.update).not.toHaveBeenCalled();
      expect(stopped.ticket.updateMany).not.toHaveBeenCalled();
    });
  });

  // A stop reads the case, then writes. Another request can change the timer in between: these let
  // it happen at that moment, over a case stored as the database would keep it.
  describe('a stop of the timer that another request overtakes', () => {
    const STARTED = new Date(NOW.getTime() - 25 * 60_000);

    /**
     * One case, stored: its timer running for 25 minutes with 10 spent. `meanwhile` runs once,
     * after the first read and before the first write, as another request would.
     */
    function racedDb(meanwhile: (stored: Record<string, unknown>) => void) {
      const current = row({ spentMinutes: 10, timerStartedAt: STARTED });
      let pending: ((stored: Record<string, unknown>) => void) | null = meanwhile;
      const interrupt = () => {
        pending?.(current);
        pending = null;
      };
      type Write = { where: { id: number; timerStartedAt?: Date }; data: { timerStartedAt: null; spentMinutes: number | { increment: number }; lastActivityAt: Date } };
      const apply = (data: Write['data']) => {
        const spent = data.spentMinutes;
        Object.assign(current, data, { spentMinutes: typeof spent === 'number' ? spent : (current.spentMinutes as number) + spent.increment });
      };
      return {
        current,
        ticket: {
          findUnique: jest.fn(() => Promise.resolve({ ...current })),
          // As Prisma: `update` writes whatever is there, `updateMany` only the rows its filter still finds.
          update: jest.fn(({ data }: Write) => {
            interrupt();
            apply(data);
            return Promise.resolve({ ...current });
          }),
          updateMany: jest.fn(({ where, data }: Write) => {
            interrupt();
            const matches = where.timerStartedAt === undefined || (current.timerStartedAt as Date | null)?.getTime() === where.timerStartedAt.getTime();
            if (matches) apply(data);
            return Promise.resolve({ count: matches ? 1 : 0 });
          }),
        },
      };
    }

    it('adds the minutes once when another stop got there first', async () => {
      const db = racedDb((stored) => Object.assign(stored, { timerStartedAt: null, spentMinutes: 35 }));

      const answer = await serviceOn(db).stopTimer(7);

      expect(db.current).toMatchObject({ timerStartedAt: null, spentMinutes: 35 });
      expect(answer).toMatchObject({ timerStartedAt: null, spentMinutes: 35 });
    });

    it('leaves running a timer started again after the one it read was stopped', async () => {
      const restarted = new Date(NOW.getTime() - 60_000);
      const db = racedDb((stored) => Object.assign(stored, { timerStartedAt: restarted, spentMinutes: 35 }));

      const answer = await serviceOn(db).stopTimer(7);

      expect(db.current).toMatchObject({ timerStartedAt: restarted, spentMinutes: 35 });
      expect(answer).toMatchObject({ timerStartedAt: restarted, spentMinutes: 35 });
    });

    it('keeps an edit of the time spent made while it ran, and adds its minutes to it', async () => {
      const db = racedDb((stored) => Object.assign(stored, { spentMinutes: 50 }));

      await serviceOn(db).stopTimer(7);

      expect(db.current).toMatchObject({ timerStartedAt: null, spentMinutes: 75 });
    });
  });

  describe('a case that does not exist', () => {
    const missing = new Prisma.PrismaClientKnownRequestError('No record was found for a delete.', { code: 'P2025', clientVersion: Prisma.prismaVersion.client });
    const deleteDb = (failure: Error) => ({
      attachment: { findMany: jest.fn().mockResolvedValue([]) },
      ticket: { delete: jest.fn().mockRejectedValue(failure) },
    });

    it('answers 404 "El caso no existe" when it is deleted', async () => {
      const failure = await serviceOn(deleteDb(missing)).remove(99).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).toHaveProperty('message', 'El caso no existe');
    });

    it('lets any other failure of the delete through as it is', async () => {
      const broken = new Error('connection lost');

      await expect(serviceOn(deleteDb(broken)).remove(7)).rejects.toBe(broken);
    });

    it('answers 404 "El caso no existe" when the message for the client is saved', async () => {
      const failure = await serviceOn(caseDb(null)).saveCustomerReply(99, 'Listo').catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).toHaveProperty('message', 'El caso no existe');
    });
  });

  describe('create', () => {
    /** What the service stores for this input. */
    const created = async (db: ReturnType<typeof caseDb>, input: Partial<TicketInput>): Promise<Record<string, unknown>> => {
      await serviceOn(db).create({ companyId: 2, description: 'No abre', ...input }, user);
      return (db.ticket.create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;
    };

    it('reads a null as "not sent" in the fields a case cannot be left without', async () => {
      const db = caseDb();
      const dto = { companyId: 2, description: ' No abre ', date: null, status: null, spentMinutes: null, supportTypeIds: null, archived: null, aiGenerated: null, note: null };

      await serviceOn(db).create(dto as unknown as TicketInput, user);

      expect(db.ticket.create.mock.calls).toMatchObject([
        [
          {
            data: {
              date: TODAY,
              companyId: 2,
              description: 'No abre',
              searchText: 'acme no abre',
              status: 'PENDING',
              spentMinutes: 0,
              assigneeId: null,
              supportTypes: undefined,
              archivedAt: null,
              aiGenerated: false,
              createdById: 1,
              lastActivityAt: NOW,
              notes: undefined,
            },
          },
        ],
      ]);
    });

    // The search box matches the name of the company, which the case no longer carries as text.
    it('takes the search key from the name the company has in the catalog', async () => {
      const db = caseDb();

      expect(await created(db, { companyId: 5, description: 'No abre la Facturación' })).toMatchObject({
        companyId: 5,
        searchText: 'corporacion nandu no abre la facturacion',
      });
      expect(db.company.findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { name: true } });
    });

    // Whoever registers a case used to take it. Users are not responsibles any more: id 1 only registers it.
    it('leaves the case without a responsible unless one is chosen', async () => {
      expect(await created(caseDb(), {})).toMatchObject({ assigneeId: null, createdById: 1 });
      expect(await created(caseDb(), { assigneeId: null })).toMatchObject({ assigneeId: null });
    });

    it('gives the case to the responsible chosen', async () => {
      const db = caseDb();

      expect(await created(db, { assigneeId: 9 })).toMatchObject({ assigneeId: 9 });
      expect(db.assignee.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { name: true } });
    });

    it('refuses a responsible that is not in the catalog', async () => {
      const db = caseDb();
      db.assignee.findUnique.mockResolvedValue(null);

      await expect(serviceOn(db).create({ companyId: 2, description: 'No abre', assigneeId: 9 }, user)).rejects.toThrow('El responsable no existe');
      expect(db.ticket.create).not.toHaveBeenCalled();
    });

    it('refuses a case without company, saying that it is required', async () => {
      const db = caseDb();
      const service = serviceOn(db);

      for (const companyId of [undefined, null]) {
        const failure = await service.create({ companyId, description: 'No abre' } as unknown as TicketInput, user).catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(BadRequestException);
        expect(failure).toHaveProperty('message', 'La empresa es obligatoria');
      }
      expect(db.ticket.create).not.toHaveBeenCalled();
    });

    it('refuses a company that is not in the catalog', async () => {
      const db = caseDb();

      const failure = await serviceOn(db).create({ companyId: 99, description: 'No abre' }, user).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure).toHaveProperty('message', 'La empresa no existe');
      expect(db.ticket.create).not.toHaveBeenCalled();
    });

    it('refuses a case without description', async () => {
      const db = caseDb();
      const service = serviceOn(db);

      for (const description of [undefined, null, '', '   ']) {
        await expect(service.create({ companyId: 2, description } as unknown as TicketInput, user)).rejects.toThrow('La descripción es obligatoria');
      }
      expect(db.ticket.create).not.toHaveBeenCalled();
    });

    describe('support types', () => {
      it('gives the case the types chosen, each once however many times its id is sent', async () => {
        const db = caseDb();

        expect(await created(db, { supportTypeIds: [2, 1, 2] })).toMatchObject({
          supportTypes: { create: [{ supportTypeId: 2 }, { supportTypeId: 1 }] },
        });
        expect(db.supportType.findMany).toHaveBeenCalledWith({ where: { id: { in: [2, 1] } }, select: { id: true, name: true } });
      });

      it('registers a case without types when none is sent, or an empty list', async () => {
        const none = caseDb();
        expect((await created(none, {})).supportTypes).toBeUndefined();
        expect((await created(caseDb(), { supportTypeIds: [] })).supportTypes).toBeUndefined();
        // Nothing to look up in the catalog.
        expect(none.supportType.findMany).not.toHaveBeenCalled();
      });

      it('refuses a type that is not in the catalog, and registers nothing', async () => {
        const db = caseDb();

        const failure = await serviceOn(db).create({ companyId: 2, description: 'No abre', supportTypeIds: [1, 99] }, user).catch((error: unknown) => error);

        expect(failure).toBeInstanceOf(BadRequestException);
        expect(failure).toHaveProperty('message', 'El tipo de soporte no existe');
        expect(db.ticket.create).not.toHaveBeenCalled();
      });
    });

    it('registers a case already archived when asked to', async () => {
      expect(await created(caseDb(), { archived: true })).toMatchObject({ archivedAt: NOW });
      expect(await created(caseDb(), { archived: false })).toMatchObject({ archivedAt: null });
    });
  });

  describe('update', () => {
    /** The case the edit writes, and the history lines that go with it. */
    const written = (db: ReturnType<typeof caseDb>): { data: Record<string, unknown>; history: unknown } => ({
      data: (db.ticket.update.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data,
      history: (db.ticketHistory.createMany.mock.calls[0] as [{ data: unknown }])[0].data,
    });

    it('writes the edit and its history lines together, signed by who made it', async () => {
      const db = caseDb();

      await serviceOn(db).update(7, { companyId: 5, assigneeId: 9 }, user);

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.ticket.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { lastActivityAt: NOW, companyId: 5, searchText: 'corporacion nandu no abre la factura', assigneeId: 9 },
      });
      expect(written(db).history).toEqual([
        { field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú', ticketId: 7, userId: 1 },
        { field: 'Responsable', oldValue: 'Ana', newValue: 'Luis', ticketId: 7, userId: 1 },
      ]);
    });

    it('replaces the support types of the case with the ones sent, a repeated id counting once', async () => {
      const db = caseDb(row({ supportTypes: carrying(TRAINING, FAILURE) }));

      await serviceOn(db).update(7, { supportTypeIds: [3, 2, 3] }, user);

      expect(written(db).data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [1] } }, createMany: { data: [{ supportTypeId: 3 }] } });
      expect(written(db).history).toEqual([
        { field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: 'Error de usuario, Falla del sistema', ticketId: 7, userId: 1 },
      ]);
    });

    it('takes every type off the case with an empty list', async () => {
      const db = caseDb(row({ supportTypes: carrying(TRAINING, FAILURE) }));

      await serviceOn(db).update(7, { supportTypeIds: [] }, user);

      expect(written(db).data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [1, 2] } }, createMany: undefined });
      expect(written(db).history).toEqual([{ field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: null, ticketId: 7, userId: 1 }]);
    });

    it('leaves the types as they are when the list is not sent', async () => {
      const db = caseDb(row({ supportTypes: carrying(TRAINING) }));

      await serviceOn(db).update(7, { status: 'RESOLVED' }, user);

      expect(written(db).data).not.toHaveProperty('supportTypes');
      expect(db.supportType.findMany).not.toHaveBeenCalled();
    });

    it.each([
      [{ supportTypeIds: [2, 99] }, 'El tipo de soporte no existe'],
      [{ companyId: 99 }, 'La empresa no existe'],
    ])('refuses %j, which is not in the catalog, and writes nothing', async (input, message) => {
      const db = caseDb(row({ supportTypes: carrying(TRAINING) }));

      const failure = await serviceOn(db).update(7, input, user).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(BadRequestException);
      expect(failure).toHaveProperty('message', message);
      expect(db.ticket.update).not.toHaveBeenCalled();
      expect(db.ticketHistory.createMany).not.toHaveBeenCalled();
    });

    it('archives a case without moving its last activity, and says so in the history', async () => {
      const db = caseDb();

      await serviceOn(db).update(7, { archived: true }, user);

      expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { archivedAt: NOW } });
      expect(written(db).history).toEqual([{ field: 'Archivado', oldValue: 'No', newValue: 'Sí', ticketId: 7, userId: 1 }]);
    });

    it('answers 404 "El caso no existe" for a case that is not there', async () => {
      const db = caseDb(null);

      const failure = await serviceOn(db).update(99, { archived: true }, user).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).toHaveProperty('message', 'El caso no existe');
      expect(db.ticket.update).not.toHaveBeenCalled();
    });
  });

  // A column the cases are filtered or ordered by without an index makes every list, export and
  // reminder that uses it read the whole table. The exports and the dashboard filter with the same
  // `buildWhere` as the list, so the list with every filter and every order, and the bell, cover them.
  describe('indexes of the database', () => {
    type Model = { fields: Map<string, string>; indexed: Set<string> };
    type Query = { where: Record<string, unknown>; orderBy: Record<string, unknown> | Record<string, unknown>[] };
    /** Used without an index on purpose. */
    const UNINDEXED = [
      // Four values, each a large part of the cases: through an index PostgreSQL still reads most of
      // the table, and counts them no faster (measured on 200,000 cases).
      'Ticket.priority',
      // Searched with `contains`, anywhere in the text: an index finds only what a text starts with.
      'Ticket.searchText',
      'TicketNote.searchText',
    ];

    /** The models of prisma/schema.prisma: the type of each field, and the fields an index starts with. */
    function schemaModels(): Map<string, Model> {
      const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');
      const models = new Map<string, Model>();
      for (const [, name, body] of schema.matchAll(/^model (\w+) \{\r?\n([\s\S]*?)^\}/gm)) {
        const model: Model = { fields: new Map(), indexed: new Set() };
        for (const line of body.split(/\r?\n/).map((text) => text.trim())) {
          const index = /^@@(?:id|index|unique)\(\[(\w+)/.exec(line);
          const field = /^(\w+)\s+(\w+)/.exec(line);
          if (index) model.indexed.add(index[1]);
          else if (field) {
            model.fields.set(field[1], field[2]);
            if (/\s@(?:id|unique)\b/.test(line)) model.indexed.add(field[1]);
          }
        }
        models.set(name, model);
      }
      return models;
    }

    /** `Model.field` of each column `where` compares, the ones of a relation under the model of the relation. */
    function filtered(models: Map<string, Model>, model: string, where: Record<string, unknown>, columns: Set<string>): void {
      for (const [key, value] of Object.entries(where)) {
        const related = models.get(model)?.fields.get(key);
        if (['AND', 'OR', 'NOT'].includes(key)) {
          for (const part of [value].flat() as Record<string, unknown>[]) filtered(models, model, part, columns);
        } else if (related && models.has(related)) {
          // Under `some`, `every`, `none` or `is`: a filter of the related model.
          for (const part of Object.values(value as object) as Record<string, unknown>[]) filtered(models, related, part, columns);
        } else columns.add(`${model}.${key}`);
      }
    }

    /** `Model.field` an order starts with. What comes after it only breaks ties. */
    function orderedBy(models: Map<string, Model>, model: string, orderBy: Query['orderBy']): string {
      const [[key, value]] = Object.entries([orderBy].flat()[0]);
      const related = models.get(model)?.fields.get(key);
      return related && models.has(related) ? orderedBy(models, related, value as Query['orderBy']) : `${model}.${key}`;
    }

    /** What the list of cases asks for with every filter, in each of its orders, and what the bell asks for. */
    async function queries(): Promise<Query[]> {
      // Required: a new filter does not compile until it is added here.
      const every: Required<TicketFilters> = {
        status: ['PENDING'],
        assignee: 3,
        companyId: 2,
        priority: 'HIGH',
        moduleId: 4,
        supportType: 1,
        createdBy: 1,
        archived: 'only',
        from: '2026-11-01',
        to: '2026-11-30',
        overdue: true,
        stale: true,
        promise: 'due',
        q: 'SOP-00012',
        sort: 'date',
        dir: 'asc',
        page: 1,
        pageSize: 50,
      };
      const list = listDb([]);
      for (const sort of [undefined, 'date', 'company', 'status'] as const) await serviceOn(list).list({ ...every, sort });
      const bell = { ticket: { findMany: jest.fn().mockResolvedValue([]) } };
      await serviceOn(bell).reminders();
      return [list.ticket.findMany, bell.ticket.findMany].flatMap((findMany) => (findMany.mock.calls as [Query][]).map(([query]) => query));
    }

    it('has one for each column the list, with any filter or order, and the bell filter or order the cases by', async () => {
      const models = schemaModels();
      const used = new Set<string>();
      for (const { where, orderBy } of await queries()) {
        filtered(models, 'Ticket', where, used);
        used.add(orderedBy(models, 'Ticket', orderBy));
      }

      const unindexed = [...used].filter((column) => {
        const [model, field] = column.split('.');
        return !models.get(model)?.indexed.has(field);
      });
      // Both ways: a column left out on purpose that is no longer used, or got an index, leaves the list too.
      expect(unindexed.sort()).toEqual([...UNINDEXED].sort());
    });
  });
});
