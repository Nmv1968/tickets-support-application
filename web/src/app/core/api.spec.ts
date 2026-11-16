import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ticket } from '../testing/fixtures';
import { nextTask } from '../testing/screen';
import { Api, withReadableBody } from './api';
import type { TicketDetail } from './api';
import { TicketEvents } from './ticket-events';
import type { TicketEvent } from './ticket-events';
import { errorMessage } from './ui';

const REJECTED = { status: 400, statusText: 'Bad Request' };

// The list, the board, an open panel, the dashboard and the bell follow cases only through
// what Api announces here, so a write that stops announcing leaves all of them out of date.
describe('Api, announcing changes to cases', () => {
  let api: Api;
  let http: HttpTestingController;
  let seen: TicketEvent[];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
    seen = [];
    TestBed.inject(TicketEvents).events.subscribe((event) => seen.push(event));
  });

  afterEach(() => http.verify());

  it('announces a new case as created, once the server has stored it', async () => {
    const stored = ticket();
    const write = api.createTicket({ companyId: 1, description: 'No imprime' });
    expect(seen).toEqual([]);

    http.expectOne({ method: 'POST', url: '/api/tickets' }).flush(stored);
    expect(await write).toEqual(stored);
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: true, archiving: false }]);
  });

  const writes: { name: string; method: string; url: string; run: () => Promise<TicketDetail> }[] = [
    { name: 'updateTicket', method: 'PATCH', url: '/api/tickets/7', run: () => api.updateTicket(7, { status: 'RESOLVED' }) },
    { name: 'addNote', method: 'POST', url: '/api/tickets/7/notes', run: () => api.addNote(7, 'Se llamó al cliente') },
    { name: 'deleteNote', method: 'DELETE', url: '/api/tickets/7/notes/3', run: () => api.deleteNote(7, 3) },
    { name: 'timer', method: 'POST', url: '/api/tickets/7/timer/start', run: () => api.timer(7, 'start') },
    {
      name: 'uploadAttachments',
      method: 'POST',
      url: '/api/tickets/7/attachments',
      run: () => api.uploadAttachments(7, [new File(['x'], 'captura.png', { type: 'image/png' })]),
    },
    { name: 'aiReply', method: 'POST', url: '/api/ai/reply/7', run: () => api.aiReply(7) },
  ];

  for (const { name, method, url, run } of writes) {
    it(`${name} announces the case as the server stored it`, async () => {
      const stored = ticket({ company: 'Guardado por el servidor' });
      const write = run();
      expect(seen).toEqual([]);

      http.expectOne({ method, url }).flush(stored);
      expect(await write).toEqual(stored);
      expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false, archiving: false }]);
    });
  }

  // An archived case leaves the lists, and one brought back joins them again: the lists are told
  // by the save, since a case that was put away has no row left to tell it by.
  for (const archived of [true, false]) {
    it(`announces a save that ${archived ? 'archives a case' : 'brings a case back from the archive'} as such`, async () => {
      const stored = ticket({ archivedAt: archived ? '2026-11-08T09:00:00.000Z' : null });
      const write = api.updateTicket(7, { archived });

      http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush(stored);
      await write;
      expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false, archiving: true }]);
    });
  }

  // A panel that closes before its save is answered drops the promise; the screens still follow.
  it('announces a write that nobody waits for', async () => {
    const stored = ticket();
    void api.updateTicket(7, { companyId: 1 });

    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush(stored);
    await nextTask();
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false, archiving: false }]);
  });

  it('announces two writes answered in the same turn as two events, in order', async () => {
    const first = api.updateTicket(7, { status: 'RESOLVED' });
    const second = api.updateTicket(8, { status: 'RESOLVED' });

    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush(ticket({ id: 7 }));
    http.expectOne({ method: 'PATCH', url: '/api/tickets/8' }).flush(ticket({ id: 8 }));
    await Promise.all([first, second]);
    expect(seen).toEqual([
      { kind: 'saved', ticket: ticket({ id: 7 }), created: false, archiving: false },
      { kind: 'saved', ticket: ticket({ id: 8 }), created: false, archiving: false },
    ]);
  });

  it('announces a deleted case, once the server has deleted it', async () => {
    const removal = api.deleteTicket(7);
    expect(seen).toEqual([]);

    http.expectOne({ method: 'DELETE', url: '/api/tickets/7' }).flush(null);
    await removal;
    expect(seen).toEqual([{ kind: 'removed', id: 7 }]);
  });

  it('announces nothing when the server rejects the write', async () => {
    const creation = api.createTicket({ description: 'No imprime' });
    http.expectOne({ method: 'POST', url: '/api/tickets' }).flush({ message: 'La empresa es obligatoria' }, REJECTED);
    await expectAsync(creation).toBeRejected();

    const update = api.updateTicket(7, { companyId: 99 });
    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush({ message: 'La empresa no existe' }, REJECTED);
    await expectAsync(update).toBeRejected();

    const removal = api.deleteTicket(7);
    http.expectOne({ method: 'DELETE', url: '/api/tickets/7' }).flush({ message: 'Caso no encontrado' }, { status: 404, statusText: 'Not Found' });
    await expectAsync(removal).toBeRejected();

    expect(seen).toEqual([]);
  });

  // Deleting an attachment answers nothing, so the case is read again to have something to announce.
  it('reads the case again after deleting an attachment, and announces it', async () => {
    const stored = ticket({ attachmentsCount: 1 });
    const write = api.deleteAttachment(7, 31);

    http.expectNone('/api/tickets/7');
    http.expectOne({ method: 'DELETE', url: '/api/attachments/31' }).flush(null);
    await nextTask();
    expect(seen).toEqual([]);

    http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(stored);
    expect(await write).toEqual(stored);
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false, archiving: false }]);
  });

  it('announces nothing when the attachment could not be deleted', async () => {
    const write = api.deleteAttachment(7, 31);
    http.expectOne({ method: 'DELETE', url: '/api/attachments/31' }).flush({ message: 'Adjunto no encontrado' }, { status: 404, statusText: 'Not Found' });
    await expectAsync(write).toBeRejected();

    http.expectNone('/api/tickets/7');
    expect(seen).toEqual([]);
  });

  it('announces a real import as "any case may have changed", and a preview not at all', async () => {
    const file = new File(['x'], 'casos.xlsx');

    const preview = api.importFile(file, true, 'dmy');
    http.expectOne((request) => request.url === '/api/import' && request.params.get('dryRun') === '1').flush({ dryRun: true });
    await preview;
    expect(seen).toEqual([]);

    const real = api.importFile(file, false, 'dmy');
    http.expectOne((request) => request.url === '/api/import' && !request.params.has('dryRun')).flush({ dryRun: false });
    await real;
    expect(seen).toEqual([{ kind: 'outdated', id: null }]);
  });

  it('announces nothing for a read', async () => {
    const read = api.ticket(7);
    http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
    await read;

    const list = api.tickets({ status: 'PENDING' });
    http.expectOne((request) => request.method === 'GET' && request.url === '/api/tickets').flush({ items: [], total: 0, page: 1, pageSize: 50 });
    await list;

    expect(seen).toEqual([]);
  });
});

// An export or a download asks for a file, so Angular hands the error body over as a file too.
// The server's explanation (for example, a PDF over its limit) must still reach the person.
describe('Api, a refused file request', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function refuse(body: string, type: string): Promise<unknown> {
    const request = api.exportFile('pdf', {}).then(
      () => fail('the export should have been refused'),
      (error: unknown) => error,
    );
    http.expectOne((r) => r.url === '/api/export/pdf').flush(new Blob([body], { type }), { status: 400, statusText: 'Bad Request' });
    return request;
  }

  it('carries the message the server wrote', async () => {
    const error = await refuse(JSON.stringify({ message: 'La exportación a PDF admite hasta 5000 casos' }), 'application/json');
    expect(errorMessage(error)).toBe('La exportación a PDF admite hasta 5000 casos');
    expect((error as HttpErrorResponse).status).toBe(400);
  });

  it('keeps the plain status when the body is not JSON', async () => {
    const error = await refuse('<html>Bad Gateway</html>', 'text/html');
    expect(errorMessage(error)).toBe('Error 400');
  });

  it('leaves other errors as they came', async () => {
    const other = new Error('sin red');
    expect(await withReadableBody(other)).toBe(other);
  });
});

describe('Api, the import template', () => {
  it('asks the server for the spreadsheet as a file', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);
    const file = new Blob(['xlsx']);

    const download = TestBed.inject(Api).importTemplate();
    const request = http.expectOne({ method: 'GET', url: '/api/import/template' });
    expect(request.request.responseType).toBe('blob');
    request.flush(file);

    expect(await download).toBe(file);
    http.verify();
  });
});

// Small settings of the web that each person chooses for themselves (the columns of the list).
// The server keeps them for whoever is logged in: no user travels in the request.
describe('Api, the preferences of the logged-in user', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('reads what was saved under a key', async () => {
    const read = api.preference<{ visible: string[] }>('tickets.columns');
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.columns' }).flush({ value: { visible: ['code', 'company'] } });

    expect(await read).toEqual({ visible: ['code', 'company'] });
  });

  it('reads nothing for a key that was never saved', async () => {
    const read = api.preference<boolean>('tickets.filters-open');
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.filters-open' }).flush({ value: null });

    expect(await read).toBeNull();
  });

  // `false` is a value like any other: it is what "closed" is saved as.
  it('saves any value under its key, a false one too', async () => {
    const save = api.savePreference('tickets.filters-open', false);
    const request = http.expectOne({ method: 'PUT', url: '/api/preferences/tickets.filters-open' });
    expect(request.request.body).toEqual({ value: false });
    request.flush(null);

    await save;
  });
});

describe('Api, the catalogs of companies and support types', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('adds, changes and deletes a company', async () => {
    const acme = { id: 4, name: 'Acme', active: true, tickets: 0 };

    const added = api.createCompany('Acme');
    const post = http.expectOne({ method: 'POST', url: '/api/companies' });
    expect(post.request.body).toEqual({ name: 'Acme' });
    post.flush(acme);
    expect(await added).toEqual(acme);

    const changed = api.updateCompany(4, { active: false });
    const patch = http.expectOne({ method: 'PATCH', url: '/api/companies/4' });
    expect(patch.request.body).toEqual({ active: false });
    patch.flush({ ...acme, active: false });
    expect((await changed).active).toBeFalse();

    const removed = api.deleteCompany(4);
    http.expectOne({ method: 'DELETE', url: '/api/companies/4' }).flush(null);
    await removed;
  });

  it('adds, changes and deletes a support type', async () => {
    const failure = { id: 2, name: 'Falla del sistema', color: '#b91c1c', active: true, tickets: 0 };

    const added = api.createSupportType({ name: 'Falla del sistema', color: '#b91c1c' });
    const post = http.expectOne({ method: 'POST', url: '/api/support-types' });
    expect(post.request.body).toEqual({ name: 'Falla del sistema', color: '#b91c1c' });
    post.flush(failure);
    expect(await added).toEqual(failure);

    const changed = api.updateSupportType(2, { color: '#0c7beb' });
    const patch = http.expectOne({ method: 'PATCH', url: '/api/support-types/2' });
    expect(patch.request.body).toEqual({ color: '#0c7beb' });
    patch.flush({ ...failure, color: '#0c7beb' });
    expect((await changed).color).toBe('#0c7beb');

    const removed = api.deleteSupportType(2);
    http.expectOne({ method: 'DELETE', url: '/api/support-types/2' }).flush(null);
    await removed;
  });
});

describe('Api, the filters of the list of cases', () => {
  it('sends the ones that have a value, ids as they come from a select, and leaves the empty ones out', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const http = TestBed.inject(HttpTestingController);

    const list = TestBed.inject(Api).tickets({ companyId: 4, assignee: 'none', supportType: 2, createdBy: 7, archived: 'only', moduleId: null, priority: '', status: 'PENDING' });
    const request = http.expectOne((r) => r.url === '/api/tickets');
    const sent = Object.fromEntries(request.request.params.keys().map((key) => [key, request.request.params.get(key)]));
    expect(sent).toEqual({ companyId: '4', assignee: 'none', supportType: '2', createdBy: '7', archived: 'only', status: 'PENDING' });
    request.flush({ items: [], total: 0, page: 1, pageSize: 50 });

    await list;
    http.verify();
  });
});

// The dashboard counts archived cases unless told not to, on screen and in the files it exports.
describe('Api, the dashboard and its report', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('asks for the period with the archived cases, or without them', () => {
    void api.dashboard('2026-01-01', '2026-11-12');
    const withArchived = http.expectOne((r) => r.url === '/api/dashboard');
    expect(withArchived.request.params.get('from')).toBe('2026-01-01');
    expect(withArchived.request.params.get('to')).toBe('2026-11-12');
    expect(withArchived.request.params.has('archived')).toBeFalse();
    withArchived.flush({});

    void api.dashboard(undefined, undefined, false);
    const without = http.expectOne((r) => r.url === '/api/dashboard');
    expect(without.request.params.keys()).toEqual(['archived']);
    expect(without.request.params.get('archived')).toBe('exclude');
    without.flush({});
  });

  for (const format of ['xlsx', 'pdf'] as const) {
    it(`downloads the report as ${format}, for the same period and cases as the screen`, async () => {
      const file = new Blob(['report']);
      const download = api.dashboardExport(format, '2026-01-01', '', false);

      const request = http.expectOne((r) => r.url === `/api/dashboard/export/${format}`);
      expect(request.request.responseType).toBe('blob');
      expect(request.request.params.get('from')).toBe('2026-01-01');
      // No end of the period: not sent.
      expect(request.request.params.has('to')).toBeFalse();
      expect(request.request.params.get('archived')).toBe('exclude');
      request.flush(file);

      expect(await download).toBe(file);
    });
  }

  it('carries the reason when the server refuses a report', async () => {
    const refused = api.dashboardExport('xlsx').then(
      () => fail('the report should have been refused'),
      (error: unknown) => error,
    );
    http
      .expectOne((r) => r.url === '/api/dashboard/export/xlsx')
      .flush(new Blob([JSON.stringify({ message: 'Son demasiados casos para un Excel' })], { type: 'application/json' }), { status: 400, statusText: 'Bad Request' });

    expect(errorMessage(await refused)).toBe('Son demasiados casos para un Excel');
  });
});

describe('Api, an import that may add what the catalogs lack', () => {
  it('asks for it only when told to', async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const api = TestBed.inject(Api);
    const http = TestBed.inject(HttpTestingController);
    const file = new File(['x'], 'casos.xlsx');

    const strict = api.importFile(file, true, 'dmy');
    const first = http.expectOne((r) => r.url === '/api/import');
    expect(first.request.params.has('createMissing')).toBeFalse();
    first.flush({ dryRun: true, createMissing: false });
    await strict;

    const creating = api.importFile(file, true, 'dmy', true);
    const second = http.expectOne((r) => r.url === '/api/import');
    expect(second.request.params.get('createMissing')).toBe('1');
    expect(second.request.params.get('dryRun')).toBe('1');
    second.flush({ dryRun: true, createMissing: true });
    expect((await creating).createMissing).toBeTrue();
    http.verify();
  });
});

// The screens ask for the same reads again and again, and only the latest answer counts: an older
// read is cancelled with the signal it was given (see core/loading).
describe('Api, a read that is no longer wanted', () => {
  let api: Api;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(Api);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  const file = new File(['x'], 'casos.xlsx');
  const reads: { name: string; url: string; run: (abort: AbortSignal) => Promise<unknown> }[] = [
    { name: 'tickets', url: '/api/tickets', run: (abort) => api.tickets({ status: 'PENDING' }, abort) },
    { name: 'ticket', url: '/api/tickets/7', run: (abort) => api.ticket(7, abort) },
    { name: 'dashboard', url: '/api/dashboard', run: (abort) => api.dashboard('2026-01-01', '2026-11-12', false, abort) },
    { name: 'the preview of an import', url: '/api/import', run: (abort) => api.importFile(file, true, 'dmy', false, abort) },
  ];

  for (const { name, url, run } of reads) {
    it(`${name}: aborted, its request is cancelled and the promise fails with the reason of the abort`, async () => {
      const abort = new AbortController();
      const read = run(abort.signal);
      const request = http.expectOne((sent) => sent.url === url);
      expect(request.cancelled).toBeFalse();

      abort.abort();
      expect(request.cancelled).toBeTrue();
      await expectAsync(read).toBeRejectedWith(abort.signal.reason);
    });

    it(`${name}: answered, is not touched by an abort that comes after`, async () => {
      const abort = new AbortController();
      const read = run(abort.signal);
      http.expectOne((sent) => sent.url === url).flush({});
      await expectAsync(read).toBeResolved();
      abort.abort();
    });
  }

  it('already aborted: sends nothing', async () => {
    const abort = new AbortController();
    abort.abort();
    await expectAsync(api.tickets({}, abort.signal)).toBeRejectedWith(abort.signal.reason);
    http.expectNone('/api/tickets');
  });

  it('that fails before it is aborted: fails with what the server said', async () => {
    const abort = new AbortController();
    const read = api.ticket(7, abort.signal);
    http.expectOne('/api/tickets/7').flush({ message: 'Caso no encontrado' }, { status: 404, statusText: 'Not Found' });
    const error: unknown = await read.catch((failure: unknown) => failure);
    expect(errorMessage(error)).toBe('Caso no encontrado');
  });

  // Cancelled on its way, a write may be stored all the same, and nobody would hear of it.
  it('a real import is never cancelled, even when given a signal', async () => {
    const abort = new AbortController();
    const real = api.importFile(file, false, 'dmy', false, abort.signal);
    const request = http.expectOne((sent) => sent.url === '/api/import' && !sent.params.has('dryRun'));
    abort.abort();
    expect(request.cancelled).toBeFalse();
    request.flush({ dryRun: false });
    await expectAsync(real).toBeResolved();
  });
});
