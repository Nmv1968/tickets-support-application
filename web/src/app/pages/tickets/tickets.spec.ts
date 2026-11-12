import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Ticket, TicketDetail, TicketPage } from '../../core/api';
import { TicketEvents } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { TicketsPage } from './tickets';

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 7,
    code: 'SOP-00007',
    date: '2026-11-05',
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
    lastActivityAt: '2026-11-05T10:00:00.000Z',
    stale: false,
    aiGenerated: false,
    customerReply: null,
    createdAt: '2026-11-05T10:00:00.000Z',
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

function page(items: Ticket[]): TicketPage {
  return { items, total: items.length, page: 1, pageSize: 50 };
}

const REFUSED = { status: 400, statusText: 'Bad Request' };
const picture = new File(['png'], 'captura.png', { type: 'image/png' });

/** A paste as the browser reports it: on the element that has the focus, with what was copied. */
function paste(target: Element, files: File[], text?: string): ClipboardEvent {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  if (text !== undefined) data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

// The list with the real Api: the tests act on the controls of the page and on TicketEvents, and
// look at the requests that leave and at what the rows show. Answers arrive when the test sends
// them (fakeAsync), which is what lets one arrive late.
describe('TicketsPage', () => {
  let http: HttpTestingController;
  let events: TicketEvents;
  let fixture: ComponentFixture<TicketsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(TicketEvents);
  });

  // Also catches a read nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  /** A read of the list that is on its way. */
  const listRead = (): TestRequest => http.expectOne((request) => request.method === 'GET' && request.url === '/api/tickets');
  const companies = (): TestRequest => http.expectOne({ method: 'GET', url: '/api/tickets/companies' });

  /** A screen update as the browser runs it: ngModel writes a changed value into its control right after. */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  /** Lets what was answered reach the screen. */
  function settle(): void {
    tick();
    render();
  }

  function open(items: Ticket[] = [ticket()]): void {
    fixture = TestBed.createComponent(TicketsPage);
    el = fixture.nativeElement as HTMLElement;
    render();
    companies().flush([]);
    listRead().flush(page(items));
    settle();
  }

  function find<T extends HTMLElement>(selector: string): T {
    const found = el.querySelector<T>(selector);
    if (!found) throw new Error(`Nothing on screen matches ${selector}`);
    return found;
  }

  function click(target: HTMLElement): void {
    target.click();
    render();
  }

  /** The status select of the row of case 7 in the table. */
  const rowStatus = (): HTMLSelectElement => find('select[aria-label="Estado de SOP-00007"]');
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);

  describe('a case saved by this tab', () => {
    // The read may have been taken before the save was stored: shown, it would undo the save on screen.
    it('while the list is being read is shown on its row, and the list is read again', fakeAsync(() => {
      open();
      // Someone else changed a case: the list is read again.
      events.outdated(null);
      const stale = listRead();

      events.saved(ticket({ status: 'RESOLVED' }));
      render();
      expect(rowStatus().value).toBe('RESOLVED');
      const fresh = listRead();

      stale.flush(page([ticket()]));
      settle();
      expect(rowStatus().value).toBe('RESOLVED');

      fresh.flush(page([ticket({ status: 'RESOLVED', company: 'Acme del Sur' })]));
      settle();
      expect(rowStatus().value).toBe('RESOLVED');
      expect(el.textContent).toContain('Acme del Sur');
    }));

    it('with no read on its way is shown on its row, and the list is not read', fakeAsync(() => {
      open();
      events.saved(ticket({ status: 'RESOLVED', company: 'Acme del Sur' }));
      render();

      expect(rowStatus().value).toBe('RESOLVED');
      expect(el.textContent).toContain('Acme del Sur');
      http.expectNone((request) => request.url === '/api/tickets');
    }));
  });

  describe('a row edit the server refuses', () => {
    it('puts the row back as the case is stored, before the list is read again', fakeAsync(() => {
      open();
      const status = rowStatus();
      status.value = 'RESOLVED';
      status.dispatchEvent(new Event('change'));
      render();
      // Shown before it is stored.
      expect(status.classList).toContain('st-RESOLVED');

      const save = http.expectOne({ method: 'PATCH', url: '/api/tickets/7' });
      expect(save.request.body).toEqual({ status: 'RESOLVED' });
      save.flush({ message: 'No se puede resolver' }, REFUSED);
      settle();

      expect(status.value).toBe('PENDING');
      expect(status.classList).toContain('st-PENDING');
      expect(toasts()).toEqual(['No se puede resolver']);

      listRead().flush(page([ticket()]));
      settle();
      expect(status.value).toBe('PENDING');
    }));
  });

  describe('a paste', () => {
    it('of a screenshot opens "Nuevo caso con IA" with it', fakeAsync(() => {
      open();
      const event = paste(document.body, [picture]);
      render();
      // The dialog asks for the companies it suggests.
      companies().flush([]);
      settle();

      expect(event.defaultPrevented).toBeTrue();
      expect(find('app-ai-draft').querySelectorAll('img').length).toBe(1);
    }));

    // A cell copied from Excel carries its text and a picture of the cell.
    it('of text into a field is left to the browser, even when the clipboard also has a picture of it', fakeAsync(() => {
      open();
      const fields = [find('input[type=search]'), find('input[aria-label="Empresa del caso nuevo"]'), find('input[aria-label="Descripción del caso nuevo"]')];
      for (const field of fields) {
        const event = paste(field, [picture], 'Ferretería El Tornillo');
        render();
        expect(event.defaultPrevented).toBeFalse();
        expect(el.querySelector('app-ai-draft')).toBeNull();
      }
    }));
  });

  // Below 640 px their text is hidden, and a hidden text names nothing.
  describe('Importar and Exportar, which show only their icon on a phone', () => {
    const exportButton = (): HTMLButtonElement => find('button[aria-haspopup=menu]');

    it('have a name of their own', fakeAsync(() => {
      open();
      expect(find('button .mdi-file-import-outline').closest('button')!.getAttribute('aria-label')).toBe('Importar');
      expect(exportButton().getAttribute('aria-label')).toBe('Exportar');
    }));

    it('Exportar says so in its name while the file is being generated', fakeAsync(() => {
      open();
      click(exportButton());
      click(find('[role=menu] button'));
      const download = http.expectOne((request) => request.url === '/api/export/xlsx');
      expect(exportButton().getAttribute('aria-label')).toBe('Generando…');
      expect(exportButton().disabled).toBeTrue();

      // No connection: there is no file to hand to the browser.
      download.error(new ProgressEvent('error'));
      settle();
      expect(exportButton().getAttribute('aria-label')).toBe('Exportar');
      expect(exportButton().disabled).toBeFalse();
    }));
  });
});
