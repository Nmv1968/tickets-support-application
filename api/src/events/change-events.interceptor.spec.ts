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
      ['PATCH', '/api/modules/3'],
      ['POST', '/api/users'],
      ['PATCH', '/api/users/5'],
      ['PUT', '/api/sla'],
      ['PUT', '/api/ai/config/openai'],
    ])('%s %s announces a change in the catalogs', (method, path) => {
      expect(scopes({ method, path })).toEqual(['catalogs']);
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
      expect(announced({ method: 'POST', path: '/api/import' }, { created: 4, newPeople: [] })[0].ticketId).toBeNull();
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

    // The other browsers reload the people list only on a change in the catalogs.
    it('also announces a change in the catalogs when it created people', () => {
      expect(announced(request, { dryRun: false, created: 2, newPeople: ['José Pérez', 'Luis'] })).toEqual([
        { scope: 'tickets', ticketId: null, created: null, clientId: 'tab-1' },
        { scope: 'catalogs', ticketId: null, created: null, clientId: 'tab-1' },
      ]);
    });

    it('announces only the cases when it created no people', () => {
      expect(scopes(request, { dryRun: false, created: 2, newPeople: [] })).toEqual(['tickets']);
      expect(scopes(request, { dryRun: false, created: 2 })).toEqual(['tickets']);
    });

    it('announces nothing for a preview, which writes nothing', () => {
      expect(announced({ ...request, query: { dryRun: '1' } }, { dryRun: true, toCreate: 2, newPeople: ['José Pérez'] })).toEqual([]);
    });
  });
});
