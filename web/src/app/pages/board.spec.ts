import { CdkDrag, CdkDropList } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ScrollDispatcher } from '@angular/cdk/scrolling';
import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { SAID_MS } from '../core/announcer';
import type { Ticket, TicketStatus } from '../core/api';
import { Catalogs } from '../core/catalogs';
import { STATUS_DELAY_MS } from '../core/status';
import { TicketEvents } from '../core/ticket-events';
import { ASSIGNEES, ticket, ticketPage } from '../testing/fixtures';
import { httpTestBed } from '../testing/http';
import { chooseOption, clearSelect, closeSelect, ngSelect, optionTexts, selectedTexts } from '../testing/ng-select';
import { reduceMotion } from '../testing/reduced-motion';
import { said, toasts } from '../testing/screen';
import { resizeScreen } from '../testing/viewport';
import { textOf } from '../testing/text';
import { BoardPage } from './board';

/** One read of the board: the open cases and the latest resolved ones, asked for together. */
interface BoardRead {
  open: TestRequest;
  resolved: TestRequest;
}

const REFUSED = { status: 400, statusText: 'Bad Request' };

const OF_ANA = ticket({ id: 8, code: 'SOP-00008', assignees: [{ id: 4, name: 'Ana' }] });
const OF_ZOE = ticket({ id: 9, code: 'SOP-00009', status: 'RESOLVED', assignees: [{ id: 6, name: 'Zoe' }] });
/** A case of two responsibles. */
const OF_TEAM = ticket({
  id: 10,
  code: 'SOP-00010',
  assignees: [
    { id: 4, name: 'Ana' },
    { id: 5, name: 'Luis' },
  ],
});
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
    http = httpTestBed();
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

  /** Both requests of a read were cancelled: a newer read took its place, and its answer never arrives. */
  const cancelled = (pending: BoardRead): boolean => pending.open.cancelled && pending.resolved.cancelled;

  /** Answers a read with these cases, each in the request that asks for its status. */
  function answer(pending: BoardRead, tickets: Ticket[]): void {
    pending.open.flush(ticketPage(tickets.filter((t) => t.status !== 'RESOLVED'), 500));
    pending.resolved.flush(ticketPage(tickets.filter((t) => t.status === 'RESOLVED'), 500));
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
    return Array.from(section.querySelectorAll('[data-case-id]'), (card) => card.textContent).join('\n');
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

  /** The codes of the cards on the board, column after column. */
  const cards = (): string[] => Array.from(el.querySelectorAll('[data-case-id] .font-mono'), (code) => code.textContent ?? '');
  const filter = (): HTMLElement => ngSelect(el, 'Filtrar por responsable');

  describe('answers that arrive out of order', () => {
    /** "Actualizar", pressed: the columns are read again with the screen update that follows. */
    function refresh(): void {
      el.querySelector<HTMLButtonElement>('button[aria-label="Actualizar"]')!.click();
      render();
    }

    it('an older read is cancelled by the latest one, whose answer is the one shown', fakeAsync(() => {
      create();
      const older = read();
      refresh();
      const newer = read();
      expect(cancelled(older)).toBeTrue();

      answer(newer, [ticket({ company: 'Acme del Sur' })]);
      settle();
      expect(column('Pendiente')).toContain('Acme del Sur');
      expect(column('Sin resolver')).toBe('');
    }));

    it('the board keeps saying it is loading until the latest read is answered', fakeAsync(() => {
      create();
      const older = read();
      refresh();
      const newer = read();

      expect(cancelled(older)).toBeTrue();
      settle();
      expect(el.textContent).toContain('Cargando…');
      expect(column('Pendiente')).toBe('');

      answer(newer, [ticket()]);
      settle();
      expect(el.textContent).not.toContain('Cargando…');
      expect(column('Pendiente')).toContain('SOP-00007');
    }));

    it('turns the icon of "Actualizar" while it reads, and stops it with the answer', fakeAsync(() => {
      const turning = (): boolean => {
        const icon = el.querySelector('button[aria-label="Actualizar"] app-icon[data-icon=refresh] svg')!;
        return getComputedStyle(icon).animationName !== 'none';
      };
      create();
      const first = read();
      settle();
      expect(turning()).toBeTrue();

      answer(first, [ticket()]);
      settle();
      expect(turning()).toBeFalse();

      refresh();
      const again = read();
      settle();
      expect(turning()).toBeTrue();
      answer(again, [ticket()]);
      settle();
      expect(turning()).toBeFalse();
    }));
  });

  // The icon of "Actualizar" that turns was all the eye was shown of a read, and with less motion it stands still.
  describe('a read, with less motion asked for', () => {
    const words = (): HTMLElement | undefined => Array.from(el.querySelectorAll<HTMLElement>('span')).find((span) => span.textContent?.trim() === 'Actualizando…');
    const seen = (): boolean => {
      const shown = words();
      return !!shown && getComputedStyle(shown).display !== 'none' && shown.getBoundingClientRect().width > 0;
    };

    it('is written beside "Actualizar" for the eye until its answer arrives, the read of a change made elsewhere too', fakeAsync(() => {
      create();
      reduceMotion();
      const first = read();
      settle();
      expect(seen()).toBeTrue();
      // Who hears the page is told by the status, and only of a read they asked for.
      expect(words()!.getAttribute('aria-hidden')).toBe('true');
      expect(words()!.previousElementSibling?.getAttribute('aria-label')).toBe('Actualizar');

      answer(first, [ticket()]);
      settle();
      expect(words()).toBeUndefined();

      // Someone else changed a case: read in silence, but in sight, as the icon would have turned.
      events.outdated(null);
      render();
      const again = read();
      settle();
      expect(seen()).toBeTrue();
      answer(again, [ticket()]);
      settle();
      expect(words()).toBeUndefined();
    }));

    it('is left to the icon that turns when motion is welcome', fakeAsync(() => {
      create();
      const first = read();
      settle();
      expect(words()).toBeDefined();
      expect(seen()).toBeFalse();
      answer(first, [ticket()]);
      settle();
    }));
  });

  describe('a read that fails', () => {
    it('says why, and leaves the cards it had on the board', fakeAsync(() => {
      open([ticket(), OF_ANA]);
      el.querySelector<HTMLButtonElement>('button[aria-label="Actualizar"]')!.click();
      render();
      const again = read();
      again.open.flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      again.resolved.flush(ticketPage([], 30));
      settle();

      expect(toasts()).toEqual(['Error interno']);
      expect(cards()).toEqual(['SOP-00007', 'SOP-00008']);
      expect(el.textContent).not.toContain('Cargando…');
    }));
  });

  describe('a case saved by this tab', () => {
    // The read may have been taken before the save was stored: shown, it would undo the save on screen.
    it('while the columns are being read moves its card, and the columns are read again', fakeAsync(() => {
      open();
      // Someone else changed a case: the columns are read again.
      events.outdated(null);
      render();
      const stale = read();

      events.saved(ticket({ status: 'UNRESOLVED' }));
      render();
      expect(column('Sin resolver')).toContain('SOP-00007');
      const fresh = read();

      // Its answer, maybe older than the save, never arrives.
      expect(cancelled(stale)).toBeTrue();
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
      open([ticket(), OF_ANA, OF_ZOE, OF_TEAM]);
      chooseOption(filter(), 'Sin asignar');
      render();

      expect(cards()).toEqual(['SOP-00007']);
    }));

    // As the list: a case of two responsibles is one of each of them.
    it('leaves a case of several responsibles under the filter of each one', fakeAsync(() => {
      open([ticket(), OF_ANA, OF_TEAM]);

      chooseOption(filter(), 'Luis');
      render();
      expect(cards()).toEqual(['SOP-00010']);

      chooseOption(filter(), 'Ana');
      render();
      expect(cards()).toEqual(['SOP-00008', 'SOP-00010']);
    }));
  });

  describe('a card', () => {
    it('names every responsible of its case, by name and separated by commas, and "Sin asignar" for nobody', fakeAsync(() => {
      open([ticket(), OF_TEAM]);

      const card = (id: number): string => textOf(el.querySelector(`[data-case-id="${id}"]`));
      expect(card(10)).toContain('Ana, Luis');
      expect(card(7)).toContain('Sin asignar');
    }));

    it('shows the support types of its case as chips, each in its colour, and none for a case without them', fakeAsync(() => {
      const types = [
        { id: 1, name: 'Capacitación', color: '#12b76a' },
        { id: 2, name: 'Falla del sistema', color: '#b91c1c' },
      ];
      open([ticket({ supportTypes: types }), OF_ANA]);

      const [typed, plain] = Array.from(el.querySelectorAll('[data-case-id]'));
      const chips = Array.from(typed.querySelectorAll<HTMLElement>('app-type-chip'));
      expect(chips.map((chip) => chip.textContent?.trim())).toEqual(['Capacitación', 'Falla del sistema']);
      expect(chips.map((chip) => chip.style.backgroundColor)).toEqual(['rgb(18, 183, 106)', 'rgb(185, 28, 28)']);
      expect(plain.querySelector('app-type-chip')).toBeNull();
    }));

    // Dragging it is for the mouse and for touch. The keyboard, and who hears the page, open it as a button.
    for (const [name, key] of [
      ['Enter', 'Enter'],
      ['Space', ' '],
    ]) {
      it(`is a button that ${name} opens, without scrolling the column`, fakeAsync(() => {
        open();
        const card = el.querySelector<HTMLElement>('[data-case-id]')!;
        expect(card.getAttribute('role')).toBe('button');
        expect(card.tabIndex).toBe(0);

        const press = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        card.dispatchEvent(press);
        render();

        expect(press.defaultPrevented).toBe(key === ' ');
        expect(el.querySelector('app-ticket-panel')).not.toBeNull();
        http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
        settle();
      }));
    }
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
      render();
      const stale = read();

      events.saved(ticket({ archivedAt: ARCHIVED }));
      render();
      expect(cards()).toEqual(['SOP-00008']);
      const fresh = read();

      // Its answer, maybe older than the archiving, never arrives.
      expect(cancelled(stale)).toBeTrue();
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

  // Drawn for real, with the stylesheet of the app, on a screen of the size of each test.
  describe('drawn on the screen', () => {
    /** A company registered with no spaces, and a description that is a link: words that do not break by themselves. */
    const LONG = ticket({
      company: 'UnidadEducativaParticularJaguarDelValleDeLosChillosYSusAlrededores'.repeat(3),
      description: 'https://soporte.example.test/casos/abiertos?empresa=UnidadEducativaParticularJaguar&modulo=FacturacionElectronica',
      assignees: [
        { id: 4, name: 'FernandaGisellaVillavicencioQuiñónezDeLaTorre' },
        { id: 5, name: 'MaríaJoséAlexandraCarrionDeLosMonteros' },
      ],
      notesCount: 3,
    });

    const sections = (): HTMLElement[] => Array.from(el.querySelectorAll<HTMLElement>('section'));
    const columns = (): HTMLElement => sections()[0].parentElement!;

    // The column of a card with such a word took 4320 px, and pushed the other two off a screen of 2560.
    for (const [width, height] of [
      [768, 1024],
      [1440, 900],
      [2560, 1440],
    ]) {
      it(`at ${width} px shares the width between the three columns, whatever the cards say`, fakeAsync(() => {
        resizeScreen(width, height);
        open([LONG, ticket({ id: 9, code: 'SOP-00009', status: 'RESOLVED' })]);

        expect(columns().scrollWidth).toBe(columns().clientWidth);
        const [first, ...others] = sections().map((section) => section.offsetWidth);
        for (const other of others) expect(other).toBeCloseTo(first, -1);
        for (const card of Array.from(el.querySelectorAll<HTMLElement>('[data-case-id]'))) expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
      }));
    }

    // A column was 320 px wide on a phone of 320: its cards were cut, and the next column out of sight.
    it('on a small phone makes a column narrower than the screen, with the next one in sight at its edge', fakeAsync(() => {
      resizeScreen(320, 568);
      open([LONG]);

      const [first, second] = sections();
      expect(first.offsetWidth).toBeLessThanOrEqual(320 - 48);
      expect(second.getBoundingClientRect().left).toBeLessThan(320);
      expect(el.querySelector<HTMLElement>('[data-case-id]')!.scrollWidth).toBeLessThanOrEqual(el.querySelector<HTMLElement>('[data-case-id]')!.clientWidth);
    }));

    // The count of observations went on to a line of its own, under its icon, next to a long name.
    it('keeps the count of observations of a card next to its icon, on one line', fakeAsync(() => {
      resizeScreen(390, 844);
      open([LONG]);

      const count = Array.from(el.querySelectorAll<HTMLElement>('[data-case-id] span')).find((span) => span.textContent?.trim() === '3')!;
      expect(count.getBoundingClientRect().height).toBeLessThanOrEqual(20);
    }));

    // Dragged near the edge of the screen, a card scrolls the columns: on a phone the last one is out of sight.
    it('scrolls the columns while a card is dragged near their edge', fakeAsync(() => {
      open();

      const lists = el.querySelectorAll<HTMLElement>('[cdkdroplist], .cdk-drop-list');
      expect(lists.length).toBe(3);
      const scrollers = TestBed.inject(ScrollDispatcher).getAncestorScrollContainers(lists[0]);
      expect(scrollers.map((scroller) => scroller.getElementRef().nativeElement)).toContain(columns());
    }));

    // At 400 % (320 × 200), what the bars of the app leave a page is 83 px: the columns had no height at all.
    it('keeps the columns a few cards high in a page lower than that, which scrolls to them', fakeAsync(() => {
      resizeScreen(320, 568);
      open([LONG]);
      el.style.display = 'block';
      el.style.height = '83px';

      expect(columns().offsetHeight).toBeGreaterThanOrEqual(256);
    }));

    // There the page itself scrolls, bars and all: the columns are as high as the screen at most, and each scrolls its cards.
    it('on a screen as short as a page zoomed to 400 %, makes the columns as high as the screen at most', fakeAsync(() => {
      resizeScreen(320, 200);
      open(Array.from({ length: 8 }, (_, index) => ticket({ id: index + 1, code: `SOP-0000${index + 1}` })));

      expect(columns().offsetHeight).toBeLessThanOrEqual(200);
      const list = sections()[1].querySelector<HTMLElement>('.cdk-drop-list')!;
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight);
    }));
  });

  // A card was an <article> named by all its text, some 600 letters read out every time the focus
  // reached it, and nothing on the board said how to move a case without dragging it.
  describe('a card, to the keyboard and to who hears it', () => {
    const card = (): HTMLElement => el.querySelector<HTMLElement>('[data-case-id]')!;
    const texts = (ids: string | null): string[] => (ids ?? '').split(' ').map((id) => el.querySelector(`#${id}`)?.textContent?.replace(/\s+/g, ' ').trim() ?? '');

    it('is a button named by its code and its company, described by the rest and by how to move it', fakeAsync(() => {
      open([ticket({ description: 'No imprime desde el lunes' })]);

      expect(card().tagName).toBe('DIV');
      expect(card().getAttribute('role')).toBe('button');
      expect(card().tabIndex).toBe(0);
      expect(texts(card().getAttribute('aria-labelledby'))).toEqual(['SOP-00007', 'Acme']);
      const described = texts(card().getAttribute('aria-describedby'));
      expect(described.join(' ')).toContain('No imprime desde el lunes');
      expect(described.at(-1)).toBe('Arrastra una tarjeta a otra columna, o ábrela con Enter y cambia su Estado.');
      // The hint is on screen too, under the title.
      expect(el.querySelector('#board-hint')!.closest('[hidden], .sr-only')).toBeNull();
    }));

    // What the icons of a card meant was only in their titles: under a mouse that stays on one, never for a keyboard or a finger.
    it('has the legend of its flags behind a "?" beside the hint, which the cards are not described by', fakeAsync(() => {
      open([ticket({ overdue: true, dueAt: '2026-11-06T15:00:00.000Z' })]);
      const legend = el.querySelector<HTMLButtonElement>('app-ticket-flags-legend button')!;

      expect(legend.getAttribute('aria-label')).toBe('Ayuda sobre Indicadores');
      expect(el.querySelector('#board-hint')!.contains(legend)).toBeFalse();
      expect(texts(card().getAttribute('aria-describedby')).join(' ')).not.toContain('Indicadores');
      expect(el.querySelector(`#${legend.getAttribute('aria-describedby')}`)!.textContent).toContain('Olvidado:');
    }));

    // The panel gave the focus back to the card that opened it, which a change of status had made again in another column.
    it('gets the focus back when its panel closes, also once the case moved to another column', fakeAsync(() => {
      open();
      card().focus();
      card().click();
      render();
      http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush(ticket());
      settle();

      // Saved from the panel as resolved: its card is made again, in "Resuelto".
      events.saved(ticket({ status: 'RESOLVED' }));
      settle();
      events.removed(7);
      settle();
      expect(el.querySelector('app-ticket-panel')).toBeNull();
      // Deleted: no card is left, and the focus goes to the search box.
      expect(document.activeElement).toBe(el.querySelector('input[type=search]'));
    }));

    // Read again for every case anyone saved, the board said so each time to a screen reader nobody was using it with.
    it('says the board is being read again when "Actualizar" is pressed, to who does not see the icon that turns; not when someone else changes a case', fakeAsync(() => {
      open();
      tick(STATUS_DELAY_MS);
      render();
      const status = (): string => el.querySelector('app-status')!.textContent!.trim();
      const turning = (): boolean => el.querySelector('button[aria-label="Actualizar"] app-icon svg')!.classList.contains('spin');
      expect(status()).toBe('');

      events.outdated(null);
      render();
      expect(turning()).toBeTrue();
      expect(status()).toBe('');
      answer(read(), [ticket()]);
      settle();

      el.querySelector<HTMLButtonElement>('button[aria-label="Actualizar"]')!.click();
      render();
      expect(turning()).toBeTrue();
      expect(status()).toBe('Actualizando el tablero…');
      answer(read(), [ticket()]);
      settle();
      expect(turning()).toBeFalse();
      expect(status()).toBe('');
    }));

    // It was a status that came with its words, which a screen reader may not read.
    it('says that cases were left out as the notice comes, once: not again when a read made in silence changes its numbers', fakeAsync(() => {
      create();
      // 503 open cases, of which the board shows the latest 500 (one, here).
      const first = read();
      first.open.flush({ items: [ticket()], total: 503, page: 1, pageSize: 500 });
      first.resolved.flush(ticketPage([], 500));
      settle();
      const notice = Array.from(el.querySelectorAll<HTMLElement>('p')).find((p) => p.textContent?.includes('más antiguos'))!;
      const words = 'El tablero muestra solo los 500 casos abiertos más recientes. Faltan 502 más antiguos: búscalos en la lista de Casos.';
      expect(notice.closest('[role=status], [role=alert], [aria-live]')).toBeNull();
      expect(said()).toEqual([words]);

      events.outdated(null);
      render();
      const again = read();
      again.open.flush({ items: [ticket()], total: 504, page: 1, pageSize: 500 });
      again.resolved.flush(ticketPage([], 500));
      settle();
      expect(notice.textContent).toContain('Faltan 503 más antiguos');
      expect(said()).toEqual([words]);
      tick(SAID_MS);
      expect(said()).toEqual([]);
    }));
  });
});
