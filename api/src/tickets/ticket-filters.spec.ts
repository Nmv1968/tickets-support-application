import { BadRequestException } from '@nestjs/common';
import { day } from '../common/testing';
import { NOW, TODAY } from './testing';
import { buildWhere, parseTicketFilters, ticketOrder } from './ticket-filters';

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
      // By company is by the key of its name, the text the list shows, so that accents and capitals do not move it.
      expect(ticketOrder({ sort: 'company', dir: 'asc' })).toEqual([{ company: { sortKey: 'asc' } }, { id: 'asc' }]);
      expect(ticketOrder({ sort: 'company' })).toEqual([{ company: { sortKey: 'desc' } }, { id: 'asc' }]);
      // By date, the time of the case orders the cases of one day; the ones without a time go after them.
      expect(ticketOrder({ sort: 'date' })).toEqual([{ date: 'desc' }, { time: { sort: 'desc', nulls: 'last' } }, { id: 'asc' }]);
      expect(ticketOrder({ sort: 'date', dir: 'asc' })).toEqual([{ date: 'asc' }, { time: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }]);
    });
  });

  describe('buildWhere', () => {
    const open = { status: { not: 'RESOLVED' } };
    const none = { id: -1 };
    /** What every list asks for unless the filter says otherwise: the cases that are not archived. */
    const active = { archivedAt: null };

    beforeAll(() => jest.useFakeTimers({ now: NOW }));
    afterAll(() => jest.useRealTimers());

    it('leaves the archived cases out when no filter is sent, and filters nothing else', () => {
      expect(buildWhere({})).toEqual({ AND: [active] });
      expect(buildWhere(parseTicketFilters({ status: ['a', 'b'], from: '', priority: 'URGENT' }))).toEqual({ AND: [active] });
    });

    it('shows only the archived cases, or archived and not archived together, when the filter asks for it', () => {
      expect(buildWhere({ archived: 'only' })).toEqual({ AND: [{ archivedAt: { not: null } }] });
      expect(buildWhere({ archived: 'all' })).toEqual({});
      expect(buildWhere({ archived: 'only', status: ['RESOLVED'] })).toEqual({ AND: [{ archivedAt: { not: null } }, { status: { in: ['RESOLVED'] } }] });
      expect(buildWhere({ archived: 'all', status: ['RESOLVED'] })).toEqual({ AND: [{ status: { in: ['RESOLVED'] } }] });
    });

    it('filters by responsible: a person of the catalog, or the cases nobody is responsible for', () => {
      // "Some": a case with that person and others is found too, as with a support type.
      expect(buildWhere({ assignee: 12 })).toEqual({ AND: [active, { assignees: { some: { assigneeId: 12 } } }] });
      expect(buildWhere({ assignee: 'none' })).toEqual({ AND: [active, { assignees: { none: {} } }] });
    });

    it('filters by company, by who registered the case and by a support type the case carries', () => {
      expect(buildWhere({ companyId: 4 })).toEqual({ AND: [active, { companyId: 4 }] });
      expect(buildWhere({ createdBy: 3 })).toEqual({ AND: [active, { createdById: 3 }] });
      // "Some": a case with that type and others is found too.
      expect(buildWhere({ supportType: 5 })).toEqual({ AND: [active, { supportTypes: { some: { supportTypeId: 5 } } }] });
    });

    it('applies together every filter that is sent', () => {
      expect(buildWhere(parseTicketFilters({ companyId: '4', assignee: 'none', supportType: '5', createdBy: '3', moduleId: '8', priority: 'HIGH' }))).toEqual({
        AND: [active, { assignees: { none: {} } }, { companyId: 4 }, { priority: 'HIGH' }, { moduleId: 8 }, { supportTypes: { some: { supportTypeId: 5 } } }, { createdById: 3 }],
      });
    });

    it('finds forgotten cases: open and without activity since the cutoff', () => {
      const staleBefore = new Date(2026, 10, 9, 10, 0, 0);
      expect(buildWhere({ stale: true }, { staleBefore, promiseSoonDays: 0 })).toEqual({
        AND: [active, { ...open, lastActivityAt: { lt: staleBefore } }],
      });
    });

    it('finds no forgotten case when that reminder is off', () => {
      expect(buildWhere({ stale: true }, { staleBefore: null, promiseSoonDays: 0 })).toEqual({ AND: [active, none] });
      expect(buildWhere({ stale: true })).toEqual({ AND: [active, none] });
    });

    it('filters by where the promised delivery date stands', () => {
      const rules = { staleBefore: null, promiseSoonDays: 3 };
      const soonLimit = day('2026-11-14');
      expect(buildWhere({ promise: 'any' }, rules)).toEqual({ AND: [active, { promisedDate: { not: null } }] });
      expect(buildWhere({ promise: 'overdue' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lt: TODAY } }] });
      expect(buildWhere({ promise: 'today' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: TODAY }] });
      expect(buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { gt: TODAY, lte: soonLimit } }] });
      expect(buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lte: soonLimit } }] });
    });

    it('has no "soon" promises without advance notice, and "due" then ends today', () => {
      const rules = { staleBefore: null, promiseSoonDays: 0 };
      expect(buildWhere({ promise: 'soon' }, rules)).toEqual({ AND: [active, none] });
      expect(buildWhere({ promise: 'due' }, rules)).toEqual({ AND: [active, { ...open, promisedDate: { lte: TODAY } }] });
    });
  });
});
