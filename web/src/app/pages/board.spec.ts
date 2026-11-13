import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { Assignee, Ticket, TicketDetail, TicketPage, TicketStatus } from '../core/api';
import { Catalogs } from '../core/catalogs';
import { TicketEvents } from '../core/ticket-events';
import { Toast } from '../core/toast';
import { chooseOption, clearSelect, closeSelect, ngSelect, optionTexts, selectedTexts } from '../testing/ng-select';
import { BoardPage } from './board';

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 7,
    code: 'SOP-00007',
    date: '2026-11-05',
    time: null,
    companyId: 1,
    company: 'Acme',
    description: 'No imprime',
    status: 'PENDING',
    assigneeId: null,
    assigneeName: null,
    supportTypes: [],
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
    createdById: null,
    archivedAt: null,
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
  return { items, total: items.length, page: 1, pageSize: 500 };
}

/** One read of the board: the open cases and the latest resolved ones, asked for together. */
interface BoardRead {
  open: TestRequest;
  resolved: TestRequest;
}

const REFUSED = { status: 400, statusText: 'Bad Request' };

// The responsibles of the catalog. One is deactivated: the cases they have are still theirs.
const ASSIGNEES: Assignee[] = [
  { id: 4, name: 'Ana', active: true, tickets: 1 },
  { id: 5, name: 'Luis', active: true, tickets: 0 },
  { id: 6, name: 'Zoe', active: false, tickets: 2 },
];
const OF_ANA = ticket({ id: 8, code: 'SOP-00008', assigneeId: 4, assigneeName: 'Ana' });
const OF_ZOE = ticket({ id: 9, code: 'SOP-00009', status: 'RESOLVED', assigneeId: 6, assigneeName: 'Zoe' });
const ARCHIVED = '2026-11-08T09:00:00.000Z';

// The board with the real Api: the tests act on the page and on TicketEvents, and look at the
// requests that leave and at the column each card is in. Answers arrive when the test sends
// them (fakeAsync), which is what lets one arrive late.
describe('BoardPage', () => {
  let http: HttpTestingController;
  let events: TicketEvents;
  let fixture: ComponentFixture<BoardPage>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(TicketEvents);
    TestBed.inject(Catalogs).assignees.set(ASSIGNEES);
  });

  // Also catches a read nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  /** The read of the board that is on its way. */
  function read(): BoardRead {
    const of = (status: string): TestRequest => http.expectOne((request) => request.url === '/api/tickets' && request.params.get('status') === status);
    return { open: of('UNRESOLVED,PENDING'), resolved: of('RESOLVED') };
  }

  /** Answers a read with these cases, each in the request that asks for its status. */
  function answer(pending: BoardRead, tickets: Ticket[]): void {
    pending.open.flush(page(tickets.filter((t) => t.status !== 'RESOLVED')));
    pending.resolved.flush(page(tickets.filter((t) => t.status === 'RESOLVED')));
  }

  /**
   * A screen update as the browser runs it. ngModel does not write a changed value into its
   * control while Angular goes through the page but right after, before any other event.
   */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  /** Lets what was answered reach the screen. */
  function settle(): void {
    tick();
    render();
  }

  /** Creates the board with its first read still on its way. */
  function create(): void {
    fixture = TestBed.createComponent(BoardPage);
    el = fixture.nativeElement as HTMLElement;
    render();
  }

  function open(tickets: Ticket[] = [ticket()]): void {
    create();
    answer(read(), tickets);
    settle();
  }

  /** The text of the cards of a column, named as on screen. */
  function column(label: string): string {
    const section = el.querySelector(`section[aria-label="${label}"]`);
    if (!section) throw new Error(`No "${label}" column on screen`);
    return Array.from(section.querySelectorAll('article'), (card) => card.textContent).join('\n');
  }

  /**
   * The end of a drag, as the drag and drop library reports it to the board: this card was
   * dropped on the column of this status. The drag itself (pointer events) is the library's.
   */
  function drop(code: string, status: TicketStatus): void {
    const directives = <T>(type: new (...args: never[]) => T): T[] => fixture.debugElement.queryAll(By.directive(type)).map((found) => found.injector.get(type));
    const item = directives<CdkDrag<Ticket>>(CdkDrag).find((card) => card.data.code === code);
    const container = directives<CdkDropList<TicketStatus>>(CdkDropList).find((list) => list.data === status);
    if (!item || !container) throw new Error(`No card ${code} or no column ${status} on screen`);
    const dropped: CdkDragDrop<TicketStatus, TicketStatus, Ticket> = {
      item,
      container,
      previousContainer: item.dropContainer,
      previousIndex: 0,
      currentIndex: 0,
      isPointerOverContainer: true,
      distance: { x: 0, y: 0 },
      dropPoint: { x: 0, y: 0 },
      event: new MouseEvent('mouseup'),
    };
    container.dropped.emit(dropped);
    render();
  }

  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);
  /** The codes of the cards on the board, column after column. */
  const cards = (): string[] => Array.from(el.querySelectorAll('article .font-mono'), (code) => code.textContent ?? '');
  const filter = (): HTMLElement => ngSelect(el, 'Filtrar por responsable');

  describe('answers that arrive out of order', () => {
    it('the answer to an older read does not replace the one to the latest read', fakeAsync(() => {
      create();
      const older = read();
      el.querySelector<HTMLButtonElement>('button[aria-label="Actualizar"]')!.click();
      const newer = read();

      answer(newer, [ticket({ company: 'Acme del Sur' })]);
      settle();
      expect(column('Pendiente')).toContain('Acme del Sur');

      answer(older, [ticket({ status: 'UNRESOLVED' })]);
      settle();
      expect(column('Pendiente')).toContain('Acme del Sur');
      expect(column('Sin resolver')).toBe('');
    }));

    it('the board keeps saying it is loading until the latest read is answered', fakeAsync(() => {
      create();
      const older = read();
      el.querySelector<HTMLButtonElement>('button[aria-label="Actualizar"]')!.click();
      const newer = read();

      answer(older, [ticket()]);
      settle();
      expect(el.textContent).toContain('Cargando…');
      expect(column('Pendiente')).toBe('');

      answer(newer, [ticket()]);
      settle();
      expect(el.textContent).not.toContain('Cargando…');
      expect(column('Pendiente')).toContain('SOP-00007');
    }));
  });

  describe('a case saved by this tab', () => {
    // The read may have been taken before the save was stored: shown, it would undo the save on screen.
    it('while the columns are being read moves its card, and the columns are read again', fakeAsync(() => {
      open();
      // Someone else changed a case: the columns are read again.
      events.outdated(null);
      const stale = read();

      events.saved(ticket({ status: 'UNRESOLVED' }));
      render();
      expect(column('Sin resolver')).toContain('SOP-00007');
      const fresh = read();

      answer(stale, [ticket()]);
      settle();
      expect(column('Sin resolver')).toContain('SOP-00007');
      expect(column('Pendiente')).toBe('');

      answer(fresh, [ticket({ status: 'UNRESOLVED', company: 'Acme del Sur' })]);
      settle();
      expect(column('Sin resolver')).toContain('Acme del Sur');
    }));

    it('with no read on its way moves its card, and the columns are not read', fakeAsync(() => {
      open();
      events.saved(ticket({ status: 'UNRESOLVED' }));
      render();

      expect(column('Sin resolver')).toContain('SOP-00007');
      expect(column('Pendiente')).toBe('');
      http.expectNone((request) => request.url === '/api/tickets');
    }));
  });

  describe('the filter by responsible', () => {
    it('is a list, not a native one, of everyone in the catalog, active or not, and of the cases nobody has', fakeAsync(() => {
      open();
      expect(el.querySelector('select')).toBeNull();
      expect(selectedTexts(filter())).toEqual([]);
      expect(filter().textContent).toContain('Responsable: todos');

      expect(optionTexts(filter())).toEqual(['Sin asignar', 'Ana', 'Luis', 'Zoe']);
      closeSelect(filter());
      render();
    }));

    it('leaves on the board the cards of the responsible chosen, and brings the rest back when it is emptied', fakeAsync(() => {
      open([ticket(), OF_ANA, OF_ZOE]);
      expect(cards()).toEqual(['SOP-00007', 'SOP-00008', 'SOP-00009']);

      chooseOption(filter(), 'Ana');
      render();
      expect(selectedTexts(filter())).toEqual(['Ana']);
      expect(cards()).toEqual(['SOP-00008']);

      // Someone deactivated still has the cases they had.
      chooseOption(filter(), 'Zoe');
      render();
      expect(cards()).toEqual(['SOP-00009']);
      expect(column('Resuelto')).toContain('SOP-00009');

      clearSelect(filter());
      render();
      expect(cards()).toEqual(['SOP-00007', 'SOP-00008', 'SOP-00009']);
      // The cards were already there: choosing reads nothing.
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    it('with "Sin asignar" leaves the cards of the cases nobody has', fakeAsync(() => {
      open([ticket(), OF_ANA, OF_ZOE]);
      chooseOption(filter(), 'Sin asignar');
      render();

      expect(cards()).toEqual(['SOP-00007']);
    }));
  });

  describe('a card', () => {
    it('shows the support types of its case as chips, each in its colour, and none for a case without them', fakeAsync(() => {
      const types = [
        { id: 1, name: 'Capacitación', color: '#12b76a' },
        { id: 2, name: 'Falla del sistema', color: '#b91c1c' },
      ];
      open([ticket({ supportTypes: types }), OF_ANA]);

      const [typed, plain] = Array.from(el.querySelectorAll('article'));
      const chips = Array.from(typed.querySelectorAll<HTMLElement>('app-type-chip'));
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Capacitación', 'Falla del sistema']);
      expect(chips.map((chip) => chip.style.backgroundColor)).toEqual(['rgb(18, 183, 106)', 'rgb(185, 28, 28)']);
      expect(plain.querySelector('app-type-chip')).toBeNull();
    }));
  });

  // An archived case is put away: it is on no column, whatever its status.
  describe('archived cases', () => {
    it('are not asked for: the board reads what the API lists when nothing is said about them', fakeAsync(() => {
      create();
      const pending = read();
      expect(pending.open.request.params.has('archived')).toBeFalse();
      expect(pending.resolved.request.params.has('archived')).toBeFalse();
      answer(pending, []);
      settle();
    }));

    it('a case that is archived, in its form or anywhere else, leaves the board, and nothing is read for it', fakeAsync(() => {
      open([ticket(), OF_ANA]);
      events.saved(ticket({ archivedAt: ARCHIVED }));
      render();

      expect(cards()).toEqual(['SOP-00008']);
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    it('one that was not on the board changes nothing on it, and nothing is read for it', fakeAsync(() => {
      open([ticket()]);
      events.saved(ticket({ id: 40, code: 'SOP-00040', archivedAt: ARCHIVED }));
      render();

      expect(cards()).toEqual(['SOP-00007']);
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    // The read may have been taken before the case was archived: shown, it would put the card back.
    it('a case archived while the columns are being read stays out, and the columns are read again', fakeAsync(() => {
      open([ticket(), OF_ANA]);
      events.outdated(null);
      const stale = read();

      events.saved(ticket({ archivedAt: ARCHIVED }));
      render();
      expect(cards()).toEqual(['SOP-00008']);
      const fresh = read();

      answer(stale, [ticket(), OF_ANA]);
      settle();
      expect(cards()).toEqual(['SOP-00008']);

      answer(fresh, [OF_ANA]);
      settle();
      expect(cards()).toEqual(['SOP-00008']);
    }));

    it('a case brought back from the archive is on the board again once its columns are read', fakeAsync(() => {
      open([OF_ANA]);
      events.saved(ticket());
      render();

      answer(read(), [ticket(), OF_ANA]);
      settle();
      expect(cards()).toEqual(['SOP-00007', 'SOP-00008']);
    }));
  });

  describe('a card dropped on another column', () => {
    it('moves at once and stays when the change is stored', fakeAsync(() => {
      open();
      drop('SOP-00007', 'RESOLVED');
      expect(column('Resuelto')).toContain('SOP-00007');
      expect(column('Pendiente')).toBe('');

      const save = http.expectOne({ method: 'PATCH', url: '/api/tickets/7' });
      expect(save.request.body).toEqual({ status: 'RESOLVED' });
      save.flush(ticket({ status: 'RESOLVED' }));
      settle();
      expect(column('Resuelto')).toContain('SOP-00007');
      expect(toasts()).toEqual([]);
    }));

    it('goes back to its column when the server refuses the change', fakeAsync(() => {
      open();
      drop('SOP-00007', 'RESOLVED');
      expect(column('Resuelto')).toContain('SOP-00007');

      http.expectOne({ method: 'PATCH', url: '/api/tickets/7' }).flush({ message: 'No se puede resolver' }, REFUSED);
      settle();
      expect(column('Pendiente')).toContain('SOP-00007');
      expect(column('Resuelto')).toBe('');
      expect(toasts()).toEqual(['No se puede resolver']);
    }));

    it('saves nothing when it is dropped on the column it was in', fakeAsync(() => {
      open();
      drop('SOP-00007', 'PENDING');
      http.expectNone((request) => request.method === 'PATCH');
      expect(column('Pendiente')).toContain('SOP-00007');
    }));
  });
});
