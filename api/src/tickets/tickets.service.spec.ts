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

// Three support types of the catalog. By name they go: Capacitación, Error de usuario, Falla del sistema.
const TRAINING = { id: 1, name: 'Capacitación', color: '#0c7beb' };
const FAILURE = { id: 2, name: 'Falla del sistema', color: '#e5484d' };
const USER_ERROR = { id: 3, name: 'Error de usuario', color: '#b97a00' };
type SupportTypeRow = typeof TRAINING;
/** The support types of a case as the database returns them: one row per type the case carries. */
const carrying = (...types: SupportTypeRow[]): StoredTicket['supportTypes'] => types.map((supportType) => ({ supportType }));

/** A case as stored. */
const stored = (changes: Partial<StoredTicket> = {}): StoredTicket => ({
  id: 7,
  date: day('2026-11-02'),
  time: null,
  companyId: 2,
  company: { id: 2, name: 'ACME' },
  description: 'No abre la factura',
  searchText: 'acme no abre la factura',
  status: 'PENDING',
  assigneeId: 3,
  assignee: { id: 3, name: 'Ana' },
  supportTypes: [],
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
  archivedAt: null,
  ...changes,
});

describe('ticket list filters', () => {
  describe('parseTicketFilters', () => {
    it('reads every parameter of the list', () => {
      expect(
        parseTicketFilters({
          status: 'PENDING',
          assignee: '12',
          companyId: ' 9 ',
          priority: 'HIGH',
          moduleId: '4',
          supportType: '5',
          createdBy: '3',
          archived: 'only',
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
        companyId: 9,
        priority: 'HIGH',
        moduleId: 4,
        supportType: 5,
        createdBy: 3,
        archived: 'only',
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

    it('reads the word the responsible filter accepts besides a person', () => {
      expect(parseTicketFilters({ assignee: 'none' }).assignee).toBe('none');
      // "Cliente" is a responsible of the catalog like any other now: it is filtered by its id.
      expect(parseTicketFilters({ assignee: 'client' })).toEqual({});
    });

    it('reads which side of the archive is asked for, and takes any other word as not sent', () => {
      expect(parseTicketFilters({ archived: 'only' }).archived).toBe('only');
      expect(parseTicketFilters({ archived: 'all' }).archived).toBe('all');
      for (const archived of ['', '1', 'true', 'no', 'ONLY', 'exclude']) expect(parseTicketFilters({ archived })).toEqual({});
    });

    it('takes several statuses, separated by commas or by repeating the parameter', () => {
      expect(parseTicketFilters({ status: 'RESOLVED,PENDING' }).status).toEqual(['PENDING', 'RESOLVED']);
      expect(parseTicketFilters({ status: ['RESOLVED', 'PENDING'] }).status).toEqual(['PENDING', 'RESOLVED']);
      expect(parseTicketFilters({ status: ['RESOLVED, PENDING', 'RESOLVED', 'CERRADO'] }).status).toEqual(['PENDING', 'RESOLVED']);
    });

    it('uses the first value of any other repeated parameter', () => {
      expect(parseTicketFilters({ companyId: ['4', '5'], assignee: ['7', '8'], from: ['2026-01-01', '2026-02-01'], page: ['2', '9'] })).toEqual({
        companyId: 4,
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
          // The company is one of the catalog, by its id: a name is not a filter any more.
          companyId: 'ACME',
          company: 'ACME',
          priority: 'URGENT',
          moduleId: '1.5',
          supportType: 'Capacitación',
          createdBy: '-3',
          archived: 'si',
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
      expect(parseTicketFilters({ status: { a: 'PENDING' }, companyId: 5, q: [{}, null], page: null, from: [] })).toEqual({});
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
      expect(ticketOrder({ sort: 'status', dir: 'asc' })).toEqual([{ status: 'asc' }, { id: 'asc' }]);
      // By company is by its name, the text the list shows.
      expect(ticketOrder({ sort: 'company', dir: 'asc' })).toEqual([{ company: { name: 'asc' } }, { id: 'asc' }]);
      expect(ticketOrder({ sort: 'company' })).toEqual([{ company: { name: 'desc' } }, { id: 'asc' }]);
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
    /** What every list asks for unless the filter says otherwise: the cases that are not archived. */
    const active = { archivedAt: null };

    beforeAll(() => jest.useFakeTimers({ now: NOW }));
    afterAll(() => jest.useRealTimers());

    it('leaves the archived cases out when no filter is sent, and filters nothing else', () => {
      expect(service.buildWhere({})).toEqual({ AND: [active] });
      expect(service.buildWhere(parseTicketFilters({ status: ['a', 'b'], from: '', priority: 'URGENT' }))).toEqual({ AND: [active] });
    });

    it('shows only the archived cases, or archived and not archived together, when the filter asks for it', () => {
      expect(service.buildWhere({ archived: 'only' })).toEqual({ AND: [{ archivedAt: { not: null } }] });
      expect(service.buildWhere({ archived: 'all' })).toEqual({});
      expect(service.buildWhere({ archived: 'only', status: ['RESOLVED'] })).toEqual({ AND: [{ archivedAt: { not: null } }, { status: { in: ['RESOLVED'] } }] });
      expect(service.buildWhere({ archived: 'all', status: ['RESOLVED'] })).toEqual({ AND: [{ status: { in: ['RESOLVED'] } }] });
    });

    it('filters by responsible: a person of the catalog, or the cases nobody is responsible for', () => {
      expect(service.buildWhere({ assignee: 12 })).toEqual({ AND: [active, { assigneeId: 12 }] });
      expect(service.buildWhere({ assignee: 'none' })).toEqual({ AND: [active, { assigneeId: null }] });
    });

    it('filters by company, by who registered the case and by a support type the case carries', () => {
      expect(service.buildWhere({ companyId: 4 })).toEqual({ AND: [active, { companyId: 4 }] });
      expect(service.buildWhere({ createdBy: 3 })).toEqual({ AND: [active, { createdById: 3 }] });
      // "Some": a case with that type and others is found too.
      expect(service.buildWhere({ supportType: 5 })).toEqual({ AND: [active, { supportTypes: { some: { supportTypeId: 5 } } }] });
    });

    it('applies together every filter that is sent', () => {
      expect(service.buildWhere(parseTicketFilters({ companyId: '4', assignee: 'none', supportType: '5', createdBy: '3', moduleId: '8', priority: 'HIGH' }))).toEqual({
        AND: [active, { assigneeId: null }, { companyId: 4 }, { priority: 'HIGH' }, { moduleId: 8 }, { supportTypes: { some: { supportTypeId: 5 } } }, { createdById: 3 }],
      });
    });

    it('finds forgotten cases: open and without activity since the cutoff', () => {
      const staleBefore = new Date(2026, 10, 9, 10, 0, 0);
      expect(service.buildWhere({ stale: true }, { staleBefore, promiseSoonDays: 0 })).toEqual({
        AND: [active, { ...open, lastActivityAt: { lt: staleBefore } }],
      });
    });

    it('finds no forgotten case when that reminder is off', () => {
      expect(service.buildWhere({ stale: true }, { staleBefore: null, promiseSoonDays: 0 })).toEqual({ AND: [active, none] });
      expect(service.buildWhere({ stale: true })).toEqual({ AND: [active, none] });
    });

    it('filters by where the promised delivery date stands', () => {
      const rules = { staleBefore: null, promiseSoonDays: 3 };
      const soonLimit = day('2026-11-14');
      expect(service.buildWhere({ promise: 'any' }, rules)).toEqual({ AND: [active, { promisedDate: { not: null } }] });
      expect(service.buildWhere({ promise: 'overdue' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lt: TODAY } }] });
      expect(service.buildWhere({ promise: 'today' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: TODAY }] });
      expect(service.buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { gt: TODAY, lte: soonLimit } }] });
      expect(service.buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lte: soonLimit } }] });
    });

    it('has no "soon" promises without advance notice, and "due" then ends today', () => {
      const rules = { staleBefore: null, promiseSoonDays: 0 };
      expect(service.buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [active, none] });
      expect(service.buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lte: TODAY } }] });
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
    expect(await errors({ description: 'x'.repeat(5001) })).toEqual(['La descripción no puede tener más de 5000 caracteres']);
    expect(await errors({ customerReply: 'x'.repeat(5001) })).toEqual(['La respuesta para el cliente no puede tener más de 5000 caracteres']);
    expect(await errors({ note: 'x'.repeat(5001) })).toEqual(['La observación no puede tener más de 5000 caracteres']);
    expect(await errors({ description: 'x'.repeat(5000), customerReply: 'x'.repeat(5000), note: 'x'.repeat(5000) })).toEqual([]);
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

  it('refuses the id of a company, of a person, of a module or of a support type that no record can have', async () => {
    // Beyond 2147483647 the database cannot even hold the number.
    for (const id of [0, -1, 2_147_483_648, 99_999_999_999]) {
      expect(await errors({ companyId: id })).toEqual(['La empresa no existe']);
      expect(await errors({ assigneeId: id })).toEqual(['El responsable no existe']);
      expect(await errors({ moduleId: id })).toEqual(['El módulo no existe']);
      expect(await errors({ supportTypeIds: [1, id] })).toEqual(['El tipo de soporte no existe']);
    }
    expect(await errors({ companyId: 1, assigneeId: 1, moduleId: 2_147_483_647, supportTypeIds: [1, 2_147_483_647] })).toEqual([]);
  });

  // The company used to be a text of the case. Sent that way now, it is not taken for the catalog's.
  it('takes the company as the id of one of the catalog, not as a name', async () => {
    expect(await errors({ companyId: 'ACME' })).not.toEqual([]);
    expect(await errors({ companyId: 1.5 })).not.toEqual([]);
  });

  it('still accepts null where it removes the value', async () => {
    expect(await errors({ assigneeId: null, moduleId: null, priority: null, estimatedMinutes: null, promisedDate: null, customerReply: null })).toEqual([]);
  });
});

describe('ticket input support types', () => {
  const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

  it('accepts a list of ids of the catalog: empty, with one repeated, or with up to 20', async () => {
    for (const supportTypeIds of [[], [3], [3, 1, 3], ids(20)]) expect(await errors({ supportTypeIds })).toEqual([]);
  });

  it('says in Spanish that a case cannot carry more than 20', async () => {
    expect(await errors({ supportTypeIds: ids(21) })).toEqual(['Un caso no puede tener más de 20 tipos de soporte']);
  });

  it('refuses what is not a list of whole numbers', async () => {
    for (const supportTypeIds of [3, '3', { id: 3 }, [1.5], ['3'], [null], ['Capacitación']]) {
      expect(await errors({ supportTypeIds })).not.toEqual([]);
    }
  });
});

describe('ticket input archive', () => {
  it('accepts the switch only as true or false', async () => {
    expect(await errors({ archived: true })).toEqual([]);
    expect(await errors({ archived: false })).toEqual([]);
    for (const archived of ['true', 1, 'only']) expect(await errors({ archived })).not.toEqual([]);
  });
});

describe('ticket input fields a case no longer has', () => {
  /** The fields the API refuses for not being part of a case, checked as it checks every request body. */
  const unknownFields = async (input: Record<string, unknown>): Promise<string[]> =>
    (await validate(plainToInstance(TicketInput, input), { whitelist: true, forbidNonWhitelisted: true })).map((error) => error.property);

  // Ignored, a caller that still sends them would believe the company or the client were stored.
  it('refuses the company as text and the client as responsible, instead of ignoring them', async () => {
    expect(await unknownFields({ company: 'ACME', assignedToClient: true, companyId: 2, description: 'No abre' })).toEqual(['company', 'assignedToClient']);
    expect(await unknownFields({ companyId: 2, description: 'No abre', supportTypeIds: [1], archived: false })).toEqual([]);
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
    companyName: null,
    assigneeName: null,
    supportTypes: null,
    moduleName: null,
    slaHours: null,
    ...changes,
  });
  /** What an edit that changes nothing writes: the mark that somebody worked on the case. */
  const untouched = { data: { lastActivityAt: NOW }, history: [] };

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

    // The form sends the status and the time spent in one edit. With the timer running, the person
    // who types the real time and resolves means that number, not the one the timer would give.
    it('takes the minutes typed in the same edit over the ones of the timer it stops', () => {
      const running = stored({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      expect(planTicketUpdate(running, { status: 'RESOLVED', spentMinutes: 60 }, context()).data).toMatchObject({ spentMinutes: 60, timerStartedAt: null });
      // Zero is a number typed too.
      expect(planTicketUpdate(running, { status: 'RESOLVED', spentMinutes: 0 }, context()).data).toMatchObject({ spentMinutes: 0, timerStartedAt: null });
      // A null is "not sent": the minutes of the timer are added, as when the field is not there.
      const unsent = { status: 'RESOLVED', spentMinutes: null } as unknown as TicketInput;
      expect(planTicketUpdate(running, unsent, context()).data).toMatchObject({ spentMinutes: 35, timerStartedAt: null });
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
    const unassigned = { assigneeId: null, assignee: null };

    it('gives the case to another person of the catalog', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeId: 5 }, context({ assigneeName: 'Luis' }));
      expect(data).toEqual({ lastActivityAt: NOW, assigneeId: 5 });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: 'Luis' }]);
    });

    it('gives a responsible to a case that had none', () => {
      const { data, history } = planTicketUpdate(stored(unassigned), { assigneeId: 5 }, context({ assigneeName: 'Luis' }));
      expect(data).toMatchObject({ assigneeId: 5 });
      expect(history).toEqual([{ field: 'Responsable', oldValue: null, newValue: 'Luis' }]);
    });

    it('leaves the case without responsible when the person is removed', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeId: null }, context());
      expect(data).toEqual({ lastActivityAt: NOW, assigneeId: null });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: null }]);
    });

    it('does nothing when the responsible sent is the one the case has, nobody included', () => {
      expect(planTicketUpdate(stored(), { assigneeId: 3 }, context({ assigneeName: 'Ana' }))).toEqual(untouched);
      expect(planTicketUpdate(stored(unassigned), { assigneeId: null }, context())).toEqual(untouched);
    });

    // "Cliente" was a switch of the case that won over the person. It is a responsible of the catalog now.
    it('names "Cliente" in the history like any other responsible', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeId: 8 }, context({ assigneeName: 'Cliente' }));
      expect(data).toEqual({ lastActivityAt: NOW, assigneeId: 8 });
      expect(history).toEqual([{ field: 'Responsable', oldValue: 'Ana', newValue: 'Cliente' }]);
    });
  });

  describe('company', () => {
    it('moves the case to another company of the catalog, and names both in the history', () => {
      const { data, history } = planTicketUpdate(stored(), { companyId: 5 }, context({ companyName: 'Corporación Ñandú' }));
      expect(data).toEqual({ lastActivityAt: NOW, companyId: 5, searchText: 'corporacion nandu no abre la factura' });
      expect(history).toEqual([{ field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú' }]);
    });

    it('does nothing when the company sent is the one the case has', () => {
      expect(planTicketUpdate(stored(), { companyId: 2 }, context({ companyName: 'ACME' }))).toEqual(untouched);
    });
  });

  describe('support types', () => {
    /** The types of the input as the caller looks them up: id and name. */
    const found = (...types: SupportTypeRow[]): TicketUpdateContext['supportTypes'] => types.map(({ id, name }) => ({ id, name }));

    it('gives a case its first types, and names them in the history in alphabetical order', () => {
      const { data, history } = planTicketUpdate(stored(), { supportTypeIds: [2, 1] }, context({ supportTypes: found(FAILURE, TRAINING) }));
      expect(data).toEqual({
        lastActivityAt: NOW,
        supportTypes: { deleteMany: undefined, createMany: { data: [{ supportTypeId: 2 }, { supportTypeId: 1 }] } },
      });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación, Falla del sistema' }]);
    });

    it('replaces the whole set: what is not in the list goes, what is new comes, what stays is not rewritten', () => {
      const before = stored({ supportTypes: carrying(TRAINING, FAILURE) });
      const { data, history } = planTicketUpdate(before, { supportTypeIds: [2, 3] }, context({ supportTypes: found(FAILURE, USER_ERROR) }));
      expect(data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [1] } }, createMany: { data: [{ supportTypeId: 3 }] } });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: 'Error de usuario, Falla del sistema' }]);
    });

    it('leaves the case without types with an empty list', () => {
      const before = stored({ supportTypes: carrying(FAILURE, TRAINING) });
      const { data, history } = planTicketUpdate(before, { supportTypeIds: [] }, context({ supportTypes: [] }));
      expect(data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [2, 1] } }, createMany: undefined });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: null }]);
    });

    it('does nothing when the list sent is the set the case has, in whatever order', () => {
      const before = stored({ supportTypes: carrying(TRAINING, FAILURE) });
      expect(planTicketUpdate(before, { supportTypeIds: [2, 1] }, context({ supportTypes: found(FAILURE, TRAINING) }))).toEqual(untouched);
      expect(planTicketUpdate(stored(), { supportTypeIds: [] }, context({ supportTypes: [] }))).toEqual(untouched);
    });

    it('keeps the types the case has when the list is not sent', () => {
      const before = stored({ supportTypes: carrying(TRAINING) });
      expect(planTicketUpdate(before, { status: 'RESOLVED' }, context()).data).not.toHaveProperty('supportTypes');
    });
  });

  describe('archive', () => {
    const archivedAt = new Date('2026-11-05T12:00:00.000Z');

    it('archives a case at the moment of the edit', () => {
      const { data, history } = planTicketUpdate(stored(), { archived: true }, context());
      expect(data).toEqual({ archivedAt: NOW });
      expect(history).toEqual([{ field: 'Archivado', oldValue: 'No', newValue: 'Sí' }]);
    });

    it('brings an archived case back', () => {
      const { data, history } = planTicketUpdate(stored({ archivedAt }), { archived: false }, context());
      expect(data).toEqual({ archivedAt: null });
      expect(history).toEqual([{ field: 'Archivado', oldValue: 'Sí', newValue: 'No' }]);
    });

    it('does nothing when the case is already where it is sent: the first archive date stays', () => {
      expect(planTicketUpdate(stored({ archivedAt }), { archived: true }, context())).toEqual({ data: {}, history: [] });
      expect(planTicketUpdate(stored(), { archived: false }, context())).toEqual({ data: {}, history: [] });
    });

    // Putting a case away is not working on it: a forgotten case stays forgotten if it comes back.
    it('does not count as activity on the case, in either direction', () => {
      expect(planTicketUpdate(stored(), { archived: true }, context()).data).not.toHaveProperty('lastActivityAt');
      expect(planTicketUpdate(stored({ archivedAt }), { archived: false }, context()).data).not.toHaveProperty('lastActivityAt');
      // Fields the request body leaves undefined are not fields sent.
      expect(planTicketUpdate(stored(), { archived: true, status: undefined, time: undefined }, context()).data).toEqual({ archivedAt: NOW });
    });

    it('counts as activity when the same edit changes something else of the case', () => {
      const { data, history } = planTicketUpdate(stored(), { archived: true, status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ lastActivityAt: NOW, archivedAt: NOW, status: 'RESOLVED' });
      expect(history.map((change) => change.field)).toEqual(['Estado', 'Archivado']);
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
      const dto: TicketInput = {
        date: '2026-11-05',
        companyId: 5,
        description: 'No imprime',
        status: 'RESOLVED',
        assigneeId: 9,
        supportTypeIds: [1],
        archived: true,
        moduleId: 4,
      };
      const names = { companyName: 'Corporación Ñandú', assigneeName: 'Luis', supportTypes: [{ id: 1, name: 'Capacitación' }], moduleName: 'Ventas > Facturas' };
      const { history } = planTicketUpdate(stored(), dto, context(names));
      expect(history).toEqual([
        { field: 'Fecha del caso', oldValue: '2026-11-02', newValue: '2026-11-05' },
        { field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú' },
        { field: 'Descripción', oldValue: null, newValue: null },
        { field: 'Estado', oldValue: 'Pendiente', newValue: 'Resuelto' },
        { field: 'Responsable', oldValue: 'Ana', newValue: 'Luis' },
        { field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación' },
        { field: 'Archivado', oldValue: 'No', newValue: 'Sí' },
        { field: 'Módulo', oldValue: null, newValue: 'Ventas > Facturas' },
      ]);
    });

    it('records nothing for values equal to the stored ones, nor for fields without history', () => {
      const dto: TicketInput = {
        date: '2026-11-02',
        companyId: 2,
        description: 'No abre la factura',
        assigneeId: 3,
        supportTypeIds: [],
        archived: false,
        estimatedMinutes: 30,
        spentMinutes: 20,
        customerReply: ' Listo ',
      };
      const { data, history } = planTicketUpdate(stored(), dto, context({ companyName: 'ACME', assigneeName: 'Ana', supportTypes: [] }));
      expect(history).toEqual([]);
      expect(data).toMatchObject({ estimatedMinutes: 30, spentMinutes: 20, customerReply: 'Listo' });
      expect(data).not.toHaveProperty('companyId');
      expect(data).not.toHaveProperty('assigneeId');
      expect(data).not.toHaveProperty('supportTypes');
      expect(data).not.toHaveProperty('archivedAt');
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
      const nandu = context({ companyName: 'Corporación Ñandú' });
      expect(planTicketUpdate(stored(), { companyId: 5 }, nandu).data.searchText).toBe('corporacion nandu no abre la factura');
      expect(planTicketUpdate(stored(), { description: 'No IMPRIME' }, context()).data.searchText).toBe('acme no imprime');
      expect(planTicketUpdate(stored(), { companyId: 5, description: 'No IMPRIME' }, nandu).data.searchText).toBe('corporacion nandu no imprime');
      expect(planTicketUpdate(stored(), { status: 'RESOLVED' }, context()).data).not.toHaveProperty('searchText');
    });

    it('clears the message for the client when it arrives empty', () => {
      const replied = stored({ customerReply: 'Listo' });
      expect(planTicketUpdate(replied, { customerReply: '  ' }, context()).data.customerReply).toBeNull();
      expect(planTicketUpdate(replied, { customerReply: null }, context()).data.customerReply).toBeNull();
    });

    it('refuses to leave the case without description', () => {
      expect(() => planTicketUpdate(stored(), { description: '' }, context())).toThrow(BadRequestException);
      expect(() => planTicketUpdate(stored(), { description: '   ' }, context())).toThrow('La descripción no puede quedar vacía');
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
      const fields = ['date', 'companyId', 'description', 'status', 'spentMinutes', 'supportTypeIds', 'archived'];
      // The case carries a type and is archived: a null taken for "none" or for "no" would show.
      const before = stored({ supportTypes: carrying(TRAINING), archivedAt: new Date('2026-11-05T12:00:00.000Z') });
      for (const field of fields) {
        expect(planTicketUpdate(before, nulls({ [field]: null }), context())).toEqual(untouched);
      }
      expect(planTicketUpdate(before, nulls(Object.fromEntries(fields.map((field) => [field, null]))), context())).toEqual(untouched);
    });

    it('keeps the stored text in the search key when only the other one is sent', () => {
      const onlyCompany: TicketInput = { ...nulls({ description: null }), companyId: 5 };
      expect(planTicketUpdate(stored(), onlyCompany, context({ companyName: 'Otra' })).data).toEqual({ lastActivityAt: NOW, companyId: 5, searchText: 'otra no abre la factura' });
      const onlyDescription: TicketInput = { ...nulls({ companyId: null }), description: 'No imprime' };
      expect(planTicketUpdate(stored(), onlyDescription, context()).data).toEqual({ lastActivityAt: NOW, description: 'No imprime', searchText: 'acme no imprime' });
    });
  });
});

describe('TicketsService', () => {
  const user: AuthUser = { id: 1, username: 'admin', name: 'Admin' };
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
});

