import type { ExecutionContext } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import type { Observable } from 'rxjs';
import { ChangeEventsInterceptor } from './change-events.interceptor';
import { EventsService } from './events.service';
import type { ChangeEvent } from './events.service';

describe('ChangeEventsInterceptor', () => {
  interface FakeRequest {
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    user?: { id: number; username: string; name: string };
  }

  /** The events announced for a request whose handler answers with `answer` (a body, or an observable of one). */
  function announced(request: FakeRequest, answer: unknown = undefined): ChangeEvent[] {
    const events = new EventsService();
    const seen: ChangeEvent[] = [];
    events.changes$.subscribe((event) => seen.push(event));
    const req = { query: {}, headers: {}, ...request };
    const context = { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext;
    const handled = (answer instanceof Object && 'subscribe' in answer ? answer : of(answer)) as Observable<unknown>;
    new ChangeEventsInterceptor(events).intercept(context, { handle: () => handled }).subscribe({ error: () => undefined });
    return seen;
  }
  const scopes = (request: FakeRequest, answer?: unknown): string[] => announced(request, answer).map((event) => event.scope);
  const ticket = { id: 12, code: 'SOP-00012', company: 'ACME' };

  describe('what changed, by the path of the request', () => {
    it.each([
      ['POST', '/api/tickets'],
      ['PATCH', '/api/tickets/7'],
      ['DELETE', '/api/tickets/7/notes/3'],
      ['POST', '/api/tickets/7/attachments'],
      ['DELETE', '/api/attachments/3'],
      ['POST', '/api/import'],
      ['POST', '/api/ai/reply/7'],
    ])('%s %s announces a change in the cases', (method, path) => {
      expect(scopes({ method, path })).toEqual(['tickets']);
    });

    it.each([
      ['POST', '/api/modules'],
      ['POST', '/api/users'],
      ['PATCH', '/api/users/5'],
      ['POST', '/api/assignees'],
      ['DELETE', '/api/assignees/4'],
      ['POST', '/api/companies'],
      ['DELETE', '/api/companies/4'],
      ['POST', '/api/support-types'],
      ['DELETE', '/api/support-types/4'],
      ['PUT', '/api/sla'],
      ['PUT', '/api/ai/config/openai'],
    ])('%s %s announces a change in the catalogs', (method, path) => {
      expect(scopes({ method, path })).toEqual(['catalogs']);
    });

    // Every case shows the name of its company, of its responsible and of its module, and its
    // support types in their colour, as they were when the case was read. After a rename or a
    // new colour, the lists and boards open elsewhere would keep the old ones.
    it.each(['/api/companies/4', '/api/support-types/4', '/api/assignees/4', '/api/modules/3'])(
      'PATCH %s announces a change in the catalogs and, for what the cases show of that entry, in the cases too',
      (path) => {
        expect(announced({ method: 'PATCH', path, headers: { 'x-client-id': 'tab-1' } }, { id: 4, name: 'Acme Corp', active: true, tickets: 3 })).toEqual([
          { scope: 'catalogs', ticketId: null, created: null, clientId: 'tab-1' },
          { scope: 'tickets', ticketId: null, created: null, clientId: 'tab-1' },
        ]);
      },
    );

    it('leaves the cases out of it when an edit of a catalog fails, and for the catalogs no case shows', () => {
      expect(announced({ method: 'PATCH', path: '/api/companies/4' }, throwError(() => new Error('Ya existe una empresa con ese nombre')))).toEqual([]);
      // A new entry is on no case yet, and one that could be deleted was on none.
      expect(scopes({ method: 'POST', path: '/api/companies' }, { id: 9, name: 'Beta', active: true, tickets: 0 })).toEqual(['catalogs']);
      expect(scopes({ method: 'DELETE', path: '/api/support-types/4' })).toEqual(['catalogs']);
      // A list of cases draws nothing of a user, and new SLA hours change no case already registered.
      expect(scopes({ method: 'PATCH', path: '/api/users/5' })).toEqual(['catalogs']);
      expect(scopes({ method: 'PUT', path: '/api/sla' })).toEqual(['catalogs']);
    });

    it('announces a change in the settings', () => {
      expect(scopes({ method: 'PUT', path: '/api/settings/reminders' })).toEqual(['settings']);
      // The company logo: the other open sessions show the new one at once.
      expect(scopes({ method: 'PUT', path: '/api/branding/logo' })).toEqual(['settings']);
      expect(scopes({ method: 'DELETE', path: '/api/branding/logo' })).toEqual(['settings']);
    });

    it('announces nothing for a path that changes none of them', () => {
      expect(announced({ method: 'POST', path: '/api/auth/login' })).toEqual([]);
      expect(announced({ method: 'POST', path: '/api/ai/analyze' })).toEqual([]);
      expect(announced({ method: 'POST', path: '/api/ticketsold' })).toEqual([]);
    });

    // The columns a person chooses concern nobody else: no other browser has anything to reload.
    it('announces nothing when a user saves a preference of their own', () => {
      expect(announced({ method: 'PUT', path: '/api/preferences/tickets.columns', headers: { 'x-client-id': 'tab-1' } })).toEqual([]);
    });
  });

  it('announces nothing for a read', () => {
    expect(announced({ method: 'GET', path: '/api/tickets' }, { items: [] })).toEqual([]);
    expect(announced({ method: 'GET', path: '/api/tickets/7' }, ticket)).toEqual([]);
    expect(announced({ method: 'GET', path: '/api/users' }, [])).toEqual([]);
  });

  it('announces nothing for a write that failed', () => {
    expect(announced({ method: 'PATCH', path: '/api/tickets/7' }, throwError(() => new Error('El caso no existe')))).toEqual([]);
  });

  describe('the case that changed', () => {
    it('is the one in the answer, or else the one in the path', () => {
      expect(announced({ method: 'PATCH', path: '/api/tickets/7' }, ticket)[0].ticketId).toBe(12);
      expect(announced({ method: 'POST', path: '/api/ai/reply/7' }, ticket)[0].ticketId).toBe(12);
      expect(announced({ method: 'DELETE', path: '/api/tickets/7' })[0].ticketId).toBe(7);
      expect(announced({ method: 'POST', path: '/api/tickets/7/notes' })[0].ticketId).toBe(7);
    });

    it('is none when the request does not say which', () => {
      expect(announced({ method: 'DELETE', path: '/api/attachments/3' })[0].ticketId).toBeNull();
      expect(announced({ method: 'POST', path: '/api/import' }, { toCreate: 4 })[0].ticketId).toBeNull();
      expect(announced({ method: 'PATCH', path: '/api/users/5' }, { id: 5, username: 'ana' })[0].ticketId).toBeNull();
    });
  });

  describe('a case just registered', () => {
    const user = { id: 3, username: 'ana', name: 'Ana' };

    it('is announced with its code and who registered it', () => {
      expect(announced({ method: 'POST', path: '/api/tickets', user }, ticket)).toEqual([
        { scope: 'tickets', ticketId: 12, created: { code: 'SOP-00012', by: 'Ana' }, clientId: null },
      ]);
    });

    it('is not announced by any other write that answers with a case', () => {
      expect(announced({ method: 'PATCH', path: '/api/tickets/12', user }, ticket)[0].created).toBeNull();
      expect(announced({ method: 'POST', path: '/api/tickets/12/notes', user }, ticket)[0].created).toBeNull();
    });
  });

  it('says which browser tab made the change, when the request tells', () => {
    expect(announced({ method: 'PATCH', path: '/api/tickets/7', headers: { 'x-client-id': 'tab-1' } })[0].clientId).toBe('tab-1');
    expect(announced({ method: 'PATCH', path: '/api/tickets/7' })[0].clientId).toBeNull();
  });

  describe('spreadsheet import', () => {
    const request: FakeRequest = { method: 'POST', path: '/api/import', headers: { 'x-client-id': 'tab-1' } };

    /** The part of the answer of the import that says what it added to each catalog. */
    const added = (names: { companies?: string[]; assignees?: string[]; supportTypes?: string[] } = {}) => ({
      companies: [],
      assignees: [],
      supportTypes: [],
      ...names,
    });

    // The other browsers reload the lists of companies, responsibles and support types only on a
    // change in the catalogs. Without it, the new cases show there without what the import added.
    it.each([
      ['companies', added({ companies: ['Beta Sur'] })],
      ['responsibles', added({ assignees: ['José Pérez', 'Luis'] })],
      ['support types', added({ supportTypes: ['Consulta'] })],
    ])('also announces a change in the catalogs when it added %s', (_catalog, created) => {
      expect(announced(request, { dryRun: false, createMissing: true, toCreate: 2, created })).toEqual([
        { scope: 'tickets', ticketId: null, created: null, clientId: 'tab-1' },
        { scope: 'catalogs', ticketId: null, created: null, clientId: 'tab-1' },
      ]);
    });

    it('announces only the cases when it added nothing to the catalogs', () => {
      expect(scopes(request, { dryRun: false, toCreate: 2, created: added() })).toEqual(['tickets']);
      expect(scopes(request, { dryRun: false, toCreate: 2 })).toEqual(['tickets']);
      // What the sheet named and the system lacks was not added: its rows were rejected.
      expect(scopes(request, { dryRun: false, toCreate: 2, created: added(), unknown: { companies: ['Beta Sur'] } })).toEqual(['tickets']);
    });

    it('announces nothing for a preview, which writes nothing', () => {
      const preview = { dryRun: true, toCreate: 2, created: added({ assignees: ['José Pérez'] }) };
      expect(announced({ ...request, query: { dryRun: '1' } }, preview)).toEqual([]);
    });
  });
});
