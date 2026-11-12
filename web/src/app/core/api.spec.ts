import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Api, withReadableBody } from './api';
import type { TicketDetail } from './api';
import { TicketEvents } from './ticket-events';
import type { TicketEvent } from './ticket-events';
import { errorMessage } from './ui';

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 7,
    code: 'SOP-00007',
    date: '2026-11-01',
    time: null,
    company: 'Acme',
    description: 'No imprime',
    status: 'PENDING',
    assigneeId: null,
    assignedToClient: false,
    assigneeName: null,
    priority: null,
    estimatedMinutes: null,
    spentMinutes: 0,
    timerStartedAt: null,
    moduleId: null,
    moduleName: null,
    dueAt: null,
    promisedDate: null,
    promiseState: null,
    resolvedAt: null,
    overdue: false,
    lastActivityAt: '2026-11-01T10:00:00.000Z',
    stale: false,
    aiGenerated: false,
    customerReply: null,
    createdAt: '2026-11-01T10:00:00.000Z',
    lastNote: null,
    notesCount: 0,
    attachmentsCount: 0,
    createdByName: null,
    notes: [],
    attachments: [],
    history: [],
    ...overrides,
  };
}

/** Lets the promise chains that follow an answered request run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

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
    const write = api.createTicket({ company: 'Acme', description: 'No imprime' });
    expect(seen).toEqual([]);

    http.expectOne({ method: 'POST', url: '/api/tickets' }).flush(stored);
    expect(await write).toEqual(stored);
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: true }]);
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
      expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false }]);
    });
  }

  // A panel that closes before its save is answered drops the promise; the screens still follow.
  it('announces a write that nobody waits for', async () => {
    const stored = ticket();
    void api.updateTicket(7, { company: 'Acme' });

    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush(stored);
    await settle();
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false }]);
  });

  it('announces two writes answered in the same turn as two events, in order', async () => {
    const first = api.updateTicket(7, { status: 'RESOLVED' });
    const second = api.updateTicket(8, { status: 'RESOLVED' });

    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush(ticket({ id: 7 }));
    http.expectOne({ method: 'PATCH', url: '/api/tickets/8' }).flush(ticket({ id: 8 }));
    await Promise.all([first, second]);
    expect(seen).toEqual([
      { kind: 'saved', ticket: ticket({ id: 7 }), created: false },
      { kind: 'saved', ticket: ticket({ id: 8 }), created: false },
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
    const creation = api.createTicket({ company: '' });
    http.expectOne({ method: 'POST', url: '/api/tickets' }).flush({ message: 'La empresa es obligatoria' }, REJECTED);
    await expectAsync(creation).toBeRejected();

    const update = api.updateTicket(7, { company: '' });
    http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush({ message: 'La empresa es obligatoria' }, REJECTED);
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
    await settle();
    expect(seen).toEqual([]);

    http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(stored);
    expect(await write).toEqual(stored);
    expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false }]);
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
