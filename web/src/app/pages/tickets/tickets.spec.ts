import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { DeferBlockBehavior, DeferBlockState, TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { DeferBlockFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { Company, Ticket, TicketDetail, User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { TicketEvents } from '../../core/ticket-events';
import { todayIso } from '../../core/ui';
import { ASSIGNEES, COMPANIES, FAILURE, MODULES, SUPPORT_TYPES, TRAINING, ticket, ticketPage } from '../../testing/fixtures';
import { clearSelect, closeSelect, ngSelect, optionTexts, typeInSelect } from '../../testing/ng-select';
import { paste, screenOf, toasts } from '../../testing/screen';
import { DESKTOP, PHONE, ScreenWidth, provideScreenWidth } from '../../testing/screen-width';
import { TicketsPage } from './tickets';

const OTHER = ticket({ id: 8, code: 'SOP-00008', companyId: 5, company: 'Bodega Sur', description: 'No abre la caja' });

// The users of the catalog, for "Registrado por". The other catalogs the filters and the form of a
// new case offer are the ones of the specs (see testing/fixtures).
const USERS: User[] = [
  { id: 1, username: 'ana', name: 'Ana', active: true, canLogin: true, role: 'AGENT' },
  { id: 2, username: 'luis', name: 'Luis', active: true, canLogin: true, role: 'AGENT' },
];

/** The headers of the table for someone who never chose their columns. */
const STARTING_COLUMNS = ['Código', 'Fecha del caso', 'Registro', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Tipos de soporte', 'Observación'];
const STARTING_IDS = ['code', 'date', 'createdAt', 'company', 'description', 'status', 'assignee', 'supportTypes', 'lastNote'];

const REFUSED = { status: 400, statusText: 'Bad Request' };
const STORED = { status: 204, statusText: 'No Content' };
const picture = new File(['png'], 'captura.png', { type: 'image/png' });

/** What this browser keeps of the list, for any user: the copies of their preferences. */
function forgetBrowserCopies(): void {
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('st.tickets.')) localStorage.removeItem(key);
  }
}

// The list with the real Api: the tests act on the controls of the page and on TicketEvents, and
// look at the requests that leave and at what the rows show. Answers arrive when the test sends
// them (fakeAsync), which is what lets one arrive late.
//
// On a laptop, which shows the list as a table: the tests that are about the phone cards say so.
describe('TicketsPage', () => {
  let http: HttpTestingController;
  let events: TicketEvents;
  let catalogs: Catalogs;
  let fixture: ComponentFixture<TicketsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    forgetBrowserCopies();
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideScreenWidth(DESKTOP)] });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(TicketEvents);
    // The list is behind the login: there is always someone logged in.
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'AGENT' });
    catalogs = TestBed.inject(Catalogs);
    catalogs.users.set(USERS);
    catalogs.companies.set(COMPANIES);
    catalogs.assignees.set(ASSIGNEES);
    catalogs.supportTypes.set(SUPPORT_TYPES);
    catalogs.modules.set(MODULES);
  });

  // Also catches a read or a save nobody expected: any request left unanswered fails the test.
  afterEach(() => {
    http.verify();
    forgetBrowserCopies();
  });

  /** A read of the list that is on its way. */
  const listRead = (): TestRequest => http.expectOne((request) => request.method === 'GET' && request.url === '/api/tickets');
  /** The read of one of the person's preferences, which the list asks for as it opens. */
  const preferenceRead = (key: string): TestRequest => http.expectOne({ method: 'GET', url: `/api/preferences/${key}` });
  /** A save of one of the person's preferences that is on its way. */
  const preferenceSave = (key: string): TestRequest => http.expectOne({ method: 'PUT', url: `/api/preferences/${key}` });
  const noSave = (): void => http.expectNone((request) => request.method !== 'GET');

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

  /** Creates the list with its first reads still on their way: the cases, and the two preferences of the person. */
  function create(): void {
    fixture = TestBed.createComponent(TicketsPage);
    el = fixture.nativeElement as HTMLElement;
    render();
  }

  /** What the server has of the person's preferences. Nothing, for someone who never chose. */
  interface Saved {
    columns?: unknown;
    filtersOpen?: unknown;
  }

  function open(items: Ticket[] = [ticket()], saved: Saved = {}): void {
    create();
    preferenceRead('tickets.columns').flush({ value: saved.columns ?? null });
    preferenceRead('tickets.filters-open').flush({ value: saved.filtersOpen ?? null });
    listRead().flush(ticketPage(items, 50));
    settle();
  }

  const { find, button, click, type, pressEscape, select, chosen, offers, pick } = screenOf(() => el, render);

  // The table: its headers, its rows, and the cell of a row under a header.
  const headers = (): string[] => Array.from(el.querySelectorAll('thead th'), (header) => header.textContent?.trim() ?? '');
  const rows = (): HTMLTableRowElement[] => Array.from(el.querySelectorAll<HTMLTableRowElement>('tbody tr'));

  function cell(header: string, row: HTMLTableRowElement = rows()[0]): HTMLElement {
    const index = headers().indexOf(header);
    if (index < 0) throw new Error(`The table has no "${header}" column. It has: ${headers().join(', ')}`);
    return row.cells[index];
  }

  const panel = (): HTMLElement | null => el.querySelector('app-ticket-panel');
  /** The body of a request as it travels: what was left undefined is not in it. */
  const sent = (request: TestRequest): unknown => JSON.parse(JSON.stringify(request.request.body));

  describe('a row', () => {
    const full = ticket({
      time: '14:35',
      status: 'RESOLVED',
      assigneeId: 4,
      assigneeName: 'Ana',
      supportTypes: [TRAINING, FAILURE],
      lastNote: 'Se llamó al cliente',
      notesCount: 2,
    });

    it('shows the case in words: its status as a badge, its responsible as text and its support types as chips', fakeAsync(() => {
      open([full, OTHER]);

      expect(cell('Código').textContent).toContain('SOP-00007');
      expect(cell('Fecha del caso').textContent).toContain('05/11/2026');
      expect(cell('Fecha del caso').textContent).toContain('14:35');
      expect(cell('Empresa').textContent?.trim()).toBe('Acme');
      expect(cell('Descripción').textContent).toContain('No imprime');
      const status = cell('Estado').querySelector('.badge')!;
      expect(status.textContent?.trim()).toBe('Resuelto');
      expect(status.classList).toContain('st-RESOLVED');
      expect(cell('Responsable').textContent?.trim()).toBe('Ana');
      const chips = Array.from(cell('Tipos de soporte').querySelectorAll<HTMLElement>('app-type-chip'));
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Capacitación', 'Falla del sistema']);
      // Each in the colour the team gave it.
      expect(chips.map((chip) => chip.style.backgroundColor)).toEqual(['rgb(18, 183, 106)', 'rgb(185, 28, 28)']);
      expect(cell('Observación').textContent).toContain('Se llamó al cliente');

      // A case nobody has says so, and one without support types has no chip.
      expect(cell('Responsable', rows()[1]).textContent?.trim()).toBe('Sin asignar');
      expect(cell('Tipos de soporte', rows()[1]).querySelector('app-type-chip')).toBeNull();
    }));

    it('has nothing to edit in it: no field, no list, and no row to type a new case in', fakeAsync(() => {
      open([full, OTHER]);

      expect(rows().length).toBe(2);
      expect(el.querySelector('table input, table select, table textarea, table ng-select')).toBeNull();
      expect(el.querySelector('select')).toBeNull();
    }));

    it('an archived one carries the "Archivado" badge, and the others do not', fakeAsync(() => {
      open([ticket({ archivedAt: '2026-11-08T09:00:00.000Z' }), OTHER]);

      expect(cell('Código').textContent).toContain('Archivado');
      expect(cell('Código', rows()[1]).textContent).not.toContain('Archivado');
    }));

    // The only thing a row does is open its case. Nothing is saved from the list.
    it('pressed anywhere, on any of its cells, opens the form of its case and sends nothing else', fakeAsync(() => {
      /** Presses a cell, which opens the case of its row, and closes the form again. */
      function visit(target: HTMLElement, opened: TicketDetail): void {
        click(target);
        expect(panel()).not.toBeNull();
        // Opening a case reads it. That is all a press on a row asks for.
        http.expectOne({ method: 'GET', url: `/api/tickets/${opened.id}` }).flush(opened);
        settle();
        click(find('app-ticket-panel button[aria-label="Cerrar"]'));
        settle();
        expect(panel()).toBeNull();
      }
      open([full, OTHER]);
      // Looking at the list, however long, asks for nothing.
      tick(60_000);
      render();

      visit(cell('Estado').querySelector<HTMLElement>('.badge')!, full);
      visit(cell('Responsable', rows()[1]), OTHER);
      visit(cell('Tipos de soporte').querySelector<HTMLElement>('app-type-chip')!, full);
      visit(cell('Observación'), full);

      noSave();
      expect(cell('Estado').textContent?.trim()).toBe('Resuelto');
    }));

    // Not a native list anywhere on the page: not in the filters, nor in the form of a new case.
    it('and the rest of the page have no <select>: every list of options is an ng-select', fakeAsync(() => {
      open([full, OTHER], { filtersOpen: true });
      click(button('Nuevo caso'));

      expect(el.querySelectorAll('select').length).toBe(0);
      expect(el.querySelectorAll('ng-select').length).toBe(15);
    }));

    it('has its code as a button, the way in for the keyboard', fakeAsync(() => {
      open();
      click(button('SOP-00007', rows()[0]));

      expect(panel()).not.toBeNull();
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
      settle();
    }));

    // The bell takes the person to a case with a link that carries its number.
    it('is not the only way to its case: a link with `?caso=` opens it too, and closing it clears the address', fakeAsync(() => {
      const router = TestBed.inject(Router);
      open();
      void router.navigateByUrl('/?caso=7');
      settle();

      expect(panel()).not.toBeNull();
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
      settle();

      click(find('app-ticket-panel button[aria-label="Cerrar"]'));
      settle();
      expect(panel()).toBeNull();
      // Left in the address, the same link would not open the case a second time.
      settle();
      expect(router.url).toBe('/');
    }));

    it('does not open when the press ends a selection: the person is copying a text of the row', fakeAsync(() => {
      open();
      const description = cell('Descripción');
      // What a drag over the text leaves selected.
      window.getSelection()!.selectAllChildren(description);
      expect(window.getSelection()!.toString()).toContain('No imprime');

      click(description);
      expect(panel()).toBeNull();

      // With nothing selected, the same press opens the case.
      window.getSelection()!.removeAllRanges();
      click(description);
      expect(panel()).not.toBeNull();
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
      settle();
    }));
  });

  describe('a case saved by this tab', () => {
    const rowStatus = (): string => cell('Estado').textContent?.trim() ?? '';

    // The read may have been taken before the save was stored: shown, it would undo the save on screen.
    it('while the list is being read is shown on its row, and the list is read again', fakeAsync(() => {
      open();
      // Someone else changed a case: the list is read again, with the screen update that follows.
      events.outdated(null);
      render();
      const stale = listRead();

      events.saved(ticket({ status: 'RESOLVED' }));
      render();
      expect(rowStatus()).toBe('Resuelto');
      const fresh = listRead();

      // Its answer, maybe older than the save, never arrives.
      expect(stale.cancelled).toBeTrue();
      settle();
      expect(rowStatus()).toBe('Resuelto');

      fresh.flush(ticketPage([ticket({ status: 'RESOLVED', company: 'Acme del Sur' })], 50));
      settle();
      expect(rowStatus()).toBe('Resuelto');
      expect(el.textContent).toContain('Acme del Sur');
    }));

    it('with no read on its way is shown on its row, and the list is not read', fakeAsync(() => {
      open();
      events.saved(ticket({ status: 'RESOLVED', company: 'Acme del Sur' }));
      render();

      expect(rowStatus()).toBe('Resuelto');
      expect(el.textContent).toContain('Acme del Sur');
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    // Archiving puts the case away: unlike any other edit, it does not keep its row.
    it('that was archived in its form leaves the list, which is read again', fakeAsync(() => {
      open([ticket(), OTHER]);
      events.saved(ticket({ archivedAt: '2026-11-08T09:00:00.000Z' }), { archiving: true });
      render();

      const read = listRead();
      // The list goes on with the cases that are not archived.
      expect(read.request.params.has('archived')).toBeFalse();
      read.flush(ticketPage([OTHER], 50));
      settle();
      expect(rows().length).toBe(1);
      expect(el.textContent).not.toContain('SOP-00007');
    }));

    it('that was brought back from the archive is read again too', fakeAsync(() => {
      open([ticket({ archivedAt: '2026-11-08T09:00:00.000Z' })]);
      events.saved(ticket(), { archiving: true });
      render();

      listRead().flush(ticketPage([ticket()], 50));
      settle();
      expect(cell('Código').textContent).not.toContain('Archivado');
    }));

    // The form stays open on the case it archived, and its button now brings the case back. By
    // then the case has no row in the list: what tells the list is the save, not its rows.
    describe('archived and brought back from the same open form', () => {
      const archived = ticket({ archivedAt: '2026-11-08T09:00:00.000Z' });
      const otherArchived = { ...OTHER, archivedAt: '2026-11-07T09:00:00.000Z' };
      const codes = (): string[] => rows().map((row) => row.cells[0].querySelector('button')?.textContent?.trim() ?? '');

      /** Opens the form of the first case of the list. */
      function openForm(stored: TicketDetail): void {
        click(rows()[0]);
        http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(stored);
        settle();
      }

      /** Presses the button of the form that archives the case or brings it back, and answers its save. */
      function press(label: 'Archivar' | 'Desarchivar', stored: TicketDetail): void {
        click(button(label, panel()!));
        const save = http.expectOne({ method: 'PATCH', url: '/api/tickets/7' });
        expect(save.request.body).toEqual({ archived: label === 'Archivar' });
        save.flush(stored);
        settle();
      }

      it('is in the list again', fakeAsync(() => {
        open([ticket(), OTHER]);
        openForm(ticket());

        press('Archivar', archived);
        listRead().flush(ticketPage([OTHER], 50));
        settle();
        expect(codes()).toEqual(['SOP-00008']);

        // Archived by mistake: the same button undoes it.
        press('Desarchivar', ticket());
        const read = listRead();
        expect(read.request.params.has('archived')).toBeFalse();
        read.flush(ticketPage([ticket(), OTHER], 50));
        settle();
        expect(codes()).toEqual(['SOP-00007', 'SOP-00008']);
      }));

      it('the other way round, under "Archivados": brought back and archived again, it is in the list again', fakeAsync(() => {
        open([ticket(), OTHER], { filtersOpen: true });
        pick('tf-archived', 'Archivados');
        listRead().flush(ticketPage([archived, otherArchived], 50));
        settle();
        openForm(archived);

        press('Desarchivar', ticket());
        listRead().flush(ticketPage([otherArchived], 50));
        settle();
        expect(codes()).toEqual(['SOP-00008']);

        press('Archivar', archived);
        const read = listRead();
        expect(read.request.params.get('archived')).toBe('only');
        read.flush(ticketPage([archived, otherArchived], 50));
        settle();
        expect(codes()).toEqual(['SOP-00007', 'SOP-00008']);
      }));

      // What else is done on a case that has no row is no reason to read the list.
      it('edited meanwhile, while it has no row in the list: the list is not read for that', fakeAsync(() => {
        open([ticket(), OTHER]);
        openForm(ticket());
        press('Archivar', archived);
        listRead().flush(ticketPage([OTHER], 50));
        settle();

        events.saved({ ...archived, description: 'No imprime desde el lunes' });
        render();
        http.expectNone((request) => request.url === '/api/tickets');
        expect(codes()).toEqual(['SOP-00008']);
      }));
    });
  });

  // Archiving and deleting take cases out of the list, and the oldest ones, the ones a team puts
  // away, are on its last page.
  describe('a page of the list left without cases', () => {
    const pager = (): string => find('button[aria-label="Página anterior"]').parentElement!.textContent?.trim() ?? '';

    /** Opens the list on its second page, the last one, with one case on it. */
    function openOnLastPage(total: number): void {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [OTHER], total, page: 1, pageSize: 50 });
      settle();
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total, page: 2, pageSize: 50 });
      settle();
    }

    it('goes to the last page that has any, instead of saying that there are no cases', fakeAsync(() => {
      openOnLastPage(101);
      expect(pager()).toBe('Página 2 de 3');
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total: 101, page: 3, pageSize: 50 });
      settle();

      // The only case of the third page is archived from its form.
      events.saved(ticket({ archivedAt: '2026-11-08T09:00:00.000Z' }), { archiving: true });
      render();
      const emptied = listRead();
      expect(emptied.request.params.get('page')).toBe('3');
      emptied.flush({ items: [], total: 100, page: 3, pageSize: 50 });
      settle();

      const last = listRead();
      expect(last.request.params.get('page')).toBe('2');
      expect(find('tbody').textContent).not.toContain('Todavía no hay casos');
      last.flush({ items: [OTHER], total: 100, page: 2, pageSize: 50 });
      settle();
      expect(rows().length).toBe(1);
      expect(cell('Código').textContent).toContain('SOP-00008');
      expect(pager()).toBe('Página 2 de 2');
      expect(el.textContent).toContain('100 caso(s)');
    }));

    // With one page left there is no pager to go back with: the list has to go there by itself.
    it('goes to the first page when that is all that is left, after a case is deleted too', fakeAsync(() => {
      openOnLastPage(51);

      events.removed(7);
      render();
      listRead().flush({ items: [], total: 50, page: 2, pageSize: 50 });
      settle();
      const first = listRead();
      expect(first.request.params.get('page')).toBe('1');
      first.flush({ items: [OTHER], total: 50, page: 1, pageSize: 50 });
      settle();

      expect(cell('Código').textContent).toContain('SOP-00008');
      expect(el.querySelector('button[aria-label="Página anterior"]')).toBeNull();
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    it('with no case left at all says so, and reads nothing else', fakeAsync(() => {
      openOnLastPage(51);

      events.outdated(null);
      render();
      listRead().flush({ items: [], total: 0, page: 2, pageSize: 50 });
      settle();

      expect(find('tbody').textContent).toContain('Todavía no hay casos.');
      http.expectNone((request) => request.url === '/api/tickets');
    }));
  });

  // The table needs the room of a laptop; a phone gets a card per case. Only the one that applies is drawn.
  describe('the layout', () => {
    const cards = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('button.card'));
    const codes = (): string[] => cards().map((card) => card.querySelector('.font-mono')?.textContent?.trim() ?? '');

    it('is a table on a wide screen, with no cards', fakeAsync(() => {
      open([ticket(), OTHER]);

      expect(rows().length).toBe(2);
      expect(cards()).toEqual([]);
    }));

    it('is a card per case on a phone, with no table', fakeAsync(() => {
      TestBed.inject(ScreenWidth).set(PHONE);
      open([ticket(), OTHER]);

      expect(codes()).toEqual(['SOP-00007', 'SOP-00008']);
      expect(el.querySelector('table')).toBeNull();
    }));

    // Where the classes `md:` of the page switch too.
    it('switches at 768 px, also when the window is resized, without reading the list again', fakeAsync(() => {
      const screen = TestBed.inject(ScreenWidth);
      screen.set(767);
      open();
      expect(el.querySelector('table')).toBeNull();
      expect(codes()).toEqual(['SOP-00007']);

      screen.set(768);
      render();
      expect(cards()).toEqual([]);
      expect(cell('Código').textContent).toContain('SOP-00007');

      screen.set(PHONE);
      render();
      expect(el.querySelector('table')).toBeNull();
      expect(codes()).toEqual(['SOP-00007']);
      // Nothing was asked for: http.verify, after each test, fails on any read left.
    }));

    it('on a phone: a card pressed opens its case', fakeAsync(() => {
      TestBed.inject(ScreenWidth).set(PHONE);
      open([ticket(), OTHER]);

      click(cards()[1]);
      expect(panel()).not.toBeNull();
      http.expectOne({ method: 'GET', url: '/api/tickets/8' }).flush(OTHER);
      settle();
    }));

    it('on a phone: says so while the cases are read, and when there are none', fakeAsync(() => {
      TestBed.inject(ScreenWidth).set(PHONE);
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      settle();
      expect(el.textContent).toContain('Cargando…');

      listRead().flush(ticketPage([], 50));
      settle();
      expect(el.textContent).toContain('No hay casos para mostrar.');
      expect(el.textContent).not.toContain('Cargando…');
    }));
  });

  // The list is read again whenever its filters, its order or its page change, and when cases change.
  describe('reading the list', () => {
    const pager = (): string => find('button[aria-label="Página anterior"]').parentElement!.textContent?.trim() ?? '';
    const sortButton = (): HTMLButtonElement => button('Código', find('thead'));

    /** Opens the list on the first of three pages. */
    function openLong(): void {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      settle();
    }

    it('keeps the rows on screen while the next page is read, and says it is updating', fakeAsync(() => {
      openLong();
      expect(el.textContent).not.toContain('Actualizando…');

      click(find('button[aria-label="Página siguiente"]'));
      const next = listRead();
      expect(next.request.params.get('page')).toBe('2');
      expect(pager()).toBe('Página 2 de 3');
      expect(cell('Código').textContent).toContain('SOP-00007');
      expect(el.textContent).toContain('Actualizando…');

      next.flush({ items: [OTHER], total: 120, page: 2, pageSize: 50 });
      settle();
      expect(cell('Código').textContent).toContain('SOP-00008');
      expect(el.textContent).not.toContain('Actualizando…');
    }));

    it('cancels the read of a page left before it arrives', fakeAsync(() => {
      openLong();
      click(find('button[aria-label="Página siguiente"]'));
      const second = listRead();
      click(find('button[aria-label="Página siguiente"]'));
      const third = listRead();
      expect(second.cancelled).toBeTrue();
      expect(third.request.params.get('page')).toBe('3');

      third.flush({ items: [OTHER], total: 120, page: 3, pageSize: 50 });
      settle();
      expect(pager()).toBe('Página 3 de 3');
      expect(cell('Código').textContent).toContain('SOP-00008');
    }));

    // The page is pressed, and the read of the page left is answered before the screen update
    // that would cancel it: that answer is no longer the one asked for, and moves nothing.
    it('stays on the page pressed when the read of the page left is answered just after the press', fakeAsync(() => {
      openLong();
      events.outdated(null);
      render();
      const left = listRead();

      find<HTMLButtonElement>('button[aria-label="Página siguiente"]').click();
      left.flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      flushMicrotasks();
      render();

      const next = listRead();
      expect(next.request.params.get('page')).toBe('2');
      next.flush({ items: [OTHER], total: 120, page: 2, pageSize: 50 });
      settle();
      expect(pager()).toBe('Página 2 de 3');
      expect(cell('Código').textContent).toContain('SOP-00008');
    }));

    it('that fails says why, and keeps the rows it had', fakeAsync(() => {
      open([ticket(), OTHER]);
      events.outdated(null);
      render();
      listRead().flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      settle();

      expect(toasts()).toEqual(['Error interno']);
      expect(rows().length).toBe(2);
      expect(el.textContent).not.toContain('Actualizando…');
    }));

    // A link of the bell to the filter that is already on, for one.
    it('stays where it is when the same cases are asked for again, and is not read for that', fakeAsync(() => {
      const router = TestBed.inject(Router);
      openLong();
      void router.navigateByUrl('/?olvidados=1');
      settle();
      settle();
      listRead().flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      settle();
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total: 120, page: 2, pageSize: 50 });
      settle();

      void router.navigateByUrl('/?olvidados=1');
      settle();
      settle();
      http.expectNone((request) => request.url === '/api/tickets');
      expect(pager()).toBe('Página 2 de 3');
    }));

    it('in the other order, by "Código", goes back to the first page, from the lowest ticket number', fakeAsync(() => {
      openLong();
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total: 120, page: 2, pageSize: 50 });
      settle();
      expect(sortButton().closest('th')!.getAttribute('aria-sort')).toBe('descending');

      click(sortButton());
      const ascending = listRead();
      expect(ascending.request.params.get('dir')).toBe('asc');
      expect(ascending.request.params.get('page')).toBe('1');
      ascending.flush({ items: [OTHER], total: 120, page: 1, pageSize: 50 });
      settle();
      expect(sortButton().closest('th')!.getAttribute('aria-sort')).toBe('ascending');
      expect(pager()).toBe('Página 1 de 3');
    }));

    it('is not asked for any longer once the screen goes away', fakeAsync(() => {
      openLong();
      events.outdated(null);
      render();
      const read = listRead();
      fixture.destroy();
      expect(read.cancelled).toBeTrue();
    }));
  });

  // The form is drawn over the list, which takes it away when its case is gone.
  describe('the form of a case, open over the list', () => {
    it('closed because its case was deleted elsewhere takes with it the question it had on screen', fakeAsync(() => {
      const confirm = TestBed.inject(Confirm);
      open();
      click(rows()[0]);
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
      settle();
      type(find('#tp-description'), 'No imprime desde el lunes');
      click(find('app-ticket-panel button[aria-label="Cerrar"]'));
      expect(confirm.current()).toEqual(jasmine.objectContaining({ title: 'Hay cambios sin guardar' }));

      // Someone else deletes the case: the list and the form read again, and the form finds it gone.
      events.outdated(7);
      render();
      listRead().flush(ticketPage([OTHER], 50));
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush({ message: 'El caso no existe' }, { status: 404, statusText: 'Not Found' });
      settle();

      expect(panel()).toBeNull();
      expect(confirm.current()).toBeNull();
      expect(toasts()).toEqual(['Este caso fue eliminado desde otra sesión']);
    }));
  });

  // Which columns the table shows is each person's own choice. It is kept with their user on
  // the server, and a copy in the browser lets the table start right before the server answers.
  describe('the columns', () => {
    const COPY = 'st.tickets.columns.1';
    const columnsButton = (): HTMLButtonElement => find('app-ticket-columns > button');
    const popover = (): HTMLElement | null => el.querySelector('#ticket-columns');

    function openColumns(): void {
      if (!popover()) click(columnsButton());
    }

    /** The checkbox of a column in "Columnas". */
    function box(label: string): HTMLInputElement {
      openColumns();
      const row = Array.from(popover()!.querySelectorAll('label')).find((item) => item.querySelector('span')?.textContent?.trim() === label);
      if (!row) throw new Error(`"Columnas" has no "${label}"`);
      return row.querySelector('input')!;
    }

    function toggle(label: string): void {
      click(box(label));
    }

    const columnsSave = (): TestRequest => preferenceSave('tickets.columns');

    it('start as the ones the list always had, and the support types', fakeAsync(() => {
      open();

      expect(headers()).toEqual(STARTING_COLUMNS);
    }));

    it('are chosen in "Columnas", one checkbox each, in the order of the table', fakeAsync(() => {
      open();
      openColumns();

      const labels = Array.from(popover()!.querySelectorAll('label'), (label) => label.querySelector('span')!.textContent?.trim());
      expect(labels).toEqual([
        'Código',
        'Fecha del caso',
        'Registro',
        'Empresa',
        'Descripción',
        'Estado',
        'Responsable',
        'Prioridad',
        'Módulo',
        'Tipos de soporte',
        'Promesa de entrega',
        'Fecha límite',
        'Tiempo estimado',
        'Tiempo real',
        'Observación',
        'Registrado por',
        'Última actividad',
      ]);
      const checked = labels.filter((label) => box(label!).checked);
      expect(checked).toEqual(STARTING_COLUMNS);
    }));

    it('change at once, and the choice is saved for the user who made it', fakeAsync(() => {
      open([ticket({ priority: 'HIGH' })]);
      toggle('Registro');

      expect(headers()).toEqual(['Código', 'Fecha del caso', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Tipos de soporte', 'Observación']);
      const visible = ['code', 'date', 'company', 'description', 'status', 'assignee', 'supportTypes', 'lastNote'];
      // The request names no user: the server keeps it for whoever is logged in.
      const save = columnsSave();
      expect(save.request.body).toEqual({ value: { visible } });
      save.flush(null, STORED);
      settle();
      // The copy of this browser is kept under the id of the user.
      expect(JSON.parse(localStorage.getItem(COPY)!)).toEqual({ visible });

      toggle('Prioridad');
      expect(headers()).toEqual(['Código', 'Fecha del caso', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Prioridad', 'Tipos de soporte', 'Observación']);
      expect(cell('Prioridad').textContent?.trim()).toBe('Alta');
      columnsSave().flush(null, STORED);
      settle();
      // Nothing about the cases is asked for again: the list already has them.
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    it('"Código" is always there: it cannot be unchecked', fakeAsync(() => {
      open();

      expect(box('Código').checked).toBeTrue();
      expect(box('Código').disabled).toBeTrue();
      expect(box('Empresa').disabled).toBeFalse();
    }));

    it('are, on opening the list, the ones the user saved', fakeAsync(() => {
      open([ticket()], { columns: { visible: ['code', 'company', 'status'] } });

      expect(headers()).toEqual(['Código', 'Empresa', 'Estado']);
      // Kept in this browser for the next time.
      expect(JSON.parse(localStorage.getItem(COPY)!)).toEqual({ visible: ['code', 'company', 'status'] });
      noSave();
    }));

    it('are right from the first paint, from the copy of this browser, and then as the server has them', fakeAsync(() => {
      localStorage.setItem(COPY, JSON.stringify({ visible: ['code', 'company'] }));
      create();
      // Nothing has been answered yet.
      expect(headers()).toEqual(['Código', 'Empresa']);

      // The user chose other columns from another browser meanwhile.
      preferenceRead('tickets.columns').flush({ value: { visible: ['code', 'status', 'assignee'] } });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush(ticketPage([ticket()], 50));
      settle();
      expect(headers()).toEqual(['Código', 'Estado', 'Responsable']);
      expect(JSON.parse(localStorage.getItem(COPY)!)).toEqual({ visible: ['code', 'status', 'assignee'] });
    }));

    it('stay as this browser has them when the server has nothing saved, or cannot be reached', fakeAsync(() => {
      localStorage.setItem(COPY, JSON.stringify({ visible: ['code', 'company'] }));
      open();
      expect(headers()).toEqual(['Código', 'Empresa']);

      fixture.destroy();
      create();
      preferenceRead('tickets.columns').error(new ProgressEvent('error'));
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush(ticketPage([ticket()], 50));
      settle();
      expect(headers()).toEqual(['Código', 'Empresa']);
      expect(toasts()).toEqual([]);
    }));

    it('leave out, of a saved choice, the columns that do not exist', fakeAsync(() => {
      // A column of another version, something that is not a name, and "Código" missing.
      open([ticket()], { columns: { visible: ['status', 'reportedBy', 7, null, 'company'] } });

      expect(headers()).toEqual(['Código', 'Empresa', 'Estado']);
    }));

    it('are the starting ones when what was saved is not a choice of columns', fakeAsync(() => {
      for (const columns of ['company', 42, ['company'], {}, { visible: 'company' }, { visible: null }]) {
        open([ticket()], { columns });
        expect(headers()).withContext(JSON.stringify(columns)).toEqual(STARTING_COLUMNS);
        expect(localStorage.getItem(COPY)).toBeNull();
        fixture.destroy();
      }
    }));

    it('are the starting ones when the copy of this browser cannot be read, and only its real columns otherwise', fakeAsync(() => {
      for (const copy of ['{"visible":', '"company"', '{"visible":"company"}']) {
        localStorage.setItem(COPY, copy);
        open();
        expect(headers()).withContext(copy).toEqual(STARTING_COLUMNS);
        fixture.destroy();
      }

      localStorage.setItem(COPY, '{"visible":["lastNote","nope","code","code"]}');
      open();
      expect(headers()).toEqual(['Código', 'Observación']);
    }));

    // Two people who use the same browser: neither sees what the other chose.
    it('are each person’s own: another user of the same browser gets theirs, not these', fakeAsync(() => {
      open();
      toggle('Registro');
      columnsSave().flush(null, STORED);
      settle();
      const mine = localStorage.getItem(COPY);
      expect(headers()).not.toContain('Registro');

      // Ana leaves and Luis logs in, in the same browser. He never chose his columns.
      fixture.destroy();
      TestBed.inject(Auth).user.set({ id: 2, username: 'luis', name: 'Luis', role: 'AGENT' });
      open();
      expect(headers()).toEqual(STARTING_COLUMNS);

      // What he chooses is kept under his user, and leaves hers alone.
      toggle('Empresa');
      columnsSave().flush(null, STORED);
      settle();
      expect(JSON.parse(localStorage.getItem('st.tickets.columns.2')!)).toEqual({ visible: STARTING_IDS.filter((id) => id !== 'company') });
      expect(localStorage.getItem(COPY)).toBe(mine);

      // And she finds hers again.
      fixture.destroy();
      TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'AGENT' });
      create();
      expect(headers()).not.toContain('Registro');
      expect(headers()).toContain('Empresa');
      preferenceRead('tickets.columns').flush({ value: JSON.parse(mine!) });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush(ticketPage([ticket()], 50));
      settle();
    }));

    it('"Restablecer" goes back to the starting ones, and that is saved too', fakeAsync(() => {
      open([ticket()], { columns: { visible: ['code', 'company'] } });
      openColumns();
      const reset = button('Restablecer', popover()!);
      expect(reset.disabled).toBeFalse();

      click(reset);
      expect(headers()).toEqual(STARTING_COLUMNS);
      const save = columnsSave();
      expect(save.request.body).toEqual({ value: { visible: STARTING_IDS } });
      save.flush(null, STORED);
      settle();
      // Nothing left to go back to.
      expect(button('Restablecer', popover()!).disabled).toBeTrue();
    }));

    // The server answers with what was saved before: it must not undo what the person just chose.
    it('chosen before the server answers are not replaced by its answer', fakeAsync(() => {
      create();
      toggle('Registro');
      const save = columnsSave();

      preferenceRead('tickets.columns').flush({ value: { visible: ['code', 'company'] } });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush(ticketPage([ticket()], 50));
      settle();
      expect(headers()).toEqual(STARTING_COLUMNS.filter((column) => column !== 'Registro'));

      save.flush(null, STORED);
      settle();
    }));

    // Sent side by side, two saves could be stored in the other order and the older choice would stay.
    it('changed several times in a row are saved one at a time, the last save with the final choice', fakeAsync(() => {
      open();
      toggle('Registro');
      const first = columnsSave();
      toggle('Prioridad');
      toggle('Módulo');
      http.expectNone({ method: 'PUT', url: '/api/preferences/tickets.columns' });

      first.flush(null, STORED);
      settle();
      const last = columnsSave();
      expect(last.request.body).toEqual({ value: { visible: ['code', 'date', 'company', 'description', 'status', 'assignee', 'priority', 'module', 'supportTypes', 'lastNote'] } });
      last.flush(null, STORED);
      settle();
    }));

    it('that could not be saved stay on screen, and the person is told', fakeAsync(() => {
      open();
      toggle('Registro');
      columnsSave().flush({ message: 'La preferencia es demasiado grande' }, REFUSED);
      settle();

      expect(headers()).not.toContain('Registro');
      expect(toasts()).toEqual(['No se pudo guardar tu preferencia: La preferencia es demasiado grande']);
    }));

    // The choice made while a save was on its way waits for it. Left unsent when that save
    // fails, the server would keep an older choice than the one on screen until the next change.
    describe('changed again while a save that then fails is on its way', () => {
      const LAST = { value: { visible: ['code', 'date', 'company', 'description', 'status', 'assignee', 'priority', 'supportTypes', 'lastNote'] } };

      function changeTwice(): TestRequest {
        open();
        toggle('Registro');
        const first = columnsSave();
        toggle('Prioridad');
        return first;
      }

      it('are saved all the same, as the person left them, and nothing is said of the save that failed', fakeAsync(() => {
        changeTwice().error(new ProgressEvent('error'));
        settle();

        const last = columnsSave();
        expect(last.request.body).toEqual(LAST);
        expect(toasts()).toEqual([]);
        last.flush(null, STORED);
        settle();
        expect(toasts()).toEqual([]);
        // The next change is saved as any other.
        toggle('Módulo');
        columnsSave().flush(null, STORED);
        settle();
      }));

      it('and the person is told, once, when the last choice cannot be saved either', fakeAsync(() => {
        changeTwice().error(new ProgressEvent('error'));
        settle();
        columnsSave().error(new ProgressEvent('error'));
        settle();

        expect(toasts()).toEqual(['No se pudo guardar tu preferencia: No hay conexión con el servidor']);
        expect(headers()).toContain('Prioridad');
        http.expectNone({ method: 'PUT', url: '/api/preferences/tickets.columns' });
      }));
    });

    it('"Columnas" closes with Escape, which leaves the focus on its button', fakeAsync(() => {
      open();
      openColumns();
      expect(columnsButton().getAttribute('aria-expanded')).toBe('true');
      box('Empresa').focus();

      pressEscape();
      expect(popover()).toBeNull();
      expect(columnsButton().getAttribute('aria-expanded')).toBe('false');
      expect(document.activeElement).toBe(columnsButton());
    }));

    it('"Columnas" closes with a press anywhere else, and stays open while its checkboxes are pressed', fakeAsync(() => {
      open();
      openColumns();

      box('Empresa').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      render();
      expect(popover()).not.toBeNull();

      rows()[0].dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      render();
      expect(popover()).toBeNull();
    }));

    describe('the module and the delivery promise of a case', () => {
      const promised = ticket({ moduleId: 2, moduleName: 'Ventas / Facturas', promisedDate: '2026-12-24', promiseState: 'later' });

      it('are written under its description while they have no column of their own', fakeAsync(() => {
        open([promised]);

        expect(cell('Descripción').textContent).toContain('Ventas / Facturas');
        expect(cell('Descripción').textContent).toContain('Entrega prometida: 24/12/2026');
      }));

      it('are in their columns, and not repeated under the description, once those are on show', fakeAsync(() => {
        open([promised], { columns: { visible: [...STARTING_IDS, 'module', 'promisedDate'] } });

        expect(cell('Módulo').textContent?.trim()).toBe('Ventas / Facturas');
        expect(cell('Promesa de entrega').textContent).toContain('24/12/2026');
        expect(cell('Descripción').textContent?.trim()).toBe('No imprime');
      }));
    });

    it('show, each in its own, what the list knows of a case', fakeAsync(() => {
      const whole = ticket({
        priority: 'CRITICAL',
        dueAt: '2026-11-06T10:00:00.000Z',
        overdue: true,
        estimatedMinutes: 95,
        spentMinutes: 30,
        createdById: 2,
        lastNote: 'Se llamó al cliente',
        notesCount: 3,
      });
      open([whole, OTHER], { columns: { visible: ['code', 'priority', 'dueAt', 'estimatedMinutes', 'spentMinutes', 'lastNote', 'createdBy', 'lastActivityAt'] } });

      expect(headers()).toEqual(['Código', 'Prioridad', 'Fecha límite', 'Tiempo estimado', 'Tiempo real', 'Observación', 'Registrado por', 'Última actividad']);
      expect(cell('Prioridad').textContent?.trim()).toBe('Crítica');
      expect(cell('Fecha límite').textContent?.trim()).not.toBe('');
      expect(cell('Fecha límite').classList).toContain('text-danger');
      expect(cell('Tiempo estimado').textContent?.trim()).toBe('1 h 35 min');
      expect(cell('Tiempo real').textContent?.trim()).toBe('30 min');
      // The last observation, and how many the case has.
      expect(cell('Observación').textContent).toContain('Se llamó al cliente');
      expect(cell('Observación').querySelector('.badge')!.textContent?.trim()).toBe('3');
      // The user who registered it, by name.
      expect(cell('Registrado por').textContent?.trim()).toBe('Luis');
      expect(cell('Última actividad').textContent?.trim()).not.toBe('');

      // A case with none of that leaves those cells empty.
      for (const header of ['Prioridad', 'Fecha límite', 'Tiempo estimado', 'Tiempo real', 'Observación', 'Registrado por']) {
        expect(cell(header, rows()[1]).textContent?.trim())
          .withContext(header)
          .toBe('');
      }
    }));

    // On a phone the list is cards, not a table: they follow the same choice.
    it('are also what each card of the phone list shows of its case', fakeAsync(() => {
      const card = (): string => find('button.card').textContent ?? '';
      const whole = ticket({ priority: 'HIGH', assigneeId: 4, assigneeName: 'Ana', supportTypes: [TRAINING], archivedAt: '2026-11-08T09:00:00.000Z' });
      TestBed.inject(ScreenWidth).set(PHONE);
      open([whole]);
      for (const shown of ['SOP-00007', '05/11/2026', 'Archivado', 'Pendiente', 'Acme', 'No imprime', 'Capacitación', 'Ana', 'Registro: 05/11/2026']) {
        expect(card()).toContain(shown);
      }
      expect(card()).not.toContain('Prioridad');

      fixture.destroy();
      open([whole], { columns: { visible: ['code', 'description', 'priority'] } });
      for (const shown of ['SOP-00007', 'Archivado', 'No imprime', 'Prioridad: Alta']) {
        expect(card()).toContain(shown);
      }
      for (const hidden of ['05/11/2026', 'Pendiente', 'Acme', 'Capacitación', 'Ana', 'Registro']) {
        expect(card()).not.toContain(hidden);
      }
    }));
  });

  describe('the filters', () => {
    const COPY = 'st.tickets.filters-open.1';
    const filtersButton = (): HTMLButtonElement => find('button[aria-controls="ticket-filters"]');
    const filters = (): HTMLElement | null => el.querySelector('#ticket-filters');
    /** How many filters the button says are on. No number at all with none. */
    const count = (): string => filtersButton().querySelector('.badge')?.textContent?.trim() ?? '';
    const openSave = (): TestRequest => preferenceSave('tickets.filters-open');
    const search = (): HTMLInputElement => find('input[type=search]');

    function checkbox(label: string): HTMLInputElement {
      const row = Array.from(filters()!.querySelectorAll('label')).find((item) => item.textContent?.trim() === label);
      if (!row) throw new Error(`The filters have no "${label}" checkbox`);
      return row.querySelector('input')!;
    }

    /** Opens the list for someone who keeps the filters open. */
    function openWithFilters(items: Ticket[] = [ticket()]): void {
      open(items, { filtersOpen: true });
    }

    /** The read of the list that a change of filter starts, answered. Gives back what it asked for. */
    function filtered(items: Ticket[] = []): Record<string, string> {
      const read = listRead();
      read.flush(ticketPage(items, 50));
      settle();
      const params = read.request.params;
      return Object.fromEntries(params.keys().map((key) => [key, params.get(key)!]));
    }

    /** What every read of the list asks for, whatever the filters. */
    const ALWAYS = { dir: 'desc', page: '1', pageSize: '50' };

    it('are out of the way until "Filtros" shows them. The search box is always there', fakeAsync(() => {
      open();
      expect(filters()).toBeNull();
      expect(filtersButton().getAttribute('aria-expanded')).toBe('false');
      expect(search()).not.toBeNull();

      click(filtersButton());
      expect(filters()).not.toBeNull();
      expect(filtersButton().getAttribute('aria-expanded')).toBe('true');
      openSave().flush(null, STORED);
      settle();

      click(filtersButton());
      expect(filters()).toBeNull();
      expect(filtersButton().getAttribute('aria-expanded')).toBe('false');
      openSave().flush(null, STORED);
      settle();
    }));

    it('stay open or closed as the user left them, which is kept with their user', fakeAsync(() => {
      open();
      click(filtersButton());
      const save = openSave();
      expect(save.request.body).toEqual({ value: true });
      save.flush(null, STORED);
      settle();
      expect(localStorage.getItem(COPY)).toBe('true');

      // The next time, from the first paint.
      fixture.destroy();
      create();
      expect(filters()).not.toBeNull();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: true });
      listRead().flush(ticketPage([ticket()], 50));
      settle();
      expect(filters()).not.toBeNull();

      // Another user of the same browser has them as they left them: closed, having never opened them.
      fixture.destroy();
      TestBed.inject(Auth).user.set({ id: 2, username: 'luis', name: 'Luis', role: 'AGENT' });
      open();
      expect(filters()).toBeNull();
    }));

    it('are open for a user who saved them open from another browser, and closed for anything else saved there', fakeAsync(() => {
      openWithFilters();
      expect(filters()).not.toBeNull();
      expect(localStorage.getItem(COPY)).toBe('true');
      fixture.destroy();
      forgetBrowserCopies();

      for (const filtersOpen of ['true', 1, { open: true }]) {
        open([ticket()], { filtersOpen });
        expect(filters()).withContext(JSON.stringify(filtersOpen)).toBeNull();
        fixture.destroy();
      }
    }));

    it('each one narrows the list at once, by its own query parameter', fakeAsync(() => {
      openWithFilters();

      const selects: [name: string, option: string, parameter: string, value: string][] = [
        ['tf-status', 'Resuelto', 'status', 'RESOLVED'],
        ['tf-assignee', 'Luis', 'assignee', '5'],
        ['tf-company', 'Bodega Sur', 'companyId', '5'],
        ['tf-module', 'Ventas / Facturas', 'moduleId', '2'],
        ['tf-priority', 'Alta', 'priority', 'HIGH'],
        ['tf-type', 'Falla del sistema', 'supportType', '2'],
        ['tf-created-by', 'Luis', 'createdBy', '2'],
        ['tf-promise', 'Vencida', 'promise', 'overdue'],
      ];
      // One at a time: the list is asked for with that filter and with no other.
      for (const [name, option, parameter, value] of selects) {
        pick(name, option);
        expect(filtered()).withContext(name).toEqual({ ...ALWAYS, [parameter]: value });
        expect(chosen(name)).withContext(name).toEqual([option]);
        clearSelect(select(name));
        render();
        expect(filtered()).withContext(name).toEqual(ALWAYS);
      }

      type(find('#tf-from'), '2026-11-01');
      expect(filtered()).toEqual({ ...ALWAYS, from: '2026-11-01' });
      type(find('#tf-to'), '2026-11-30');
      expect(filtered()).toEqual({ ...ALWAYS, from: '2026-11-01', to: '2026-11-30' });
      type(find('#tf-from'), '');
      expect(filtered()).toEqual({ ...ALWAYS, to: '2026-11-30' });
      type(find('#tf-to'), '');
      expect(filtered()).toEqual(ALWAYS);

      click(checkbox('Vencidos'));
      expect(filtered()).toEqual({ ...ALWAYS, overdue: '1' });
      click(checkbox('Vencidos'));
      expect(filtered()).toEqual(ALWAYS);
      click(checkbox('Olvidados'));
      expect(filtered()).toEqual({ ...ALWAYS, stale: '1' });
    }));

    it('add up: the list is asked for with all the ones that are on', fakeAsync(() => {
      openWithFilters();
      pick('tf-status', 'Pendiente');
      filtered();
      pick('tf-company', 'Acme');
      filtered();
      pick('tf-type', 'Capacitación');
      filtered();
      click(checkbox('Vencidos'));

      expect(filtered()).toEqual({ ...ALWAYS, status: 'PENDING', companyId: '1', supportType: '1', overdue: '1' });
    }));

    it('offer every entry of the catalogs, active or not: the cases they have are still to be found', fakeAsync(() => {
      openWithFilters();

      expect(offers('tf-status')).toEqual(['Sin resolver', 'Pendiente', 'Resuelto']);
      expect(offers('tf-company')).toEqual(['Acme', 'Bodega Sur', 'Taller Viejo']);
      // A module that was deactivated still has its cases.
      expect(offers('tf-module')).toEqual(['Ventas', 'Ventas / Facturas', 'Bodega vieja']);
      expect(offers('tf-priority')).toEqual(['Baja', 'Media', 'Alta', 'Crítica']);
      expect(offers('tf-type')).toEqual(['Capacitación', 'Falla del sistema', 'Garantía']);
      // The users of the app, who register the cases. Not the responsibles.
      expect(offers('tf-created-by')).toEqual(['Ana', 'Luis']);
      expect(offers('tf-promise')).toEqual(['Con promesa de entrega', 'Por atender (vencidas, hoy y próximas)', 'Vencida', 'Para hoy', 'Próxima']);
    }));

    it('the responsible is anyone of the catalog, or "Sin asignar" for the cases nobody has', fakeAsync(() => {
      openWithFilters();
      expect(offers('tf-assignee')).toEqual(['Sin asignar', 'Ana', 'Luis', 'Zoe']);

      pick('tf-assignee', 'Sin asignar');
      expect(filtered()).toEqual({ ...ALWAYS, assignee: 'none' });
    }));

    describe('archived cases', () => {
      it('are left out unless asked for: the list starts on "Activos", which cannot be emptied', fakeAsync(() => {
        create();
        preferenceRead('tickets.columns').flush({ value: null });
        preferenceRead('tickets.filters-open').flush({ value: true });
        const read = listRead();
        // No parameter: the server then lists only the cases that are not archived.
        expect(read.request.params.has('archived')).toBeFalse();
        read.flush(ticketPage([ticket()], 50));
        settle();

        expect(chosen('tf-archived')).toEqual(['Activos']);
        expect(offers('tf-archived')).toEqual(['Activos', 'Archivados', 'Todos']);
        expect(() => clearSelect(select('tf-archived'))).toThrowError('The select has nothing to clear, or cannot be cleared');
      }));

      it('are the only ones listed with "Archivados", and listed with the rest with "Todos"', fakeAsync(() => {
        const archived = ticket({ archivedAt: '2026-11-08T09:00:00.000Z' });
        openWithFilters();

        pick('tf-archived', 'Archivados');
        expect(filtered([archived])).toEqual({ ...ALWAYS, archived: 'only' });
        expect(cell('Código').textContent).toContain('Archivado');

        pick('tf-archived', 'Todos');
        expect(filtered([archived, OTHER])).toEqual({ ...ALWAYS, archived: 'all' });
        expect(rows().length).toBe(2);

        pick('tf-archived', 'Activos');
        expect(filtered([OTHER])).toEqual(ALWAYS);
      }));

      // With "Todos" an archived case is one more of the list: it keeps its row, which now says so.
      it('archived while the list shows all of them keeps its row, with its badge', fakeAsync(() => {
        openWithFilters();
        pick('tf-archived', 'Todos');
        filtered([ticket()]);

        events.saved(ticket({ archivedAt: '2026-11-08T09:00:00.000Z' }), { archiving: true });
        render();
        expect(filtered([ticket({ archivedAt: '2026-11-08T09:00:00.000Z' })])).toEqual({ ...ALWAYS, archived: 'all' });
        expect(cell('Código').textContent).toContain('Archivado');
      }));
    });

    it('"Filtros" says how many are on, also while they are hidden', fakeAsync(() => {
      openWithFilters();
      expect(count()).toBe('');
      expect(filtersButton().getAttribute('aria-label')).toBe('Filtros');

      pick('tf-status', 'Resuelto');
      filtered();
      expect(count()).toBe('1');
      expect(filtersButton().getAttribute('aria-label')).toBe('Filtros: 1 activo');

      // The two ends of the dates are one filter.
      type(find('#tf-from'), '2026-11-01');
      filtered();
      type(find('#tf-to'), '2026-11-30');
      filtered();
      expect(count()).toBe('2');

      click(checkbox('Olvidados'));
      filtered();
      pick('tf-archived', 'Todos');
      filtered();
      expect(count()).toBe('4');
      expect(filtersButton().getAttribute('aria-label')).toBe('Filtros: 4 activos');

      // Hidden, the filters are still on: the number is all that says so.
      click(filtersButton());
      openSave().flush(null, STORED);
      settle();
      expect(filters()).toBeNull();
      expect(count()).toBe('4');
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    // The search is always in view, so it is not one of the filters the button counts.
    it('the search box narrows the list a moment after the person stops typing, and is not counted', fakeAsync(() => {
      open();
      type(search(), '  tornillo ');
      tick(299);
      http.expectNone((request) => request.url === '/api/tickets');

      tick(1);
      render();
      expect(filtered()).toEqual({ ...ALWAYS, q: 'tornillo' });
      expect(count()).toBe('');
    }));

    // The pause is a timer, and the app has no zone to tell Angular when it fires: the search is
    // a signal, and the list reads again and shows what it found on its own.
    it('the search box narrows the list by itself after the pause, with nobody checking the screen', fakeAsync(() => {
      open([ticket(), ticket({ id: 2, code: 'SOP-00002' })]);
      expect(el.textContent).toContain('2 caso(s)');
      type(search(), 'tornillo');

      tick(300);
      const read = listRead();
      expect(read.request.params.get('q')).toBe('tornillo');
      read.flush(ticketPage([ticket()], 50));
      tick();

      expect(el.textContent).toContain('1 caso(s)');
    }));

    // Left a moment after typing: there is no list left to filter.
    it('the search box leaves nothing behind when the screen goes away before it filters', fakeAsync(() => {
      open();
      const timers = spyOn(window, 'setTimeout').and.callThrough();
      const cleared = spyOn(window, 'clearTimeout').and.callThrough();
      type(search(), 'tornillo');
      const pending = timers.calls.all().find((call) => call.args[1] === 300)!.returnValue;

      fixture.destroy();
      expect(cleared).toHaveBeenCalledWith(pending);
    }));

    it('"Limpiar filtros" turns them all off, empties the search box and lists every active case again', fakeAsync(() => {
      openWithFilters();
      const clear = (): HTMLButtonElement => button('Limpiar filtros', filters()!);
      // Nothing to clear yet.
      expect(clear().disabled).toBeTrue();

      pick('tf-status', 'Resuelto');
      filtered();
      pick('tf-archived', 'Archivados');
      filtered();
      click(checkbox('Vencidos'));
      filtered();
      type(search(), 'tornillo');
      tick(300);
      render();
      expect(filtered()).toEqual({ ...ALWAYS, status: 'RESOLVED', archived: 'only', overdue: '1', q: 'tornillo' });

      click(clear());
      expect(filtered([ticket()])).toEqual(ALWAYS);
      expect(chosen('tf-status')).toEqual([]);
      expect(chosen('tf-archived')).toEqual(['Activos']);
      expect(checkbox('Vencidos').checked).toBeFalse();
      expect(search().value).toBe('');
      expect(count()).toBe('');
      expect(clear().disabled).toBeTrue();
    }));

    it('with no case to show say so, and offer to be cleared right there', fakeAsync(() => {
      openWithFilters();
      pick('tf-status', 'Resuelto');
      filtered([]);
      expect(find('tbody').textContent).toContain('Ningún caso coincide con los filtros.');

      click(button('Limpiar filtros', find('tbody')));
      expect(filtered([])).toEqual(ALWAYS);
      // No filter is on now: there are simply no cases yet.
      expect(find('tbody').textContent).toContain('Todavía no hay casos.');
    }));

    it('go back to the first page of the list', fakeAsync(() => {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: true });
      listRead().flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      settle();
      click(find('button[aria-label="Página siguiente"]'));
      expect(filtered([ticket()])).toEqual({ ...ALWAYS, page: '2' });

      pick('tf-status', 'Resuelto');
      expect(filtered()).toEqual({ ...ALWAYS, status: 'RESOLVED' });
    }));

    it('and the order of the list are the ones an export is made with', fakeAsync(() => {
      openWithFilters();
      pick('tf-company', 'Bodega Sur');
      filtered();
      pick('tf-type', 'Capacitación');
      filtered();
      pick('tf-archived', 'Todos');
      filtered();

      click(find('button[aria-haspopup=menu]'));
      click(find('[role=menu] button'));
      const download = http.expectOne((request) => request.url === '/api/export/xlsx');
      const params = download.request.params;
      expect(Object.fromEntries(params.keys().map((key) => [key, params.get(key)]))).toEqual({ companyId: '5', supportType: '1', archived: 'all', dir: 'desc' });
      download.error(new ProgressEvent('error'));
      settle();
    }));

    // "Ver olvidados en la lista", in the bell: the list opens with that filter on.
    it('a link of the bell turns its filter on and shows it, without changing what the user keeps', fakeAsync(() => {
      open();
      void TestBed.inject(Router).navigateByUrl('/?olvidados=1');
      settle();
      // The address no longer needs to carry it.
      settle();

      expect(filtered()).toEqual({ ...ALWAYS, stale: '1' });
      expect(filters()).not.toBeNull();
      expect(checkbox('Olvidados').checked).toBeTrue();
      expect(count()).toBe('1');
      expect(TestBed.inject(Router).url).toBe('/');
      // Shown for the link: not the person's own choice, which is not saved.
      expect(localStorage.getItem(COPY)).toBeNull();
      noSave();
    }));
  });

  // The form above the table, which replaces the row of the table where a case used to be typed.
  describe('"Nuevo caso"', () => {
    const today = todayIso();
    const formHost = (): HTMLElement | null => el.querySelector('app-new-ticket');
    const register = (): HTMLButtonElement => find('app-new-ticket button[type=submit]');
    const description = (): HTMLTextAreaElement => find('#nt-description');
    const note = (): HTMLInputElement => find('#nt-note');
    const caseDate = (): HTMLInputElement => find('#nt-date');
    const caseTime = (): HTMLInputElement => find('#nt-time');
    const caseSave = (): TestRequest => http.expectOne({ method: 'POST', url: '/api/tickets' });
    const stored = ticket({ id: 8, code: 'SOP-00008' });

    function openForm(): void {
      click(button('Nuevo caso'));
    }

    /** Answers the save of a new case, and the read of the list that a new case starts. */
    function answer(save: TestRequest, created: TicketDetail = stored): void {
      save.flush(created);
      settle();
      listRead().flush(ticketPage([created, ticket()], 50));
      settle();
    }

    it('opens a form above the table, and closes it', fakeAsync(() => {
      open();
      expect(formHost()).toBeNull();
      expect(button('Nuevo caso').getAttribute('aria-expanded')).toBe('false');

      openForm();
      expect(formHost()).not.toBeNull();
      expect(button('Nuevo caso').getAttribute('aria-expanded')).toBe('true');
      // Above the table, not in it.
      expect(formHost()!.compareDocumentPosition(find('table')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // Ready to be filled in: the date is today, and the focus is on the first thing to choose.
      expect(caseDate().value).toBe(today);
      expect(document.activeElement).toBe(select('nt-company').querySelector('input'));

      click(find('button[aria-label="Cerrar el formulario de caso nuevo"]'));
      expect(formHost()).toBeNull();
    }));

    it('needs a company and a description: until it has both there is nothing to register', fakeAsync(() => {
      /** Enter in a field sends a form whatever its button looks like. */
      function pressEnter(): void {
        find<HTMLFormElement>('app-new-ticket form').dispatchEvent(new Event('submit'));
        render();
      }
      open();
      openForm();
      expect(register().disabled).toBeTrue();

      pick('nt-company', 'Acme');
      expect(register().disabled).toBeTrue();
      // Spaces are not a description.
      type(description(), '   ');
      expect(register().disabled).toBeTrue();
      pressEnter();

      type(description(), 'No imprime');
      expect(register().disabled).toBeFalse();

      clearSelect(select('nt-company'));
      render();
      expect(register().disabled).toBeTrue();
      pressEnter();
      http.expectNone({ method: 'POST', url: '/api/tickets' });
    }));

    // Users are not responsibles: registering a case makes nobody its responsible.
    it('registers the case with only what was filled in, and with no responsible', fakeAsync(() => {
      open();
      openForm();
      pick('nt-company', 'Bodega Sur');
      type(description(), '  No abre la caja ');
      click(register());

      const save = caseSave();
      expect(sent(save)).toEqual({ date: today, companyId: 5, description: 'No abre la caja', status: 'PENDING', assigneeId: null });
      // While it is on its way a second press sends nothing, from the button or from the keyboard.
      expect(register().disabled).toBeTrue();
      expect(register().textContent).toContain('Registrando…');
      description().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      render();
      http.expectNone({ method: 'POST', url: '/api/tickets' });
      answer(save);

      expect(toasts()).toEqual(['Caso SOP-00008 registrado']);
      // The list shows it: a new case has the list read again.
      expect(rows().length).toBe(2);
    }));

    // The list has nothing to edit a case with: what a case needs can be given as it is registered.
    it('registers everything the form has: date, time, status, responsible, priority, module, support types and a first observation', fakeAsync(() => {
      open();
      openForm();
      type(caseDate(), '2026-11-03');
      type(caseTime(), '09:15');
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      pick('nt-status', 'Resuelto');
      pick('nt-assignee', 'Luis');
      pick('nt-priority', 'Alta');
      pick('nt-module', 'Ventas / Facturas');
      pick('nt-types', 'Falla del sistema');
      pick('nt-types', 'Capacitación');
      closeSelect(select('nt-types'));
      render();
      expect(chosen('nt-types')).toEqual(['Falla del sistema', 'Capacitación']);
      type(note(), ' Se reinició la impresora ');
      click(register());

      const save = caseSave();
      expect(sent(save)).toEqual({
        date: '2026-11-03',
        time: '09:15',
        companyId: 1,
        description: 'No imprime',
        status: 'RESOLVED',
        assigneeId: 5,
        priority: 'HIGH',
        moduleId: 2,
        supportTypeIds: [2, 1],
        note: 'Se reinició la impresora',
      });
      answer(save);
    }));

    it('has the priority and the module of the case form: both optional, and only the active modules', fakeAsync(() => {
      open();
      openForm();

      expect(find('label[for=nt-priority]').textContent).toBe('Prioridad');
      expect(find('label[for=nt-module]').textContent).toBe('Módulo');
      // Neither is chosen to start with, and each says so.
      expect(chosen('nt-priority')).toEqual([]);
      expect(select('nt-priority').textContent).toContain('Sin prioridad');
      expect(chosen('nt-module')).toEqual([]);
      expect(select('nt-module').textContent).toContain('Sin módulo');
      expect(offers('nt-priority')).toEqual(['Baja', 'Media', 'Alta', 'Crítica']);
      // A deactivated module takes no new cases.
      expect(offers('nt-module')).toEqual(['Ventas', 'Ventas / Facturas']);

      // Chosen, they can be taken off again before registering.
      pick('nt-priority', 'Crítica');
      pick('nt-module', 'Ventas');
      clearSelect(select('nt-priority'));
      clearSelect(select('nt-module'));
      render();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());
      const save = caseSave();
      expect(sent(save)).toEqual({ date: today, companyId: 1, description: 'No imprime', status: 'PENDING', assigneeId: null });
      answer(save);
    }));

    it('stays open for the next case: emptied, with the date and the responsible of the one before', fakeAsync(() => {
      open();
      openForm();
      type(caseDate(), '2026-11-03');
      type(caseTime(), '09:15');
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      pick('nt-status', 'Resuelto');
      pick('nt-assignee', 'Luis');
      pick('nt-priority', 'Alta');
      pick('nt-module', 'Ventas');
      pick('nt-types', 'Capacitación');
      closeSelect(select('nt-types'));
      type(note(), 'Se reinició la impresora');
      click(register());
      answer(caseSave());

      expect(formHost()).not.toBeNull();
      expect(chosen('nt-company')).toEqual([]);
      expect(description().value).toBe('');
      expect(caseTime().value).toBe('');
      expect(chosen('nt-status')).toEqual(['Pendiente']);
      expect(chosen('nt-priority')).toEqual([]);
      expect(chosen('nt-module')).toEqual([]);
      expect(chosen('nt-types')).toEqual([]);
      expect(note().value).toBe('');
      // Cases typed in a row are often of the same day, and taken by the same person.
      expect(caseDate().value).toBe('2026-11-03');
      expect(chosen('nt-assignee')).toEqual(['Luis']);
      // Nothing to register until the next one is filled in, starting by its company.
      expect(register().disabled).toBeTrue();
      expect(document.activeElement).toBe(select('nt-company').querySelector('input'));

      // And the next one is registered the same way.
      pick('nt-company', 'Bodega Sur');
      type(description(), 'No abre la caja');
      click(register());
      const second = caseSave();
      expect(sent(second)).toEqual({ date: '2026-11-03', companyId: 5, description: 'No abre la caja', status: 'PENDING', assigneeId: 5 });
      answer(second, ticket({ id: 9, code: 'SOP-00009' }));
      expect(toasts()).toEqual(['Caso SOP-00008 registrado', 'Caso SOP-00009 registrado']);
    }));

    it('is sent with Ctrl+Enter from the description, where Enter is a new line', fakeAsync(() => {
      open();
      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime\ndesde ayer');
      description().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true }));
      render();

      const save = caseSave();
      expect(sent(save)).toEqual(jasmine.objectContaining({ description: 'No imprime\ndesde ayer' }));
      answer(save);
    }));

    it('that the server refuses says why, and keeps what was typed to correct it', fakeAsync(() => {
      open();
      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      type(note(), 'Urgente');
      click(register());
      caseSave().flush({ message: 'La fecha del caso no puede ser posterior a hoy' }, REFUSED);
      settle();

      expect(toasts()).toEqual(['La fecha del caso no puede ser posterior a hoy']);
      expect(chosen('nt-company')).toEqual(['Acme']);
      expect(description().value).toBe('No imprime');
      expect(note().value).toBe('Urgente');
      expect(register().disabled).toBeFalse();
      // No case was added: the list is not read again.
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    it('with its date left empty registers the case as of today', fakeAsync(() => {
      open();
      openForm();
      type(caseDate(), '');
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());

      const save = caseSave();
      expect(sent(save)).toEqual(jasmine.objectContaining({ date: today }));
      answer(save);
      // The form shows the date it used.
      expect(caseDate().value).toBe(today);
    }));

    // The new case has the highest number, so it is on the first page of a list ordered as it starts.
    it('takes the list to the page where the new case is', fakeAsync(() => {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      settle();
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total: 120, page: 2, pageSize: 50 });
      settle();

      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());
      caseSave().flush(stored);
      settle();
      // The new case has the page it is on read again; then the list goes to the first one.
      const again = listRead();
      expect(again.request.params.get('page')).toBe('2');
      again.flush({ items: [ticket()], total: 121, page: 2, pageSize: 50 });
      settle();
      const first = listRead();
      expect(first.request.params.get('page')).toBe('1');
      first.flush({ items: [stored, ticket()], total: 121, page: 1, pageSize: 50 });
      settle();
      expect(el.textContent).toContain('Página 1 de 3');
    }));

    // From the lowest ticket number, the new case is the last one: on the last page, which the
    // list that the new case asked for says, since the new case may have made one more.
    it('takes the list in the other order to its last page, where the new case is', fakeAsync(() => {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [ticket()], total: 100, page: 1, pageSize: 50 });
      settle();
      click(button('Código', find('thead')));
      listRead().flush({ items: [ticket()], total: 100, page: 1, pageSize: 50 });
      settle();

      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());
      caseSave().flush(stored);
      settle();
      listRead().flush({ items: [ticket()], total: 101, page: 1, pageSize: 50 });
      settle();
      const last = listRead();
      expect(last.request.params.get('page')).toBe('3');
      expect(last.request.params.get('dir')).toBe('asc');
      last.flush({ items: [stored], total: 101, page: 3, pageSize: 50 });
      settle();
      expect(el.textContent).toContain('Página 3 de 3');
    }));

    // A read asked for before the case was registered fails just after it, before the screen
    // update that would cancel it: the old total it would go by is one case short.
    it('takes the list to the page of the new case also when a read asked for before it fails just after it', fakeAsync(() => {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [ticket()], total: 100, page: 1, pageSize: 50 });
      settle();
      click(button('Código', find('thead')));
      listRead().flush({ items: [ticket()], total: 100, page: 1, pageSize: 50 });
      settle();

      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());
      events.outdated(null);
      render();
      const before = listRead();
      caseSave().flush(stored);
      flushMicrotasks();
      before.flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      flushMicrotasks();
      render();

      listRead().flush({ items: [ticket()], total: 101, page: 1, pageSize: 50 });
      settle();
      const last = listRead();
      expect(last.request.params.get('page')).toBe('3');
      last.flush({ items: [stored], total: 101, page: 3, pageSize: 50 });
      settle();
      expect(el.textContent).toContain('Página 3 de 3');
    }));

    // The list could not say where the new case is: the cases it has on screen say it.
    it('takes the list to the page of the new case also when the list the new case asked for cannot be read', fakeAsync(() => {
      create();
      preferenceRead('tickets.columns').flush({ value: null });
      preferenceRead('tickets.filters-open').flush({ value: null });
      listRead().flush({ items: [ticket()], total: 120, page: 1, pageSize: 50 });
      settle();
      click(find('button[aria-label="Página siguiente"]'));
      listRead().flush({ items: [ticket()], total: 120, page: 2, pageSize: 50 });
      settle();

      openForm();
      pick('nt-company', 'Acme');
      type(description(), 'No imprime');
      click(register());
      caseSave().flush(stored);
      settle();
      listRead().flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      settle();
      expect(toasts()).toEqual(['Caso SOP-00008 registrado', 'Error interno']);
      const first = listRead();
      expect(first.request.params.get('page')).toBe('1');
      first.flush({ items: [stored, ticket()], total: 121, page: 1, pageSize: 50 });
      settle();
      expect(el.textContent).toContain('Página 1 de 3');

      // Once there, a later read leaves it where it is.
      events.outdated(null);
      render();
      listRead().flush({ items: [stored, ticket()], total: 121, page: 1, pageSize: 50 });
      settle();
      expect(el.textContent).toContain('Página 1 de 3');
      http.expectNone((request) => request.url === '/api/tickets');
    }));

    describe('the responsible', () => {
      /** The catalogs as they arrive from the server, some time after the screen is on. */
      function catalogsArrive(): void {
        // The logged-in user has the name of a responsible, and is not that responsible.
        catalogs.users.set([...USERS]);
        catalogs.assignees.set([...ASSIGNEES]);
        settle();
      }

      // The people of the catalog; the deactivated ones take no new cases. "Cliente" is not an
      // option of its own: a team that wants it adds it as one more responsible.
      it('is chosen among the active responsibles, or nobody', fakeAsync(() => {
        catalogs.assignees.set([]);
        open();
        openForm();
        catalogsArrive();

        expect(offers('nt-assignee')).toEqual(['Ana', 'Luis']);
      }));

      // Users are not responsibles: registering a case makes nobody its responsible.
      it('starts as nobody, whoever registers the case', fakeAsync(() => {
        catalogs.assignees.set([]);
        open();
        openForm();
        expect(chosen('nt-assignee')).toEqual([]);

        catalogsArrive();
        expect(chosen('nt-assignee')).toEqual([]);
        expect(select('nt-assignee').textContent).toContain('Sin asignar');
      }));

      it('keeps the one chosen when the catalogs are read again', fakeAsync(() => {
        open();
        openForm();
        pick('nt-assignee', 'Luis');

        catalogsArrive();

        expect(chosen('nt-assignee')).toEqual(['Luis']);
      }));

      it('can be taken off again before registering', fakeAsync(() => {
        open();
        openForm();
        pick('nt-assignee', 'Luis');
        clearSelect(select('nt-assignee'));
        render();
        pick('nt-company', 'Acme');
        type(description(), 'No imprime');
        click(register());

        const save = caseSave();
        expect(sent(save)).toEqual(jasmine.objectContaining({ assigneeId: null }));
        answer(save);
      }));
    });

    // A case is of a company of the catalog.
    describe('the company', () => {
      const created: Company = { id: 9, name: 'Ferretería El Tornillo', active: true, tickets: 0 };

      it('is chosen among the active companies, and found by typing part of its name', fakeAsync(() => {
        open();
        openForm();
        expect(offers('nt-company')).toEqual(['Acme', 'Bodega Sur']);

        typeInSelect(select('nt-company'), 'bodega');
        render();
        expect(optionTexts(select('nt-company'))).toEqual(['Bodega Sur', 'Crear empresa «bodega»']);
        pick('nt-company', 'Bodega Sur');
        expect(chosen('nt-company')).toEqual(['Bodega Sur']);
        noSave();
      }));

      it('that is not in the catalog is created right there with "Crear empresa «X»", and chosen for the case', fakeAsync(() => {
        open();
        openForm();
        typeInSelect(select('nt-company'), 'Ferretería El Tornillo');
        render();
        pick('nt-company', 'Crear empresa «Ferretería El Tornillo»');

        const add = http.expectOne({ method: 'POST', url: '/api/companies' });
        expect(add.request.body).toEqual({ name: 'Ferretería El Tornillo' });
        add.flush(created);
        settle();
        expect(toasts()).toEqual(['Empresa «Ferretería El Tornillo» creada']);
        expect(chosen('nt-company')).toEqual(['Ferretería El Tornillo']);
        // The other screens offer it too, without reading the catalogs again.
        expect(catalogs.activeCompanies().map((company) => company.name)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
        // The case itself is not registered yet.
        http.expectNone({ method: 'POST', url: '/api/tickets' });

        type(description(), 'No imprime');
        click(register());
        const save = caseSave();
        expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 9 }));
        answer(save, ticket({ id: 8, code: 'SOP-00008', companyId: 9, company: 'Ferretería El Tornillo' }));
      }));

      it('that the server refuses to create: says why, and no company is chosen', fakeAsync(() => {
        open();
        openForm();
        typeInSelect(select('nt-company'), 'acmé');
        render();
        pick('nt-company', 'Crear empresa «acmé»');
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush({ message: 'Ya existe una empresa con ese nombre' }, { status: 409, statusText: 'Conflict' });
        settle();

        expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
        closeSelect(select('nt-company'));
        render();
        expect(chosen('nt-company')).toEqual([]);
      }));

      // The option stays in the list until the server answers: a double click presses it twice.
      it('pressed twice on "Crear empresa «X»" before the server answers, is created once and nothing is refused', fakeAsync(() => {
        open();
        openForm();
        typeInSelect(select('nt-company'), 'Ferretería El Tornillo');
        render();
        pick('nt-company', 'Crear empresa «Ferretería El Tornillo»');
        pick('nt-company', 'Crear empresa «Ferretería El Tornillo»');

        // Exactly one POST: `expectOne` fails on two.
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush(created);
        settle();
        expect(toasts()).toEqual(['Empresa «Ferretería El Tornillo» creada']);
        expect(chosen('nt-company')).toEqual(['Ferretería El Tornillo']);
        expect(catalogs.activeCompanies().map((company) => company.name)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
      }));
    });

    it('offers the active support types, each as a chip of its colour', fakeAsync(() => {
      open();
      openForm();

      expect(offers('nt-types')).toEqual(['Capacitación', 'Falla del sistema']);
      pick('nt-types', 'Capacitación');
      closeSelect(select('nt-types'));
      render();
      const chip = select('nt-types').querySelector<HTMLElement>('app-type-chip')!;
      expect(chip.style.backgroundColor).toBe('rgb(18, 183, 106)');
    }));
  });

  describe('a paste', () => {
    // The dialog is loaded apart from the page the first time it opens (see the next describe).
    it('of a screenshot opens "Nuevo caso con IA" with it', fakeAsync(() => {
      open();
      expect(el.querySelector('app-ai-draft')).toBeNull();
      const event = paste(document.body, [picture]);
      render();
      settle();

      expect(event.defaultPrevented).toBeTrue();
      expect(find('app-ai-draft').querySelectorAll('img').length).toBe(1);
    }));

    it('of a screenshot opens the dialog with it again after the dialog was closed', fakeAsync(() => {
      open();
      paste(document.body, [picture]);
      render();
      settle();
      click(find('app-ai-draft button[aria-label="Cerrar"]'));
      expect(el.querySelector('app-ai-draft')).toBeNull();

      const second = new File(['png'], 'otra.png', { type: 'image/png' });
      paste(document.body, [picture, second]);
      render();
      settle();
      expect(Array.from(find('app-ai-draft').querySelectorAll('img'), (image) => image.alt)).toEqual(['captura.png', 'otra.png']);
    }));

    // A cell copied from Excel carries its text and a picture of the cell.
    it('of text into a field is left to the browser, even when the clipboard also has a picture of it', fakeAsync(() => {
      open();
      click(button('Nuevo caso'));
      const fields = [find('input[type=search]'), ngSelect(el, 'nt-company').querySelector('input')!, find('#nt-description'), find('#nt-note')];
      for (const field of fields) {
        const event = paste(field, [picture], 'Ferretería El Tornillo');
        render();
        expect(event.defaultPrevented).toBeFalse();
        expect(el.querySelector('app-ai-draft')).toBeNull();
      }
    }));
  });

  // "Nuevo con IA" and "Importar" open on demand: their code is loaded apart from the page.
  describe('the dialogs', () => {
    it('"Importar" opens its own, which closes with Escape and opens again', fakeAsync(() => {
      open();
      expect(el.querySelector('app-import-dialog')).toBeNull();

      click(find('button[aria-label="Importar"]'));
      settle();
      expect(find('app-import-dialog [role=dialog]').getAttribute('aria-labelledby')).toBe('import-title');

      pressEscape();
      expect(el.querySelector('app-import-dialog')).toBeNull();
      click(find('button[aria-label="Importar"]'));
      settle();
      expect(el.querySelector('app-import-dialog')).not.toBeNull();
    }));

    it('"Nuevo con IA" opens its own, with no image', fakeAsync(() => {
      open();
      click(find('button[title="Crear un caso desde una foto, captura o texto"]'));
      settle();

      expect(find('app-ai-draft #ai-title').textContent?.trim()).toBe('Nuevo caso con IA');
      expect(find('app-ai-draft').querySelectorAll('img').length).toBe(0);
    }));
  });

  // Below 640 px their text is hidden, and a hidden text names nothing.
  describe('the buttons that show only their icon on a phone', () => {
    const exportButton = (): HTMLButtonElement => find('button[aria-haspopup=menu]');

    it('have a name of their own', fakeAsync(() => {
      open();
      expect(find('button app-icon[data-icon=file-import-outline]').closest('button')!.getAttribute('aria-label')).toBe('Importar');
      expect(exportButton().getAttribute('aria-label')).toBe('Exportar');
      expect(find('button[aria-controls="ticket-filters"]').getAttribute('aria-label')).toBe('Filtros');
      expect(find('app-ticket-columns > button').getAttribute('aria-label')).toBe('Columnas');
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

// The code of the two dialogs comes apart from the page (`@defer`): here it has not arrived yet when
// the person pastes, as on a slow connection the first time.
describe('TicketsPage, with the code of its dialogs still on its way', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TicketsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    forgetBrowserCopies();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), provideScreenWidth(DESKTOP)],
      // Each `@defer` block stays as it is until the test loads it.
      deferBlockBehavior: DeferBlockBehavior.Manual,
    });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'AGENT' });
  });

  afterEach(() => {
    http.verify();
    forgetBrowserCopies();
  });

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  it('a screenshot pasted on the list reaches the AI dialog once its code arrives', fakeAsync(() => {
    fixture = TestBed.createComponent(TicketsPage);
    el = fixture.nativeElement as HTMLElement;
    render();
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.columns' }).flush({ value: null });
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.filters-open' }).flush({ value: null });
    http.expectOne((request) => request.url === '/api/tickets').flush(ticketPage([ticket()], 50));
    tick();
    render();

    // The AI dialog and the import dialog, in the order of the page.
    let blocks: DeferBlockFixture[] = [];
    void fixture.getDeferBlocks().then((found) => (blocks = found));
    flushMicrotasks();
    expect(blocks.length).toBe(2);

    const event = paste(document.body, [picture]);
    render();
    expect(event.defaultPrevented).toBeTrue();
    expect(el.querySelector('app-ai-draft')).toBeNull();

    void blocks[0].render(DeferBlockState.Complete);
    flushMicrotasks();
    render();
    expect(el.querySelector('app-ai-draft')?.querySelectorAll('img').length).toBe(1);
    expect(el.querySelector('app-import-dialog')).toBeNull();
  }));

  // A press on "Importar" with the code of the dialog late, and then not coming at all (offline,
  // or the app was updated and the old code is gone).
  it('says the dialog is opening while its code is late, and that it could not open when it does not come', fakeAsync(() => {
    fixture = TestBed.createComponent(TicketsPage);
    el = fixture.nativeElement as HTMLElement;
    render();
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.columns' }).flush({ value: null });
    http.expectOne({ method: 'GET', url: '/api/preferences/tickets.filters-open' }).flush({ value: null });
    http.expectOne((request) => request.url === '/api/tickets').flush(ticketPage([ticket()], 50));
    tick();
    render();
    let blocks: DeferBlockFixture[] = [];
    void fixture.getDeferBlocks().then((found) => (blocks = found));
    flushMicrotasks();
    const importButton = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('button[aria-label="Importar"]')!;
    const pending = (): HTMLElement | null => el.querySelector('app-dialog-pending');

    importButton().click();
    void blocks[1].render(DeferBlockState.Loading);
    flushMicrotasks();
    render();
    expect(pending()?.querySelector('[role=status]')?.textContent?.trim()).toBe('Abriendo…');

    void blocks[1].render(DeferBlockState.Error);
    flushMicrotasks();
    render();
    expect(pending()?.querySelector('[role=status]')).toBeNull();
    expect(pending()?.querySelector('[role=alertdialog] h2')?.textContent?.trim()).toBe('No se pudo abrir');
    expect(el.querySelector('app-import-dialog')).toBeNull();

    // Closed, the button opens it again: it says the same, and the page is not stuck.
    pending()!.querySelector<HTMLButtonElement>('[role=alertdialog] button')!.click();
    render();
    expect(pending()).toBeNull();
    importButton().click();
    render();
    expect(pending()?.querySelector('[role=alertdialog]')).not.toBeNull();
  }));
});
