import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from '../common/auth';
import { noteSearchKey, ticketSearchKey } from '../common/labels';
import type { PrismaService } from '../prisma.service';
import type { SettingsService } from '../settings/settings.service';
import { TicketInput, TicketsService, parseTicketFilters, planTicketUpdate, promiseState, ticketOrder } from './tickets.service';
import type { PromiseState, StoredTicket, TicketUpdateContext } from './tickets.service';

/** Built from local time, so "today" is 11/11/2026 whatever time zone the tests run in. */
const NOW = new Date(2026, 10, 11, 10, 0, 0);
const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const TODAY = day('2026-11-11');

/** A case as stored. */
const stored = (changes: Partial<StoredTicket> = {}): StoredTicket => ({
  id: 7,
  date: day('2026-11-02'),
  time: null,
  company: 'ACME',
  description: 'No abre la factura',
  searchText: 'acme no abre la factura',
  status: 'PENDING',
  assigneeId: 3,
  assignee: { id: 3, name: 'Ana' },
  assignedToClient: false,
  priority: null,
  estimatedMinutes: null,
  spentMinutes: 10,
  timerStartedAt: null,
  moduleId: null,
  module: null,
  dueAt: null,
  promisedDate: null,
  resolvedAt: null,
  aiGenerated: false,
  customerReply: null,
  createdById: 3,
  createdAt: new Date('2026-11-02T14:00:00.000Z'),
  lastActivityAt: new Date('2026-11-03T09:00:00.000Z'),
  updatedAt: new Date('2026-11-03T09:00:00.000Z'),
  ...changes,
});

describe('ticket list filters', () => {
  describe('parseTicketFilters', () => {
    it('reads every parameter of the list', () => {
      expect(
        parseTicketFilters({
          status: 'PENDING',
          assignee: '12',
          company: '  ACME  ',
          priority: 'HIGH',
          moduleId: '4',
          from: '2026-01-01',
          to: '2026-01-31',
          overdue: '1',
          stale: '1',
          promise: 'due',
          q: 'factura',
          sort: 'company',
          dir: 'asc',
          page: '3',
          pageSize: '25',
        }),
      ).toEqual({
        status: ['PENDING'],
        assignee: 12,
        company: 'ACME',
        priority: 'HIGH',
        moduleId: 4,
        from: '2026-01-01',
        to: '2026-01-31',
        overdue: true,
        stale: true,
        promise: 'due',
        q: 'factura',
        sort: 'company',
        dir: 'asc',
        page: 3,
        pageSize: 25,
      });
    });

    it('reads the two words the responsible filter accepts besides a person', () => {
      expect(parseTicketFilters({ assignee: 'client' }).assignee).toBe('client');
      expect(parseTicketFilters({ assignee: 'none' }).assignee).toBe('none');
    });

    it('takes several statuses, separated by commas or by repeating the parameter', () => {
      expect(parseTicketFilters({ status: 'RESOLVED,PENDING' }).status).toEqual(['PENDING', 'RESOLVED']);
      expect(parseTicketFilters({ status: ['RESOLVED', 'PENDING'] }).status).toEqual(['PENDING', 'RESOLVED']);
      expect(parseTicketFilters({ status: ['RESOLVED, PENDING', 'RESOLVED', 'CERRADO'] }).status).toEqual(['PENDING', 'RESOLVED']);
    });

    it('uses the first value of any other repeated parameter', () => {
      expect(parseTicketFilters({ company: ['ACME', 'Otra'], assignee: ['7', '8'], from: ['2026-01-01', '2026-02-01'], page: ['2', '9'] })).toEqual({
        company: 'ACME',
        assignee: 7,
        from: '2026-01-01',
        page: 2,
      });
    });

    it('refuses an end of the date range that is not a real day written YYYY-MM-DD, naming the filter', () => {
      const refused = (label: string): string => `El filtro "${label}" no es válido. Debe ser una fecha real con el formato AAAA-MM-DD.`;
      for (const value of ['2026-13-45', '2026-02-30', '2026-02-29', '2026-2-3', '03/02/2026', '2026-01-01T00:00:00Z', 'ayer']) {
        expect(() => parseTicketFilters({ from: value })).toThrow(BadRequestException);
        expect(() => parseTicketFilters({ from: value })).toThrow(refused('Desde'));
        expect(() => parseTicketFilters({ to: value })).toThrow(refused('Hasta'));
      }
      // The valid end does not save the other one: the range is never applied by halves.
      expect(() => parseTicketFilters({ from: '2026-09-01', to: '2026-09-31' })).toThrow(refused('Hasta'));
      expect(() => parseTicketFilters({ from: ['2026-02-30', '2026-02-01'] })).toThrow(refused('Desde'));
    });

    it('reads real days, and takes an absent or empty end of the range as not sent', () => {
      expect(parseTicketFilters({ from: '2024-02-29', to: '2026-12-31' })).toEqual({ from: '2024-02-29', to: '2026-12-31' });
      expect(parseTicketFilters({ to: ' 2026-12-31 ' })).toEqual({ to: '2026-12-31' });
      expect(parseTicketFilters({ from: '', to: '   ' })).toEqual({});
    });

    it('drops unknown values', () => {
      expect(
        parseTicketFilters({
          status: 'ABIERTO',
          assignee: 'yo',
          company: '   ',
          priority: 'URGENT',
          moduleId: '1.5',
          overdue: 'true',
          stale: 'si',
          promise: 'pronto',
          q: '',
          sort: 'id',
          dir: 'up',
          page: '-2',
          pageSize: 'muchos',
          other: 'x',
        }),
      ).toEqual({});
    });

    it('drops values that are not text without throwing', () => {
      expect(parseTicketFilters({ status: { a: 'PENDING' }, company: 5, q: [{}, null], page: null, from: [] })).toEqual({});
    });

    it('limits the page size and treats 0 as not sent', () => {
      expect(parseTicketFilters({ pageSize: '9999' }).pageSize).toBe(500);
      expect(parseTicketFilters({ page: '0', pageSize: '0' })).toEqual({});
    });
  });

  describe('ticketOrder', () => {
    it('orders by ticket number, newest first, unless a field is chosen', () => {
      expect(ticketOrder({})).toEqual([{ id: 'desc' }]);
      expect(ticketOrder({ dir: 'asc' })).toEqual([{ id: 'asc' }]);
      expect(ticketOrder({ sort: 'company', dir: 'asc' })).toEqual([{ company: 'asc' }, { id: 'asc' }]);
      // By date, the time of the case orders the cases of one day; the ones without a time go after them.
      expect(ticketOrder({ sort: 'date' })).toEqual([{ date: 'desc' }, { time: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]);
      expect(ticketOrder({ sort: 'date', dir: 'asc' })).toEqual([{ date: 'asc' }, { time: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
    });
  });

  describe('buildWhere', () => {
    // buildWhere only turns filters into a query: it never touches the database or the settings.
    const service = new TicketsService({} as PrismaService, {} as SettingsService);
    const open = { status: { not: 'RESOLVED' } };
    const none = { id: -1 };

    beforeAll(() => jest.useFakeTimers({ now: NOW }));
    afterAll(() => jest.useRealTimers());

    it('does not filter without filters', () => {
      expect(service.buildWhere({})).toEqual({});
      expect(service.buildWhere(parseTicketFilters({ status: ['a', 'b'], from: '', priority: 'URGENT' }))).toEqual({});
    });

    it('finds forgotten cases: open and without activity since the cutoff', () => {
      const staleBefore = new Date(2026, 10, 9, 10, 0, 0);
      expect(service.buildWhere({ stale: true }, { staleBefore, promiseSoonDays: 0 })).toEqual({
        AND: [{ ...open, lastActivityAt: { lt: staleBefore } }],
      });
    });

    it('finds no forgotten case when that reminder is off', () => {
      expect(service.buildWhere({ stale: true }, { staleBefore: null, promiseSoonDays: 0 })).toEqual({ AND: [none] });
      expect(service.buildWhere({ stale: true })).toEqual({ AND: [none] });
    });

    it('filters by where the promised delivery date stands', () => {
      const rules = { staleBefore: null, promiseSoonDays: 3 };
      const soonLimit = day('2026-11-14');
      expect(service.buildWhere({ promise: 'any' }, rules)).toEqual({ AND: [{ promisedDate: { not: null } }] });
      expect(service.buildWhere({ promise: 'overdue' }, rules)).toEqual({ AND: [{ ...open, promisedDate: { lt: TODAY } }] });
      expect(service.buildWhere({ promise: 'today' }, rules)).toEqual({ AND: [{ ...open, promisedDate: TODAY }] });
      expect(service.buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [{ ...open, promisedDate: { gt: TODAY, lte: soonLimit } }] });
      expect(service.buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [{ ...open, promisedDate: { lte: soonLimit } }] });
    });

    it('has no "soon" promises without advance notice, and "due" then ends today', () => {
      const rules = { staleBefore: null, promiseSoonDays: 0 };
      expect(service.buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [none] });
      expect(service.buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [{ ...open, promisedDate: { lte: TODAY } }] });
    });
  });

  describe('promiseState', () => {
    beforeAll(() => jest.useFakeTimers({ now: NOW }));
    afterAll(() => jest.useRealTimers());

    const state = (promisedDate: string | null, soonDays = 0, status: StoredTicket['status'] = 'PENDING'): PromiseState | null =>
      promiseState({ status, promisedDate: promisedDate ? day(promisedDate) : null }, soonDays);

    it('is null without a promise or once the case is resolved', () => {
      expect(state(null)).toBeNull();
      expect(state('2026-11-01', 3, 'RESOLVED')).toBeNull();
    });

    it('is overdue after the promised day and today on it', () => {
      expect(state('2026-11-10')).toBe('overdue');
      expect(state('2026-11-11')).toBe('today');
      expect(state('2026-11-10', 3, 'UNRESOLVED')).toBe('overdue');
    });

    it('is soon within the advance notice and later beyond it', () => {
      expect(state('2026-11-12', 3)).toBe('soon');
      expect(state('2026-11-14', 3)).toBe('soon');
      expect(state('2026-11-15', 3)).toBe('later');
    });

    it('is never soon when advance notice is off', () => {
      expect(state('2026-11-12', 0)).toBe('later');
    });
  });
});

/** What the person would read for this request body: the messages of the 400, none when it is accepted. */
const errors = async (input: Record<string, unknown>): Promise<string[]> =>
  (await validate(plainToInstance(TicketInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

describe('ticket input dates', () => {
  it('accepts real days written YYYY-MM-DD, and null to remove the promise', async () => {
    expect(await errors({ date: '2026-11-02', promisedDate: '2028-02-29' })).toEqual([]);
    expect(await errors({ promisedDate: null })).toEqual([]);
  });

  it('rejects days that do not exist, with a message in Spanish', async () => {
    expect(await errors({ date: '2026-13-45' })).toEqual(['La fecha del caso no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.']);
    expect(await errors({ promisedDate: '2026-02-30' })).toEqual([
      'La promesa de entrega no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.',
    ]);
  });

  it('rejects any other way of writing a date', async () => {
    for (const date of ['2/11/2026', '2026-11-2', '2026-11-02T10:00:00Z', '', 20261102]) {
      expect(await errors({ date })).toHaveLength(1);
    }
  });
});

describe('ticket input limits', () => {
  it('says in Spanish which text is too long', async () => {
    expect(await errors({ company: 'x'.repeat(201) })).toEqual(['La empresa no puede tener más de 200 caracteres']);
    expect(await errors({ description: 'x'.repeat(5001) })).toEqual(['La descripción no puede tener más de 5000 caracteres']);
    expect(await errors({ customerReply: 'x'.repeat(5001) })).toEqual(['La respuesta para el cliente no puede tener más de 5000 caracteres']);
    expect(await errors({ note: 'x'.repeat(5001) })).toEqual(['La observación no puede tener más de 5000 caracteres']);
    expect(await errors({ company: 'x'.repeat(200), description: 'x'.repeat(5000), customerReply: 'x'.repeat(5000), note: 'x'.repeat(5000) })).toEqual([]);
  });

  it('says in Spanish that the minutes are out of range', async () => {
    const estimated = 'El tiempo estimado debe estar entre 0 y 1000000 minutos';
    const spent = 'El tiempo real debe estar entre 0 y 1000000 minutos';
    expect(await errors({ estimatedMinutes: 1_000_001 })).toEqual([estimated]);
    expect(await errors({ estimatedMinutes: -1 })).toEqual([estimated]);
    expect(await errors({ spentMinutes: 1_000_001 })).toEqual([spent]);
    expect(await errors({ spentMinutes: -1 })).toEqual([spent]);
    expect(await errors({ estimatedMinutes: 0, spentMinutes: 1_000_000 })).toEqual([]);
  });

  it('refuses the id of a person or of a module that no record can have', async () => {
    // Beyond 2147483647 the database cannot even hold the number.
    for (const id of [0, -1, 2_147_483_648, 99_999_999_999]) {
      expect(await errors({ assigneeId: id })).toEqual(['El responsable no existe']);
      expect(await errors({ moduleId: id })).toEqual(['El módulo no existe']);
    }
    expect(await errors({ assigneeId: 1, moduleId: 2_147_483_647 })).toEqual([]);
  });

  it('still accepts null where it removes the value', async () => {
    expect(await errors({ assigneeId: null, moduleId: null, priority: null, estimatedMinutes: null, promisedDate: null, customerReply: null })).toEqual([]);
  });
});

describe('search keys', () => {
  it('joins company and description of a case without accents or case', () => {
    expect(ticketSearchKey('CORPORACIÓN Ñandú', 'No abre  la Facturación')).toBe('corporacion nandu no abre la facturacion');
  });

  it('strips accents and case from an observation', () => {
    expect(noteSearchKey('  Se REINICIÓ el servicio ')).toBe('se reinicio el servicio');
  });
});

describe('ticket input time', () => {
  it('accepts a time of day written HH:MM on the 24-hour clock, and null to remove it', async () => {
    for (const time of ['00:00', '08:05', '14:35', '23:59']) expect(await errors({ time })).toEqual([]);
    expect(await errors({ time: null })).toEqual([]);
    expect(await errors({})).toEqual([]);
  });

  it('rejects anything else, with a message in Spanish', async () => {
    for (const time of ['24:00', '14:60', '2:35', '14:35:10', '2:35 pm', '1435', '', 1435]) {
      expect(await errors({ time })).toEqual(['La hora del caso no es válida. Usa el formato HH:MM, de 00:00 a 23:59.']);
    }
  });
});

describe('planTicketUpdate', () => {
  const context = (changes: Partial<TicketUpdateContext> = {}): TicketUpdateContext => ({
    now: NOW,
    assigneeName: null,
    moduleName: null,
    slaHours: null,
    ...changes,
  });
  const clientCase = { assignedToClient: true, assigneeId: null, assignee: null };

  it('writes only the activity mark when nothing is sent', () => {
    expect(planTicketUpdate(stored(), {}, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
  });

  describe('status', () => {
    it('sets resolvedAt when the case is resolved', () => {
      const { data, history } = planTicketUpdate(stored(), { status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ status: 'RESOLVED', resolvedAt: NOW });
      expect(history).toEqual([{ field: 'Estado', oldValue: 'Pendiente', newValue: 'Resuelto' }]);
    });

    it('clears resolvedAt when the case is reopened', () => {
      const resolved = stored({ status: 'RESOLVED', resolvedAt: new Date('2026-11-05T12:00:00.000Z') });
      const { data, history } = planTicketUpdate(resolved, { status: 'UNRESOLVED' }, context());
      expect(data).toMatchObject({ status: 'UNRESOLVED', resolvedAt: null });
      expect(history).toEqual([{ field: 'Estado', oldValue: 'Resuelto', newValue: 'Sin resolver' }]);
    });

    it('leaves resolvedAt alone when the status sent is the one the case has', () => {
      const resolved = stored({ status: 'RESOLVED', resolvedAt: new Date('2026-11-05T12:00:00.000Z') });
      const { data, history } = planTicketUpdate(resolved, { status: 'RESOLVED' }, context());
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('resolvedAt');
      expect(history).toEqual([]);
    });

    it('stops a running timer when the case is resolved and adds its minutes', () => {
      const running = stored({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      const { data } = planTicketUpdate(running, { status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ spentMinutes: 35, timerStartedAt: null });
    });

    it('keeps the minutes of the stopped timer over the minutes typed in the same edit', () => {
      const running = stored({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      expect(planTicketUpdate(running, { status: 'RESOLVED', spentMinutes: 99 }, context()).data.spentMinutes).toBe(35);
      expect(planTicketUpdate(stored(), { status: 'RESOLVED', spentMinutes: 99 }, context()).data.spentMinutes).toBe(99);
    });

    it('leaves the timer running on any other status change', () => {
      const running = stored({ timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      const { data } = planTicketUpdate(running, { status: 'UNRESOLVED' }, context());
      expect(data).not.toHaveProperty('timerStartedAt');
      expect(data).not.toHaveProperty('spentMinutes');
    });
  });

  describe('responsible', () => {
    it('clears the person when the client becomes responsible', () => {
      const { data, history } = planTicketUpdate(stored(), { assignedToClient: true }, context());
      expect(data).toMatchObject({ assignedToClient: true, assigneeId: null });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: 'Cliente' }]);
    });

    it('clears "Cliente" when a person is chosen', () => {
      const { data, history } = planTicketUpdate(stored(clientCase), { assigneeId: 5 }, context({ assigneeName: 'Luis' }));
      expect(data).toMatchObject({ assignedToClient: false, assigneeId: 5 });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Cliente', newValue: 'Luis' }]);
    });

    it('prefers "Cliente" when both arrive together', () => {
      const { data, history } = planTicketUpdate(stored(), { assignedToClient: true, assigneeId: 5 }, context({ assigneeName: 'Luis' }));
      expect(data).toMatchObject({ assignedToClient: true, assigneeId: null });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: 'Cliente' }]);
    });

    it('leaves the case without responsible when the person is removed', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeId: null }, context());
      expect(data).toMatchObject({ assignedToClient: false, assigneeId: null });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: null }]);
    });

    it('keeps "Cliente" when only the person is removed', () => {
      const { data, history } = planTicketUpdate(stored(clientCase), { assigneeId: null }, context());
      expect(data).toMatchObject({ assignedToClient: true, assigneeId: null });
      expect(history).toEqual([]);
    });

    it('keeps the person when "Cliente" is switched off on a case that had a person', () => {
      const { data, history } = planTicketUpdate(stored(), { assignedToClient: false }, context());
      expect(data).toMatchObject({ assignedToClient: false, assigneeId: 3 });
      expect(history).toEqual([]);
    });
  });

  describe('priority', () => {
    it('recomputes the deadline from the registration of the case', () => {
      const { data, history } = planTicketUpdate(stored(), { priority: 'HIGH' }, context({ slaHours: 8 }));
      expect(data).toMatchObject({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      expect(history).toEqual([{ field: 'Prioridad', oldValue: null, newValue: 'Alta' }]);
    });

    it('removes the deadline when the priority is removed or has no SLA', () => {
      const urgent = stored({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      const removed = planTicketUpdate(urgent, { priority: null }, context());
      expect(removed.data).toMatchObject({ priority: null, dueAt: null });
      expect(removed.history).toEqual([{ field: 'Prioridad', oldValue: 'Alta', newValue: null }]);
      expect(planTicketUpdate(urgent, { priority: 'LOW' }, context({ slaHours: null })).data).toMatchObject({ priority: 'LOW', dueAt: null });
    });

    it('leaves the deadline alone when the priority sent is the one the case has', () => {
      const urgent = stored({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      const { data, history } = planTicketUpdate(urgent, { priority: 'HIGH' }, context({ slaHours: 24 }));
      expect(data).not.toHaveProperty('dueAt');
      expect(history).toEqual([]);
    });
  });

  describe('time of the case', () => {
    it('sets the time and writes it in the history', () => {
      const { data, history } = planTicketUpdate(stored(), { time: '14:35' }, context());
      expect(data.time).toBe('14:35');
      expect(history).toEqual([{ field: 'Hora del caso', oldValue: null, newValue: '14:35' }]);
    });

    // Unlike the date, a case can be left without a time.
    it('removes the time with null', () => {
      const { data, history } = planTicketUpdate(stored({ time: '14:35' }), { time: null }, context());
      expect(data.time).toBeNull();
      expect(history).toEqual([{ field: 'Hora del caso', oldValue: '14:35', newValue: null }]);
    });

    it('does nothing when the time sent is the one the case has, or when none is sent', () => {
      const timed = stored({ time: '14:35' });
      expect(planTicketUpdate(timed, { time: '14:35' }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(timed, { priority: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(stored(), { time: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
    });

    it('changes with the date in one edit', () => {
      const { data, history } = planTicketUpdate(stored(), { date: '2026-11-05', time: '09:10' }, context());
      expect(data).toMatchObject({ date: day('2026-11-05'), time: '09:10' });
      expect(history.map((change) => change.field)).toEqual(['Fecha del caso', 'Hora del caso']);
    });
  });

  describe('promised delivery date', () => {
    it('sets the promise', () => {
      const { data, history } = planTicketUpdate(stored(), { promisedDate: '2026-11-20' }, context());
      expect(data.promisedDate).toEqual(day('2026-11-20'));
      expect(history).toEqual([{ field: 'Promesa de entrega', oldValue: null, newValue: '20/11/2026' }]);
    });

    it('clears the promise', () => {
      const { data, history } = planTicketUpdate(stored({ promisedDate: day('2026-11-20') }), { promisedDate: null }, context());
      expect(data.promisedDate).toBeNull();
      expect(history).toEqual([{ field: 'Promesa de entrega', oldValue: '20/11/2026', newValue: null }]);
    });

    it('does nothing when the promise sent is the one the case has', () => {
      const promised = stored({ promisedDate: day('2026-11-20') });
      expect(planTicketUpdate(promised, { promisedDate: '2026-11-20' }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(stored(), { promisedDate: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
    });
  });

  describe('history', () => {
    it('records one line per field that changed', () => {
      const dto: TicketInput = { date: '2026-11-05', company: 'Corporación Ñandú', description: 'No imprime', status: 'RESOLVED', moduleId: 4 };
      const { history } = planTicketUpdate(stored(), dto, context({ moduleName: 'Ventas > Facturas' }));
      expect(history).toEqual([
        { field: 'Fecha del caso', oldValue: '2026-11-02', newValue: '2026-11-05' },
        { field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú' },
        { field: 'Descripción', oldValue: null, newValue: null },
        { field: 'Estado', oldValue: 'Pendiente', newValue: 'Resuelto' },
        { field: 'Módulo', oldValue: null, newValue: 'Ventas > Facturas' },
      ]);
    });

    it('records nothing for values equal to the stored ones, nor for fields without history', () => {
      const dto: TicketInput = {
        date: '2026-11-02',
        company: ' ACME ',
        description: 'No abre la factura',
        estimatedMinutes: 30,
        spentMinutes: 20,
        customerReply: ' Listo ',
      };
      const { data, history } = planTicketUpdate(stored(), dto, context());
      expect(history).toEqual([]);
      expect(data).toMatchObject({ company: 'ACME', estimatedMinutes: 30, spentMinutes: 20, customerReply: 'Listo' });
    });

    it('names the module the case had when it is removed', () => {
      const withModule = stored({ moduleId: 4, module: { id: 4, name: 'Facturas', parent: { name: 'Ventas' } } });
      expect(planTicketUpdate(withModule, { moduleId: null }, context()).history).toEqual([
        { field: 'Módulo', oldValue: 'Ventas > Facturas', newValue: null },
      ]);
    });
  });

  describe('texts', () => {
    it('recomputes the search key when company or description change', () => {
      expect(planTicketUpdate(stored(), { company: 'Corporación Ñandú' }, context()).data.searchText).toBe('corporacion nandu no abre la factura');
      expect(planTicketUpdate(stored(), { description: 'No IMPRIME' }, context()).data.searchText).toBe('acme no imprime');
      expect(planTicketUpdate(stored(), { status: 'RESOLVED' }, context()).data).not.toHaveProperty('searchText');
    });

    it('clears the message for the client when it arrives empty', () => {
      const replied = stored({ customerReply: 'Listo' });
      expect(planTicketUpdate(replied, { customerReply: '  ' }, context()).data.customerReply).toBeNull();
      expect(planTicketUpdate(replied, { customerReply: null }, context()).data.customerReply).toBeNull();
    });

    it('refuses to leave the case without company or description', () => {
      expect(() => planTicketUpdate(stored(), { company: '  ' }, context())).toThrow(BadRequestException);
      expect(() => planTicketUpdate(stored(), { description: '' }, context())).toThrow(BadRequestException);
    });

    it('refuses a case date after today, with one day of slack', () => {
      expect(planTicketUpdate(stored(), { date: '2026-11-12' }, context()).data.date).toEqual(day('2026-11-12'));
      expect(() => planTicketUpdate(stored(), { date: '2026-11-13' }, context())).toThrow('La fecha del caso no puede ser posterior a hoy');
    });
  });

  // The checks of the request body let a null through in every optional field.
  describe('null in a field the case cannot be left without', () => {
    const nulls = (fields: Record<string, null>): TicketInput => fields;

    it('is read as "not sent": nothing is written and nothing fails', () => {
      const untouched = { data: { lastActivityAt: NOW }, history: [] };
      for (const field of ['date', 'company', 'description', 'status', 'spentMinutes']) {
        expect(planTicketUpdate(stored(), nulls({ [field]: null }), context())).toEqual(untouched);
      }
      expect(planTicketUpdate(stored(), nulls({ date: null, company: null, description: null, status: null, spentMinutes: null }), context())).toEqual(untouched);
    });

    it('keeps the stored text in the search key when only the other text is sent', () => {
      const onlyCompany: TicketInput = { ...nulls({ description: null }), company: 'Otra' };
      expect(planTicketUpdate(stored(), onlyCompany, context()).data).toEqual({ lastActivityAt: NOW, company: 'Otra', searchText: 'otra no abre la factura' });
      const onlyDescription: TicketInput = { ...nulls({ company: null }), description: 'No imprime' };
      expect(planTicketUpdate(stored(), onlyDescription, context()).data).toEqual({ lastActivityAt: NOW, description: 'No imprime', searchText: 'acme no imprime' });
    });

    it('keeps who is responsible when "Cliente" arrives as null', () => {
      expect(planTicketUpdate(stored(), nulls({ assignedToClient: null }), context()).data).toEqual({ lastActivityAt: NOW, assignedToClient: false, assigneeId: 3 });
    });
  });
});

describe('TicketsService', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
  /** With the reminder at 48 hours, a case not touched since before this moment is forgotten. */
  const CUTOFF = new Date(NOW.getTime() - 48 * 3_600_000);
  const open = { status: { not: 'RESOLVED' } };

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
    // The user who registers the cases is the responsible 4.
    user: { findUnique: jest.fn().mockResolvedValue({ assignee: { id: 4, active: true } }) },
    assignee: { findUnique: jest.fn().mockResolvedValue({ name: 'Luis' }) },
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
      expect(db.ticket.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: {}, orderBy: [{ id: 'desc' }], skip: 50, take: 25 }));
      expect(db.ticket.count).toHaveBeenLastCalledWith({ where: {} });
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
        where: { AND: [{ ...open, promisedDate: { lte: day('2026-11-14') } }] },
        orderBy: [{ promisedDate: 'asc' }, { id: 'asc' }],
      });
      expect(forgotten).toMatchObject({ where: { AND: [{ ...open, lastActivityAt: { lt: CUTOFF } }] }, orderBy: { lastActivityAt: 'asc' } });
      expect(overdue).toMatchObject({ where: { ...open, dueAt: { lt: NOW } }, orderBy: { dueAt: 'asc' } });
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
      const db = caseDb(row({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) }));

      await serviceOn(db).stopTimer(7);

      expect(db.ticket.update).toHaveBeenCalledWith({ where: { id: 7 }, data: { timerStartedAt: null, spentMinutes: 35, lastActivityAt: NOW } });
    });

    it('does not move when the timer was already in the state asked for', async () => {
      const running = caseDb(row({ timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) }));
      await serviceOn(running).startTimer(7);
      expect(running.ticket.update).not.toHaveBeenCalled();

      const stopped = caseDb();
      await serviceOn(stopped).stopTimer(7);
      expect(stopped.ticket.update).not.toHaveBeenCalled();
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
    it('reads a null as "not sent" in the fields a case cannot be left without', async () => {
      const db = caseDb();
      const dto = { company: ' ACME ', description: 'No abre', date: null, status: null, spentMinutes: null, assignedToClient: null, aiGenerated: null, note: null };

      await serviceOn(db).create(dto as unknown as TicketInput, user);

      expect(db.ticket.create.mock.calls).toMatchObject([
        [
          {
            data: {
              date: TODAY,
              company: 'ACME',
              description: 'No abre',
              searchText: 'acme no abre',
              status: 'PENDING',
              spentMinutes: 0,
              assigneeId: 4,
              assignedToClient: false,
              aiGenerated: false,
              lastActivityAt: NOW,
              notes: undefined,
            },
          },
        ],
      ]);
    });

    /** The responsible of the case the service stores for this input. */
    const storedAssignee = async (db: ReturnType<typeof caseDb>, input: Partial<TicketInput>): Promise<unknown> => {
      await serviceOn(db).create({ company: 'ACME', description: 'No abre', ...input }, user);
      return (db.ticket.create.mock.calls[0] as [{ data: { assigneeId: unknown } }])[0].data.assigneeId;
    };

    // The responsible of a case is a person of the catalog, not the user: id 1 registers, 4 attends.
    it('gives the case to the responsible its user is, when none is chosen', async () => {
      const db = caseDb();

      expect(await storedAssignee(db, {})).toBe(4);
      expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 1 }, select: { assignee: { select: { id: true, active: true } } } });
    });

    it('leaves it without a responsible when its user attends no cases, or their responsible is deactivated', async () => {
      const notLinked = caseDb();
      notLinked.user.findUnique.mockResolvedValue({ assignee: null });
      expect(await storedAssignee(notLinked, {})).toBeNull();

      const deactivated = caseDb();
      deactivated.user.findUnique.mockResolvedValue({ assignee: { id: 4, active: false } });
      expect(await storedAssignee(deactivated, {})).toBeNull();
    });

    it('keeps the responsible chosen, nobody included, without asking who the user is', async () => {
      const chosen = caseDb();
      expect(await storedAssignee(chosen, { assigneeId: 9 })).toBe(9);
      expect(chosen.assignee.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { name: true } });
      expect(chosen.user.findUnique).not.toHaveBeenCalled();

      const nobody = caseDb();
      expect(await storedAssignee(nobody, { assigneeId: null })).toBeNull();
      expect(nobody.user.findUnique).not.toHaveBeenCalled();

      const client = caseDb();
      expect(await storedAssignee(client, { assignedToClient: true })).toBeNull();
      expect(client.user.findUnique).not.toHaveBeenCalled();
    });

    it('refuses a responsible that is not in the catalog', async () => {
      const db = caseDb();
      db.assignee.findUnique.mockResolvedValue(null);

      await expect(serviceOn(db).create({ company: 'ACME', description: 'No abre', assigneeId: 9 }, user)).rejects.toThrow('El responsable no existe');
      expect(db.ticket.create).not.toHaveBeenCalled();
    });

    it('refuses a case whose company or description is null', async () => {
      const db = caseDb();
      const service = serviceOn(db);

      await expect(service.create({ company: null, description: 'No abre' } as unknown as TicketInput, user)).rejects.toThrow('Empresa y descripción son obligatorias');
      await expect(service.create({ company: 'ACME', description: null } as unknown as TicketInput, user)).rejects.toThrow('Empresa y descripción son obligatorias');
      expect(db.ticket.create).not.toHaveBeenCalled();
    });
  });
});
