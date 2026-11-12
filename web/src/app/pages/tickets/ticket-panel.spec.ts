import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { TicketDetail } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { TicketEvents } from '../../core/ticket-events';
import type { TicketEvent } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { TicketPanel } from './ticket-panel';

function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 7,
    code: 'SOP-00007',
    date: '2026-11-05',
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

const OTHER = ticket({ id: 8, code: 'SOP-00008', date: '2026-11-03', company: 'Bodega Sur', description: 'No abre la caja' });

/** The pause after which a date typed or picked is saved. */
const PAUSE = 700;
const REFUSED = { status: 400, statusText: 'Bad Request' };

type TextControl = HTMLInputElement | HTMLTextAreaElement;

// The panel saves every field on its own, so these tests act on the real controls and look at
// the requests that leave and at what the controls show afterwards. Time is the test's own
// (fakeAsync): the pause of the date fields is not waited for, and answers arrive when the test
// sends them.
describe('TicketPanel', () => {
  let http: HttpTestingController;
  let events: TicketEvents;
  let fixture: ComponentFixture<TicketPanel>;
  let el: HTMLElement;
  let closed: number;
  let confirmed: jasmine.Spy<(message?: string) => boolean>;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(TicketEvents);
    // Every question the panel asks is answered "yes" unless a test says otherwise. A real
    // dialog would stop the browser the tests run in.
    confirmed = spyOn(window, 'confirm').and.returnValue(true);
  });

  // Also catches a save nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  const read = (id = 7): TestRequest => http.expectOne({ method: 'GET', url: `/api/tickets/${id}` });
  /** The reads of case 7 that are unanswered, oldest first. */
  const reads = (): TestRequest[] => http.match({ method: 'GET', url: '/api/tickets/7' });
  const patch = (id = 7): TestRequest => http.expectOne({ method: 'PATCH', url: `/api/tickets/${id}` });
  /** The saves that are unanswered, oldest first. */
  const patches = (): TestRequest[] => http.match((request) => request.method === 'PATCH');
  const noPatch = (): void => http.expectNone((request) => request.method === 'PATCH');

  /**
   * A screen update as the browser runs it. ngModel does not write a changed value into its
   * control while Angular goes through the form but right after, before any other event.
   */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  /** Lets time pass. Angular updates the screen after every timer and every answer, so the tests do too. */
  function wait(ms: number): void {
    tick(ms);
    render();
  }

  /** Lets what was answered reach the screen. */
  function settle(): void {
    wait(0);
  }

  /** Creates the panel for a case whose first read is still on its way. `autoReply`: opened to draft the client reply. */
  function create(id: number, autoReply = false): void {
    fixture = TestBed.createComponent(TicketPanel);
    el = fixture.nativeElement as HTMLElement;
    closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    fixture.componentRef.setInput('ticketId', id);
    fixture.componentRef.setInput('autoReply', autoReply);
    render();
  }

  function open(stored = ticket()): void {
    create(stored.id);
    read(stored.id).flush(stored);
    settle();
  }

  /** What `?caso=8` in the address does to an open panel: the same panel gets another case. */
  function moveTo(stored: TicketDetail): void {
    fixture.componentRef.setInput('ticketId', stored.id);
    render();
    read(stored.id).flush(stored);
    settle();
  }

  function find<T extends HTMLElement>(selector: string): T {
    const found = el.querySelector<T>(selector);
    if (!found) throw new Error(`Nothing on screen matches ${selector}`);
    return found;
  }

  function button(text: string, within: HTMLElement = el): HTMLButtonElement {
    const found = Array.from(within.querySelectorAll('button')).find((candidate) => candidate.textContent?.includes(text));
    if (!found) throw new Error(`No "${text}" button on screen`);
    return found;
  }

  /** An event of a control, followed by the screen update Angular runs after every event. */
  function fire(target: HTMLElement, event: string): void {
    target.dispatchEvent(new Event(event));
    render();
  }

  function click(target: HTMLElement): void {
    target.click();
    render();
  }

  /** One step of typing in a date field, or a day picked in its calendar: the browser reports both the same way. */
  function typeDate(input: HTMLInputElement, value: string): void {
    input.value = value;
    fire(input, 'input');
  }

  /** Text typed in a field the person is still in. */
  function type(control: TextControl, text: string): void {
    control.value = text;
    fire(control, 'input');
  }

  /** Text typed in a field that is then left. */
  function write(control: TextControl, text: string): void {
    type(control, text);
    fire(control, 'change');
  }

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    fire(select, 'change');
  }

  function turnPromise(on: boolean): void {
    const toggle = find<HTMLInputElement>('input[role=switch]');
    toggle.checked = on;
    fire(toggle, 'change');
  }

  const caseDate = (): HTMLInputElement => find('#tp-date');
  const promiseDate = (): HTMLInputElement | null => el.querySelector('input[aria-label="Fecha prometida de entrega"]');
  const promiseSwitch = (): HTMLInputElement => find('input[role=switch]');
  const replyBox = (): HTMLTextAreaElement => find('textarea[aria-label="Respuesta para el cliente"]');
  const noteBox = (): HTMLTextAreaElement => find('textarea[aria-label="Nueva observación"]');
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);

  describe('the promise switch', () => {
    it('stays on, with no date yet, when another field is saved and when a live update arrives', fakeAsync(() => {
      open();
      turnPromise(true);
      expect(promiseDate()).not.toBeNull();

      choose(find('#tp-status'), 'UNRESOLVED');
      patch().flush(ticket({ status: 'UNRESOLVED' }));
      settle();
      expect(find<HTMLInputElement>('input[role=switch]').checked).toBeTrue();
      expect(promiseDate()).not.toBeNull();

      events.outdated(7);
      read().flush(ticket({ status: 'UNRESOLVED', company: 'Otra' }));
      settle();
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Otra');
      expect(find<HTMLInputElement>('input[role=switch]').checked).toBeTrue();
      expect(promiseDate()).not.toBeNull();
    }));

    it('saves the promised date once it is chosen, after the pause', fakeAsync(() => {
      open();
      turnPromise(true);
      expect(el.textContent).toContain('Elige la fecha prometida');
      typeDate(promiseDate()!, '2026-12-24');
      wait(PAUSE - 1);
      noPatch();

      wait(1);
      const save = patch();
      expect(save.request.body).toEqual({ promisedDate: '2026-12-24' });
      // The case has no promise until the answer, but a date was chosen.
      expect(el.textContent).not.toContain('Elige la fecha prometida');
      save.flush(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      settle();
      expect(promiseDate()!.value).toBe('2026-12-24');
    }));

    // The case on screen takes the date only once it is stored, so the switch cannot go by the
    // case alone to know there is a promise to remove.
    it('turned off while its date is being stored, removes the promise after it', fakeAsync(() => {
      open();
      turnPromise(true);
      typeDate(promiseDate()!, '2026-12-24');
      wait(PAUSE);
      turnPromise(false);

      const sent = patches();
      expect(sent.map((save) => save.request.body)).toEqual([{ promisedDate: '2026-12-24' }, { promisedDate: null }]);
      sent[0].flush(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      settle();
      sent[1].flush(ticket());
      settle();
      expect(promiseSwitch().checked).toBeFalse();
      expect(promiseDate()).toBeNull();
    }));

    // The date is compared with the last thing sent for the promise, which is its removal: not
    // with the date of the first save, still unanswered, or nothing would be sent.
    it('turned off and on again while its date is being stored, saves the same date when it is chosen again', fakeAsync(() => {
      open();
      turnPromise(true);
      typeDate(promiseDate()!, '2026-12-24');
      wait(PAUSE);
      turnPromise(false);
      turnPromise(true);
      typeDate(promiseDate()!, '2026-12-24');
      wait(PAUSE);

      const sent = patches();
      expect(sent.map((save) => save.request.body)).toEqual([{ promisedDate: '2026-12-24' }, { promisedDate: null }, { promisedDate: '2026-12-24' }]);
      const promised = ticket({ promisedDate: '2026-12-24', promiseState: 'later' });
      for (const stored of [promised, ticket(), promised]) {
        sent.shift()!.flush(stored);
        settle();
      }
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()!.value).toBe('2026-12-24');
    }));

    it('saves the promised date at once when its field is left, and shows the stored one again when it is left empty', fakeAsync(() => {
      open(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      const date = promiseDate()!;
      typeDate(date, '');
      fire(date, 'blur');
      expect(date.value).toBe('2026-12-24');
      noPatch();

      typeDate(date, '2026-12-30');
      fire(date, 'blur');
      const save = patch();
      expect(save.request.body).toEqual({ promisedDate: '2026-12-30' });
      expect(date.value).toBe('2026-12-30');
      save.flush(ticket({ promisedDate: '2026-12-30', promiseState: 'later' }));
      wait(PAUSE);
      expect(date.value).toBe('2026-12-30');
    }));

    // The switch does not take the focus in every browser, so the date field may never be left.
    it('turned off, drops a date that was still waiting: saved later, it would bring the promise back', fakeAsync(() => {
      open();
      turnPromise(true);
      typeDate(promiseDate()!, '2026-12-24');

      turnPromise(false);
      wait(PAUSE);
      noPatch();
      expect(promiseDate()).toBeNull();
    }));

    it('changed and put back to the promised date while the other one is being stored: saves it too and keeps showing it', fakeAsync(() => {
      open(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      const date = promiseDate()!;
      typeDate(date, '2026-12-30');
      wait(PAUSE);
      const first = patch();
      typeDate(date, '2026-12-24');
      wait(PAUSE);
      const second = patch();
      expect(second.request.body).toEqual({ promisedDate: '2026-12-24' });

      first.flush(ticket({ promisedDate: '2026-12-30', promiseState: 'later' }));
      settle();
      expect(date.value).toBe('2026-12-24');
      second.flush(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      settle();
      expect(date.value).toBe('2026-12-24');
    }));

    // Unlike a date, turning it off is a choice: shown at once, and undone when refused.
    it('turned off, goes back on with its date when the server refuses to remove the promise', fakeAsync(() => {
      open(ticket({ promisedDate: '2026-12-24', promiseState: 'later' }));
      turnPromise(false);
      expect(promiseDate()).toBeNull();
      const save = patch();
      expect(save.request.body).toEqual({ promisedDate: null });

      save.flush({ message: 'No se puede quitar la promesa' }, REFUSED);
      settle();
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()!.value).toBe('2026-12-24');
      expect(toasts()).toEqual(['No se puede quitar la promesa']);
    }));
  });

  describe('a choice the server refuses', () => {
    it('goes back to the stored value', fakeAsync(() => {
      open();
      const status = find<HTMLSelectElement>('#tp-status');
      choose(status, 'RESOLVED');
      // Shown before it is stored.
      expect(find('header .badge').textContent).toContain('Resuelto');

      const save = patch();
      expect(save.request.body).toEqual({ status: 'RESOLVED' });
      save.flush({ message: 'No se puede resolver' }, REFUSED);
      settle();

      expect(status.value).toBe('PENDING');
      expect(find('header .badge').textContent).toContain('Pendiente');
      expect(toasts()).toEqual(['No se puede resolver']);
    }));
  });

  describe('a date field', () => {
    // 05/11/2026 corrected to 28/10/2026 by typing 2, 8, 1, 0: the browser reports a complete
    // date after each key. Saved one by one, three wrong dates would be stored on the way.
    it('typed in several steps sends one save, with the last date, after the pause', fakeAsync(() => {
      open();
      const date = caseDate();
      typeDate(date, '2026-11-02');
      wait(300);
      typeDate(date, '2026-11-28');
      wait(300);
      typeDate(date, '2026-01-28');
      wait(300);
      typeDate(date, '2026-10-28');
      wait(PAUSE - 1);
      noPatch();

      wait(1);
      const save = patch();
      expect(save.request.body).toEqual({ date: '2026-10-28' });
      save.flush(ticket({ date: '2026-10-28' }));
      settle();
      expect(date.value).toBe('2026-10-28');

      // Leaving the field afterwards has nothing left to save.
      fire(date, 'blur');
      wait(PAUSE);
      expect(date.value).toBe('2026-10-28');
    }));

    it('left before the pause ends is saved at once, and keeps showing the date typed', fakeAsync(() => {
      open();
      const date = caseDate();
      typeDate(date, '2026-11-02');
      typeDate(date, '2026-11-04');
      fire(date, 'blur');

      const save = patch();
      expect(save.request.body).toEqual({ date: '2026-11-04' });
      expect(date.value).toBe('2026-11-04');

      // The pause that was running is over with it.
      wait(PAUSE);
      noPatch();
      save.flush(ticket({ date: '2026-11-04' }));
      settle();
      expect(date.value).toBe('2026-11-04');
    }));

    it('left empty saves nothing and shows the date of the case again', fakeAsync(() => {
      open();
      const date = caseDate();
      // The browser reports an empty field while a day is half typed.
      typeDate(date, '');
      wait(PAUSE);
      noPatch();
      expect(date.value).toBe('');

      fire(date, 'blur');
      wait(PAUSE);
      expect(date.value).toBe('2026-11-05');
    }));

    it('holding a year still being typed saves nothing and shows the date of the case again', fakeAsync(() => {
      open();
      const date = caseDate();
      for (const year of ['0002', '0020', '0202']) {
        typeDate(date, `${year}-11-05`);
        wait(PAUSE);
      }
      noPatch();

      fire(date, 'blur');
      wait(PAUSE);
      expect(date.value).toBe('2026-11-05');
    }));

    it('saves nothing when a date that was waiting is cleared, or typed back to the one the case has', fakeAsync(() => {
      open();
      const date = caseDate();
      typeDate(date, '2026-11-02');
      typeDate(date, '');
      wait(PAUSE);
      noPatch();

      typeDate(date, '2026-11-02');
      typeDate(date, '2026-11-05');
      wait(PAUSE);
      noPatch();
    }));

    describe('holding a date the server refuses', () => {
      function refuse(save: TestRequest): void {
        save.flush({ message: 'La fecha del caso no puede ser posterior a hoy' }, REFUSED);
        settle();
      }

      // 05/11/2026 corrected to 28/10/2026 with a pause between the day and the month. The 28th
      // of November is saved on its own, and refused, while the person is about to type the
      // month. Put back to the 5th at that moment, the field would take "10" over it and the
      // 5th of October, a date nobody typed, would be saved.
      it('is left alone while the person is in it, so that what they type next completes the date they meant', fakeAsync(() => {
        open();
        const date = caseDate();
        fire(date, 'focus');
        typeDate(date, '2026-11-02');
        wait(100);
        typeDate(date, '2026-11-28');
        wait(PAUSE);
        const first = patch();
        expect(first.request.body).toEqual({ date: '2026-11-28' });
        refuse(first);
        expect(date.value).toBe('2026-11-28');
        expect(toasts()).toEqual(['La fecha del caso no puede ser posterior a hoy']);

        typeDate(date, '2026-01-28');
        wait(100);
        typeDate(date, '2026-10-28');
        wait(PAUSE);
        const second = patch();
        expect(second.request.body).toEqual({ date: '2026-10-28' });
        second.flush(ticket({ date: '2026-10-28' }));
        settle();
        fire(date, 'blur');
        expect(date.value).toBe('2026-10-28');
      }));

      it('shows the date the case has once the person leaves it, and is not sent again', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2099-01-01');
        wait(PAUSE);
        refuse(patch());
        expect(date.value).toBe('2099-01-01');
        wait(PAUSE);
        noPatch();

        fire(date, 'blur');
        expect(date.value).toBe('2026-11-05');
        wait(PAUSE);
        noPatch();
      }));

      it('goes back to the date the case has when the refusal arrives after the field was left, not before', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2099-01-01');
        fire(date, 'blur');
        const save = patch();
        // Accepted, the field would have shown the old date for a moment and then this one.
        expect(date.value).toBe('2099-01-01');

        refuse(save);
        expect(date.value).toBe('2026-11-05');
        expect(toasts()).toEqual(['La fecha del caso no puede ser posterior a hoy']);
      }));

      it('is left alone when the person went back into it before the refusal, until they leave it again', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2099-01-01');
        fire(date, 'blur');
        const save = patch();
        fire(date, 'focus');

        refuse(save);
        expect(date.value).toBe('2099-01-01');
        fire(date, 'blur');
        expect(date.value).toBe('2026-11-05');
      }));
    });

    describe('changed again while an earlier date is being stored', () => {
      it('keeps the new date when the earlier save is answered, and saves it after its own pause', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2026-11-28');
        wait(PAUSE);
        const first = patch();
        typeDate(date, '2026-10-28');

        first.flush(ticket({ date: '2026-11-28' }));
        settle();
        expect(date.value).toBe('2026-10-28');

        wait(PAUSE);
        const second = patch();
        expect(second.request.body).toEqual({ date: '2026-10-28' });
        second.flush(ticket({ date: '2026-10-28' }));
        settle();
        expect(date.value).toBe('2026-10-28');
      }));

      // Compared with the date of the case alone, the 5th would look like nothing to save, and
      // the case would end on the 28th with the field showing the 5th.
      it('back to the date the case has: saves that one too, and keeps showing it whatever is answered first', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2026-11-28');
        wait(PAUSE);
        const first = patch();
        typeDate(date, '2026-11-05');
        wait(PAUSE);
        const second = patch();
        expect(second.request.body).toEqual({ date: '2026-11-05' });

        first.flush(ticket({ date: '2026-11-28' }));
        settle();
        expect(date.value).toBe('2026-11-05');
        second.flush(ticket());
        settle();
        expect(date.value).toBe('2026-11-05');
      }));

      it('left with both saves unanswered: shows the date of the case only after the last answer', fakeAsync(() => {
        open();
        const date = caseDate();
        typeDate(date, '2026-11-28');
        wait(PAUSE);
        typeDate(date, '2099-01-01');
        fire(date, 'blur');
        const [first, second] = patches();

        first.flush(ticket({ date: '2026-11-28' }));
        settle();
        expect(date.value).toBe('2099-01-01');
        second.flush({ message: 'La fecha del caso no puede ser posterior a hoy' }, REFUSED);
        settle();
        expect(date.value).toBe('2026-11-28');
      }));
    });

    it('keeps a date being typed when a live update brings another date for the case, and saves it', fakeAsync(() => {
      open();
      const date = caseDate();
      typeDate(date, '2026-10-28');
      events.outdated(7);
      read().flush(ticket({ date: '2026-11-01' }));
      settle();
      expect(date.value).toBe('2026-10-28');

      wait(PAUSE);
      const save = patch();
      expect(save.request.body).toEqual({ date: '2026-10-28' });
      save.flush(ticket({ date: '2026-10-28' }));
      settle();
      expect(date.value).toBe('2026-10-28');
    }));

    // Escape, or a click outside, closes the panel without the field ever being left.
    it('still waiting when the panel is closed is saved, and the other screens learn of it', fakeAsync(() => {
      open();
      const seen: TicketEvent[] = [];
      events.events.subscribe((event) => seen.push(event));
      typeDate(caseDate(), '2026-10-28');

      fixture.destroy();
      const save = patch();
      expect(save.request.body).toEqual({ date: '2026-10-28' });

      const stored = ticket({ date: '2026-10-28' });
      save.flush(stored);
      // No screen is left to update.
      tick(PAUSE);
      expect(seen).toEqual([{ kind: 'saved', ticket: stored, created: false }]);
    }));

    it('still waiting when the panel moves on to another case is saved to the case it was typed for', fakeAsync(() => {
      open();
      typeDate(caseDate(), '2026-10-28');

      fixture.componentRef.setInput('ticketId', OTHER.id);
      render();
      const save = patch(7);
      expect(save.request.body).toEqual({ date: '2026-10-28' });
      read(OTHER.id).flush(OTHER);
      settle();

      // Refused, even: nothing of the case now on screen is touched.
      save.flush({ message: 'La fecha del caso no puede ser posterior a hoy' }, REFUSED);
      settle();
      wait(PAUSE);
      expect(find('header').textContent).toContain('SOP-00008');
      expect(caseDate().value).toBe('2026-11-03');
    }));
  });

  describe('a text field', () => {
    const fields = [
      { name: 'Empresa', control: '#tp-company', hint: 'tp-company-unsaved', field: 'company', stored: 'Acme', typed: 'Acme del Sur' },
      { name: 'Descripción', control: '#tp-description', hint: 'tp-description-unsaved', field: 'description', stored: 'No imprime', typed: 'No imprime desde el lunes' },
      {
        name: 'Respuesta para el cliente',
        control: 'textarea[aria-label="Respuesta para el cliente"]',
        hint: 'tp-reply-unsaved',
        field: 'customerReply',
        stored: '',
        typed: 'Ya puede imprimir.',
      },
    ] as const;

    for (const { name, control, hint, field, stored, typed } of fields) {
      it(`${name}: keeps what was typed when the save fails, says so, and sends it again with "Reintentar"`, fakeAsync(() => {
        open();
        const box = find<TextControl>(control);
        write(box, `  ${typed} `);
        const first = patch();
        expect(first.request.body).toEqual({ [field]: typed });
        // No connection.
        first.error(new ProgressEvent('error'));
        settle();

        expect(box.value).toBe(`  ${typed} `);
        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(box.getAttribute('aria-describedby')).toBe(hint);
        expect(find(`#${hint}`).textContent).toContain('No se guardó');
        expect(el.querySelector(`#${hint} i.mdi-alert-circle-outline`)).not.toBeNull();
        expect(toasts()).toEqual(['No hay conexión con el servidor']);

        // Neither a refused choice nor a live update of the rest of the case takes the text away.
        choose(find('#tp-status'), 'RESOLVED');
        patch().flush({ message: 'No se puede resolver' }, REFUSED);
        settle();
        events.outdated(7);
        read().flush(ticket({ priority: 'HIGH' }));
        settle();
        expect(box.value).toBe(`  ${typed} `);
        expect(box.getAttribute('aria-invalid')).toBe('true');

        click(button('Reintentar', find(`#${hint}`)));
        const second = patch();
        expect(second.request.body).toEqual({ [field]: typed });
        second.flush({ message: 'Bad Gateway' }, { status: 502, statusText: 'Bad Gateway' });
        settle();
        expect(box.value).toBe(`  ${typed} `);
        expect(box.getAttribute('aria-invalid')).toBe('true');

        click(button('Reintentar', find(`#${hint}`)));
        patch().flush(ticket({ priority: 'HIGH', [field]: typed }));
        settle();
        expect(box.value).toBe(typed);
        expect(box.hasAttribute('aria-invalid')).toBeFalse();
        expect(box.hasAttribute('aria-describedby')).toBeFalse();
        expect(el.querySelector(`#${hint}`)).toBeNull();
      }));

      it(`${name}: "Descartar" puts back the text the case has`, fakeAsync(() => {
        open();
        const box = find<TextControl>(control);
        write(box, typed);
        patch().flush({ message: 'No se pudo guardar' }, { status: 500, statusText: 'Server Error' });
        settle();
        expect(box.value).toBe(typed);

        click(button('Descartar', find(`#${hint}`)));
        expect(box.value).toBe(stored);
        expect(box.hasAttribute('aria-invalid')).toBeFalse();
        expect(el.querySelector(`#${hint}`)).toBeNull();
      }));

      // The text is nowhere but in the field. Someone else writing in that field of the case
      // must not take it away; it is the person's to send again or to give up.
      it(`${name}: marked as not saved, keeps its text and its mark when a live update changes that same field`, fakeAsync(() => {
        open();
        const box = find<TextControl>(control);
        write(box, typed);
        patch().error(new ProgressEvent('error'));
        settle();

        events.outdated(7);
        read().flush(ticket({ [field]: 'Escrito por otra persona' }));
        settle();
        expect(box.value).toBe(typed);
        expect(box.getAttribute('aria-invalid')).toBe('true');
        expect(el.querySelector(`#${hint}`)).not.toBeNull();

        // "Descartar" shows the text the case has now.
        click(button('Descartar', find(`#${hint}`)));
        expect(box.value).toBe('Escrito por otra persona');
        expect(el.querySelector(`#${hint}`)).toBeNull();
      }));

      // Compared with the stored text alone, the old text would look like nothing to save, and
      // the case would keep the text the person undid.
      it(`${name}: put back to the text the case has while another text is being stored, that is saved too and stays in the field`, fakeAsync(() => {
        open();
        const box = find<TextControl>(control);
        write(box, typed);
        const first = patch();
        write(box, stored);
        const second = patch();
        // The reply is the one that can be left empty.
        expect(second.request.body).toEqual({ [field]: stored || null });

        first.flush(ticket({ [field]: typed }));
        settle();
        expect(box.value).toBe(stored);
        second.flush(ticket());
        settle();
        expect(box.value).toBe(stored);
        expect(box.hasAttribute('aria-invalid')).toBeFalse();
      }));

      // Pressing a button takes the focus from the field first, and a field left with another
      // text is saved right then, before the click arrives. "Descartar" then gave up a text that
      // was being stored, which came back with the answer, and "Reintentar" sent it twice.
      it(`${name}: marked as not saved and edited, has its two buttons disabled until that save is answered, and neither does anything then`, fakeAsync(() => {
        open();
        const box = find<TextControl>(control);
        write(box, typed);
        patch().error(new ProgressEvent('error'));
        settle();
        const mark = find(`#${hint}`);
        expect(button('Reintentar', mark).disabled).toBeFalse();
        expect(button('Descartar', mark).disabled).toBeFalse();

        const edited = `${typed} Gracias.`;
        write(box, edited);
        const save = patch();
        expect(save.request.body).toEqual({ [field]: edited });
        expect(button('Reintentar', mark).disabled).toBeTrue();
        expect(button('Descartar', mark).disabled).toBeTrue();

        // A click that reaches them all the same, with yet another text in the field by then.
        const longer = `${edited} Saludos.`;
        type(box, longer);
        fire(button('Descartar', mark), 'click');
        expect(box.value).toBe(longer);
        expect(el.querySelector(`#${hint}`)).not.toBeNull();
        fire(button('Reintentar', mark), 'click');
        noPatch();

        save.flush(ticket({ [field]: edited }));
        settle();
        expect(box.value).toBe(longer);
        expect(el.querySelector(`#${hint}`)).toBeNull();
      }));
    }

    describe('written in again while its save is unanswered', () => {
      it('keeps the new text when the save is answered, and saves it when the field is left', fakeAsync(() => {
        open();
        const box = find<TextControl>('#tp-description');
        write(box, 'Uno');
        const first = patch();
        // Back in the field, typing on.
        type(box, 'Uno dos');

        first.flush(ticket({ description: 'Uno' }));
        settle();
        expect(box.value).toBe('Uno dos');
        expect(box.hasAttribute('aria-invalid')).toBeFalse();

        fire(box, 'change');
        const second = patch();
        expect(second.request.body).toEqual({ description: 'Uno dos' });
        second.flush(ticket({ description: 'Uno dos' }));
        settle();
        expect(box.value).toBe('Uno dos');
      }));

      // Empresa is saved with Enter too, with the cursor still in the field.
      it('keeps the new text, marked as not saved, when the save fails: it is sent when the field is left', fakeAsync(() => {
        open();
        const box = find<HTMLInputElement>('#tp-company');
        write(box, 'Acme del');
        const first = patch();
        type(box, 'Acme del Sur');

        first.error(new ProgressEvent('error'));
        settle();
        expect(box.value).toBe('Acme del Sur');
        expect(el.querySelector('#tp-company-unsaved')).not.toBeNull();
        expect(toasts()).toEqual(['No hay conexión con el servidor']);

        fire(box, 'change');
        const second = patch();
        expect(second.request.body).toEqual({ company: 'Acme del Sur' });
        second.flush(ticket({ company: 'Acme del Sur' }));
        settle();
        expect(box.value).toBe('Acme del Sur');
        expect(el.querySelector('#tp-company-unsaved')).toBeNull();
      }));

      // Leaving a field whose text did not change sends nothing: without the mark nothing would
      // tell the person that the text on screen is not the text of the case.
      it('gone back to the text whose save failed: the field says it is not saved and "Reintentar" sends it', fakeAsync(() => {
        open();
        const box = find<HTMLInputElement>('#tp-company');
        write(box, 'Acme del');
        const first = patch();
        type(box, 'Acme del Sur');
        first.error(new ProgressEvent('error'));
        settle();

        type(box, 'Acme del');
        fire(box, 'blur');
        noPatch();
        expect(box.getAttribute('aria-invalid')).toBe('true');

        click(button('Reintentar', find('#tp-company-unsaved')));
        const second = patch();
        expect(second.request.body).toEqual({ company: 'Acme del' });
        second.flush(ticket({ company: 'Acme del' }));
        settle();
        expect(box.value).toBe('Acme del');
        expect(el.querySelector('#tp-company-unsaved')).toBeNull();
      }));

      // Only a space, or a new line, was added when the answer arrives: that is already the
      // person writing on, and the next word must not be glued to the last one.
      it('keeps a space typed after the text that is being saved', fakeAsync(() => {
        open();
        const company = find<HTMLInputElement>('#tp-company');
        write(company, 'Acme del');
        const first = patch();
        type(company, 'Acme del ');
        first.flush(ticket({ company: 'Acme del' }));
        settle();
        expect(company.value).toBe('Acme del ');

        const description = find<TextControl>('#tp-description');
        write(description, 'Uno');
        const second = patch();
        type(description, 'Uno\n');
        second.flush(ticket({ company: 'Acme del', description: 'Uno' }));
        settle();
        expect(description.value).toBe('Uno\n');
      }));

      it('put back to the text the case has, and that second save fails: keeps it, marked, while the case has the other text', fakeAsync(() => {
        open();
        const box = find<TextControl>('#tp-description');
        write(box, 'Otra cosa');
        write(box, 'No imprime');
        const [first, second] = patches();

        first.flush(ticket({ description: 'Otra cosa' }));
        settle();
        second.error(new ProgressEvent('error'));
        settle();
        expect(box.value).toBe('No imprime');
        expect(box.getAttribute('aria-invalid')).toBe('true');

        click(button('Descartar', find('#tp-description-unsaved')));
        expect(box.value).toBe('Otra cosa');
      }));

      it('left again with the text that is being saved: sends nothing more, and is not given the old text back', fakeAsync(() => {
        open();
        const box = find<TextControl>('#tp-description');
        write(box, 'Otra cosa');
        const save = patch();
        write(box, ' Otra cosa ');
        fire(box, 'blur');
        noPatch();
        expect(box.value).toBe(' Otra cosa ');

        save.flush(ticket({ description: 'Otra cosa' }));
        settle();
        expect(box.value).toBe('Otra cosa');
      }));

      it('left empty: shows the stored text, and then the one that was being saved once it is stored', fakeAsync(() => {
        open();
        const box = find<TextControl>('#tp-description');
        write(box, 'Otra cosa');
        const save = patch();
        write(box, '  ');
        noPatch();
        expect(box.value).toBe('No imprime');

        save.flush(ticket({ description: 'Otra cosa' }));
        settle();
        expect(box.value).toBe('Otra cosa');
      }));

      it('twice, the first save stored and the second failed: keeps the last text, marked', fakeAsync(() => {
        open();
        const box = find<TextControl>('#tp-description');
        write(box, 'A');
        write(box, 'A B');
        const [first, second] = patches();
        expect(second.request.body).toEqual({ description: 'A B' });

        first.flush(ticket({ description: 'A' }));
        settle();
        expect(box.value).toBe('A B');
        second.error(new ProgressEvent('error'));
        settle();
        expect(box.value).toBe('A B');
        expect(box.getAttribute('aria-invalid')).toBe('true');
      }));
    });

    it('Respuesta para el cliente: once discarded, there is nothing left to copy', fakeAsync(() => {
      open();
      write(replyBox(), 'Ya puede imprimir.');
      patch().error(new ProgressEvent('error'));
      settle();
      expect(button('Copiar').disabled).toBeFalse();

      click(button('Descartar', find('#tp-reply-unsaved')));
      expect(button('Copiar').disabled).toBeTrue();
    }));

    it('shows the text as the server stored it once the save is answered', fakeAsync(() => {
      open();
      const company = find<HTMLInputElement>('#tp-company');
      write(company, ' Acme del Sur ');
      patch().flush(ticket({ company: 'Acme del Sur' }));
      settle();

      expect(company.value).toBe('Acme del Sur');
      expect(company.hasAttribute('aria-invalid')).toBeFalse();
    }));

    it('left empty, or with only the spaces around it changed, saves nothing and shows the stored text', fakeAsync(() => {
      open();
      const company = find<HTMLInputElement>('#tp-company');
      write(company, '   ');
      expect(company.value).toBe('Acme');

      write(company, ' Acme ');
      expect(company.value).toBe('Acme');
      noPatch();
    }));

    it('is no longer marked once the panel shows another case', fakeAsync(() => {
      open();
      write(find<TextControl>('#tp-description'), 'No imprime desde el lunes');
      patch().error(new ProgressEvent('error'));
      settle();
      expect(el.querySelector('#tp-description-unsaved')).not.toBeNull();

      moveTo(OTHER);
      expect(find<TextControl>('#tp-description').value).toBe('No abre la caja');
      expect(find('#tp-description').hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();
    }));

    // The save was stored and only its answer got lost, or someone else wrote the same.
    it('is no longer marked once the case arrives with that very text: nothing is left to save', fakeAsync(() => {
      open();
      const box = find<TextControl>('#tp-description');
      write(box, 'No imprime desde el lunes');
      patch().error(new ProgressEvent('error'));
      settle();
      expect(el.querySelector('#tp-description-unsaved')).not.toBeNull();

      events.outdated(7);
      read().flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      expect(box.value).toBe('No imprime desde el lunes');
      expect(box.hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();
    }));

    it('Respuesta para el cliente: marked as not saved, gives way to the message the AI writes when the button asks for one', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      open();
      write(replyBox(), 'Ya puede imprimir.');
      patch().error(new ProgressEvent('error'));
      settle();
      expect(el.querySelector('#tp-reply-unsaved')).not.toBeNull();

      click(button('Generar con IA'));
      http.expectOne({ method: 'POST', url: '/api/ai/reply/7' }).flush(ticket({ customerReply: 'Estimado cliente: ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Estimado cliente: ya puede imprimir.');
      expect(el.querySelector('#tp-reply-unsaved')).toBeNull();
    }));

    // Resolving the case drafts the message by itself. The person may be writing their own
    // meanwhile: nobody asked for the draft to take its place.
    it('Respuesta para el cliente: what the person is writing stays when the AI drafts a message on its own', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      open();
      choose(find('#tp-status'), 'RESOLVED');
      patch().flush(ticket({ status: 'RESOLVED' }));
      settle();
      const draft = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      type(replyBox(), 'Ya puede imprimir.');

      draft.flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya puede imprimir.');

      // Left, it is saved like any text typed over the stored one.
      fire(replyBox(), 'change');
      const save = patch();
      expect(save.request.body).toEqual({ customerReply: 'Ya puede imprimir.' });
      save.flush(ticket({ status: 'RESOLVED', customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya puede imprimir.');
    }));

    // The limits of the server. Without them a long paste is refused only after it was typed.
    it('cannot be given more text, or more minutes, than the server stores', fakeAsync(() => {
      open();
      expect(find<HTMLInputElement>('#tp-company').maxLength).toBe(200);
      expect(find<HTMLTextAreaElement>('#tp-description').maxLength).toBe(5000);
      expect(replyBox().maxLength).toBe(5000);
      expect(find<HTMLTextAreaElement>('textarea[aria-label="Nueva observación"]').maxLength).toBe(5000);
      expect(find<HTMLInputElement>('#tp-estimated').max).toBe('1000000');
      expect(find<HTMLInputElement>('#tp-spent').max).toBe('1000000');
    }));
  });

  describe('the "No se guardó." hint of a text field', () => {
    /** Opens the case and leaves its description with a text whose save failed. */
    function failed(): HTMLTextAreaElement {
      open();
      const box = find<HTMLTextAreaElement>('#tp-description');
      write(box, 'X');
      patch().error(new ProgressEvent('error'));
      settle();
      return box;
    }

    it('goes away when a later save of the field is stored, also if the person wrote on meanwhile', fakeAsync(() => {
      const box = failed();
      write(box, 'X Y');
      const save = patch();
      type(box, 'X Y Z');

      save.flush(ticket({ description: 'X Y' }));
      settle();
      // What they are writing is not a save that failed: it is sent when they leave the field.
      expect(box.value).toBe('X Y Z');
      expect(box.hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();

      fire(box, 'change');
      const next = patch();
      expect(next.request.body).toEqual({ description: 'X Y Z' });
      next.flush(ticket({ description: 'X Y Z' }));
      settle();
      expect(box.value).toBe('X Y Z');
    }));

    it('stays, with its buttons back, when a later save of the field fails too', fakeAsync(() => {
      const box = failed();
      write(box, 'X Y');
      patch().flush({ message: 'No se pudo guardar' }, { status: 500, statusText: 'Server Error' });
      settle();
      const hint = find('#tp-description-unsaved');
      expect(button('Reintentar', hint).disabled).toBeFalse();
      expect(button('Descartar', hint).disabled).toBeFalse();

      click(button('Reintentar', hint));
      const retry = patch();
      expect(retry.request.body).toEqual({ description: 'X Y' });
      expect(button('Reintentar', hint).disabled).toBeTrue();
      retry.error(new ProgressEvent('error'));
      settle();

      click(button('Descartar', hint));
      expect(box.value).toBe('No imprime');
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();
    }));

    // It was 12 px text in the danger colour, under 4:1 against the panel in the light theme.
    it('is written in the colour of the text around it, with the danger colour only in its icon and in the border of the field', fakeAsync(() => {
      const box = failed();
      const hint = find('#tp-description-unsaved');
      const danger = 'rgb(229, 72, 77)';
      // The field is written in the ink colour.
      const ink = getComputedStyle(box).color;
      expect(ink).not.toBe(danger);

      const style = getComputedStyle(hint);
      expect(style.color).toBe(ink);
      expect(style.fontSize).toBe('12px');
      // A tint, as in the other notices.
      expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(find(`#${hint.id} i.mdi-alert-circle-outline[aria-hidden=true]`)).color).toBe(danger);
      expect(getComputedStyle(box).borderTopColor).toBe(danger);

      // Says the same, with the same two buttons, which still look like something to press.
      expect(find(`#${hint.id} span`).textContent?.trim()).toBe('No se guardó.');
      expect(Array.from(hint.querySelectorAll('button')).map((each) => each.textContent?.trim())).toEqual(['Reintentar', 'Descartar']);
      expect(hint.tagName).toBe('P');
      expect(hint.hasAttribute('role')).toBeFalse();
      for (const name of ['Reintentar', 'Descartar']) {
        const look = getComputedStyle(button(name, hint));
        expect(look.color).toBe(ink);
        expect(look.textDecorationLine).toBe('underline');
        expect(look.cursor).toBe('pointer');
      }
    }));
  });

  describe('a note', () => {
    it('that could not be added goes back into its box, to be sent again', fakeAsync(() => {
      open();
      type(noteBox(), ' Se llamó al cliente ');
      click(button('Agregar'));
      const add = http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' });
      expect(add.request.body).toEqual({ text: 'Se llamó al cliente' });
      expect(noteBox().value).toBe('');

      add.error(new ProgressEvent('error'));
      settle();
      expect(noteBox().value).toBe('Se llamó al cliente');
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
    }));
  });

  // `?caso=8` gives an open panel another case while requests of the first one are unanswered.
  describe('an answer that arrives after the panel moved on to another case', () => {
    it('of the first read: is not shown', fakeAsync(() => {
      create(7);
      const left = read(7);
      moveTo(OTHER);

      left.flush(ticket());
      settle();
      expect(find('header').textContent).toContain('SOP-00008');
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Bodega Sur');
    }));

    it('of the first read, failed: does not close the panel', fakeAsync(() => {
      create(7);
      const left = read(7);
      moveTo(OTHER);

      left.flush({ message: 'Caso no encontrado' }, { status: 404, statusText: 'Not Found' });
      settle();
      expect(closed).toBe(0);
      expect(toasts()).toEqual([]);
    }));

    it('of a refused choice: does not put back the case on screen, where another change is being saved', fakeAsync(() => {
      open();
      choose(find('#tp-status'), 'RESOLVED');
      const left = patch(7);
      moveTo(OTHER);

      const priority = find<HTMLSelectElement>('#tp-priority');
      choose(priority, 'HIGH');
      left.flush({ message: 'No se puede resolver' }, REFUSED);
      settle();
      expect(priority.value).toBe('HIGH');

      patch(OTHER.id).flush({ ...OTHER, priority: 'HIGH' });
      settle();
      expect(priority.value).toBe('HIGH');
    }));

    it('of a failed text save: does not mark the field of the case on screen', fakeAsync(() => {
      open();
      write(find<TextControl>('#tp-description'), 'No imprime desde el lunes');
      const left = patch(7);
      moveTo(OTHER);

      left.error(new ProgressEvent('error'));
      settle();
      expect(find('#tp-description').hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();
      expect(find<TextControl>('#tp-description').value).toBe('No abre la caja');
    }));

    // The panel can be back on the case it left by the time the answer arrives. Its fields were
    // made again from the stored case: the text that failed is not in them.
    it('of a failed text save, with the panel back on the case it had left: does not mark the field', fakeAsync(() => {
      open();
      write(find<TextControl>('#tp-description'), 'No imprime desde el lunes');
      const left = patch(7);
      moveTo(OTHER);
      moveTo(ticket());

      left.error(new ProgressEvent('error'));
      settle();
      expect(find<TextControl>('#tp-description').value).toBe('No imprime');
      expect(find('#tp-description').hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-description-unsaved')).toBeNull();

      // Nor does it count as a save of the field made again: its buttons, were it marked, would work.
      write(find<TextControl>('#tp-description'), 'Otra cosa');
      patch(7).error(new ProgressEvent('error'));
      settle();
      expect(button('Reintentar', find('#tp-description-unsaved')).disabled).toBeFalse();
    }));

    it('of a note that could not be added: its text does not land in the note box of the case on screen', fakeAsync(() => {
      open();
      type(noteBox(), 'Se llamó al cliente');
      click(button('Agregar'));
      const left = http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' });
      moveTo(OTHER);

      left.error(new ProgressEvent('error'));
      settle();
      expect(noteBox().value).toBe('');
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
    }));

    it('of a case that was resolved: drafts the client reply for that case, not for the one on screen', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      open();
      choose(find('#tp-status'), 'RESOLVED');
      const left = patch(7);
      moveTo(OTHER);

      left.flush(ticket({ status: 'RESOLVED' }));
      settle();
      const draft = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      // The case on screen is not the one being written for.
      expect(button('Generar con IA').disabled).toBeFalse();

      draft.flush(ticket({ status: 'RESOLVED', customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('');
    }));

    it('of an AI reply: the case on screen does not look busy meanwhile, and its own reply is not cut short', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      open();
      click(button('Generar con IA'));
      const left = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      expect(button('Redactando').disabled).toBeTrue();

      moveTo(OTHER);
      expect(button('Generar con IA').disabled).toBeFalse();
      click(button('Generar con IA'));
      const own = http.expectOne({ method: 'POST', url: `/api/ai/reply/${OTHER.id}` });

      left.flush(ticket({ customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('');
      expect(button('Redactando').disabled).toBeTrue();

      own.flush({ ...OTHER, customerReply: 'Ya abre la caja.' });
      settle();
      expect(replyBox().value).toBe('Ya abre la caja.');
      expect(button('Volver a generar').disabled).toBeFalse();
    }));

    it('of an AI reply asked for with the button: does not take the place of what the reply box of the case on screen holds', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      open();
      click(button('Generar con IA'));
      const left = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      moveTo(OTHER);
      write(replyBox(), 'Ya abre la caja.');
      patch(OTHER.id).error(new ProgressEvent('error'));
      settle();

      left.flush(ticket({ customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya abre la caja.');
      expect(el.querySelector('#tp-reply-unsaved')).not.toBeNull();
      expect(button('Copiar').disabled).toBeFalse();
    }));
  });

  // The first read is one more read: numbered with the re-reads, and compared with the saves.
  describe('the first read of the case', () => {
    it('answered after a save of that case was shown: does not undo it, and the case is read again', fakeAsync(() => {
      create(7);
      const first = read();
      events.saved(ticket({ priority: 'HIGH' }));
      render();
      const priority = find<HTMLSelectElement>('#tp-priority');
      expect(priority.value).toBe('HIGH');

      first.flush(ticket());
      settle();
      expect(priority.value).toBe('HIGH');

      read().flush(ticket({ priority: 'HIGH', company: 'Acme del Sur' }));
      settle();
      expect(priority.value).toBe('HIGH');
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Acme del Sur');
    }));

    it('answered after a newer read was shown: is dropped', fakeAsync(() => {
      create(7);
      events.outdated(7);
      const [first, newer] = reads();

      newer.flush(ticket({ company: 'Nueva' }));
      settle();
      first.flush(ticket({ company: 'Vieja' }));
      settle();
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Nueva');
    }));

    // What the first read is there for is done by whichever read shows the case first.
    it('replaced by a newer read: that one drafts the reply the panel was opened for, once', fakeAsync(() => {
      TestBed.inject(Catalogs).aiReady.set(true);
      create(7, true);
      events.outdated(7);
      const [first, newer] = reads();

      newer.flush(ticket({ status: 'RESOLVED' }));
      settle();
      const draft = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      first.flush(ticket({ status: 'RESOLVED' }));
      settle();

      // The AI could not write it. Reading the case again later does not ask a second time.
      draft.flush({ message: 'El proveedor de IA no respondió' }, { status: 502, statusText: 'Bad Gateway' });
      settle();
      events.outdated(7);
      read().flush(ticket({ status: 'RESOLVED' }));
      settle();
      http.expectNone({ method: 'POST', url: '/api/ai/reply/7' });
      expect(toasts()).toEqual(['El proveedor de IA no respondió']);
    }));

    it('replaced by a newer read that fails: the panel closes, as there is no case to show', fakeAsync(() => {
      create(7);
      events.outdated(7);
      const [first, newer] = reads();

      newer.flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      settle();
      expect(closed).toBe(1);
      expect(toasts()).toEqual(['Error interno']);

      first.flush(ticket());
      settle();
      expect(closed).toBe(1);
    }));

    it('failed: closes the panel, whatever the failure', fakeAsync(() => {
      create(7);
      read().error(new ProgressEvent('error'));
      settle();
      expect(closed).toBe(1);
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
    }));
  });

  describe('a re-read after someone else changed the case', () => {
    const note = { id: 1, text: 'Se llamó al cliente', authorName: 'Ana', createdAt: '2026-11-06T09:00:00.000Z' };

    it('that fails leaves the panel open with the case it shows', fakeAsync(() => {
      open();
      events.outdated(7);
      read().error(new ProgressEvent('error'));
      settle();
      expect(closed).toBe(0);
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Acme');
    }));

    // The read may have been taken before the save was stored. Shown, it would undo the save on
    // screen; dropped, the note that asked for the read would be lost.
    it('does not replace a save answered while it was on its way, and is asked for again', fakeAsync(() => {
      open();
      events.outdated(7);
      const stale = read();

      const priority = find<HTMLSelectElement>('#tp-priority');
      choose(priority, 'HIGH');
      patch().flush(ticket({ priority: 'HIGH' }));
      settle();

      stale.flush(ticket({ notes: [note], notesCount: 1 }));
      settle();
      expect(priority.value).toBe('HIGH');

      read().flush(ticket({ priority: 'HIGH', notes: [note], notesCount: 1 }));
      settle();
      expect(priority.value).toBe('HIGH');
      expect(el.textContent).toContain('Se llamó al cliente');

      // The stored case is the newest one too: a refused change goes back to it.
      choose(priority, 'LOW');
      patch().flush({ message: 'No se puede cambiar' }, REFUSED);
      settle();
      expect(priority.value).toBe('HIGH');
    }));

    it('is dropped when a newer one was asked for and answered first', fakeAsync(() => {
      open();
      events.outdated(7);
      const older = read();
      events.outdated(7);
      const newer = read();

      newer.flush(ticket({ company: 'Nueva' }));
      settle();
      older.flush(ticket({ company: 'Vieja' }));
      settle();
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Nueva');
    }));

    it('that finds the case deleted closes the panel, unless the panel shows another case by then', fakeAsync(() => {
      open();
      events.outdated(7);
      const left = read(7);
      moveTo(OTHER);
      left.flush({ message: 'Caso no encontrado' }, { status: 404, statusText: 'Not Found' });
      settle();
      expect(closed).toBe(0);
      expect(toasts()).toEqual([]);

      events.outdated(OTHER.id);
      read(OTHER.id).flush({ message: 'Caso no encontrado' }, { status: 404, statusText: 'Not Found' });
      settle();
      expect(closed).toBe(1);
      expect(toasts()).toEqual(['Este caso fue eliminado desde otra sesión']);
    }));
  });

  describe('the time of the case', () => {
    const caseTime = (): HTMLInputElement => find('#tp-time');
    const clearButton = (): HTMLButtonElement | null => el.querySelector('button[aria-label="Quitar la hora del caso"]');

    it('is empty, with nothing to remove, on a case that only has its date', fakeAsync(() => {
      open();

      expect(caseTime().value).toBe('');
      expect(caseTime().type).toBe('time');
      expect(clearButton()).toBeNull();
    }));

    // "14:35" sorts before "1900-01-01": the guard against a year still being typed must not reach it.
    it('is saved after the pause, once, with the last time typed', fakeAsync(() => {
      open();
      typeDate(caseTime(), '01:00');
      wait(200);
      typeDate(caseTime(), '14:00');
      wait(200);
      typeDate(caseTime(), '14:35');
      wait(PAUSE - 1);
      noPatch();

      wait(1);
      const save = patch();
      expect(save.request.body).toEqual({ time: '14:35' });
      save.flush(ticket({ time: '14:35' }));
      settle();

      expect(caseTime().value).toBe('14:35');
      expect(clearButton()).not.toBeNull();
    }));

    it('is saved at once when the field is left', fakeAsync(() => {
      open();
      typeDate(caseTime(), '09:05');
      fire(caseTime(), 'blur');

      const save = patch();
      expect(save.request.body).toEqual({ time: '09:05' });
      save.flush(ticket({ time: '09:05' }));
      settle();
      expect(caseTime().value).toBe('09:05');
    }));

    // The browser reports an empty value while a time is half typed.
    it('left half typed, sends nothing and shows the time the case has', fakeAsync(() => {
      open(ticket({ time: '14:35' }));
      typeDate(caseTime(), '');
      wait(PAUSE);
      noPatch();

      fire(caseTime(), 'blur');
      noPatch();
      expect(caseTime().value).toBe('14:35');
    }));

    it('is removed with its button, and the field is left empty', fakeAsync(() => {
      open(ticket({ time: '14:35' }));

      click(clearButton()!);
      const save = patch();
      expect(save.request.body).toEqual({ time: null });
      save.flush(ticket({ time: null }));
      settle();

      expect(caseTime().value).toBe('');
      expect(clearButton()).toBeNull();
    }));

    it('stays when the server refuses to remove it', fakeAsync(() => {
      open(ticket({ time: '14:35' }));

      click(clearButton()!);
      patch().flush({ message: 'No se pudo guardar' }, REFUSED);
      settle();

      expect(caseTime().value).toBe('14:35');
      expect(toasts()).toEqual(['No se pudo guardar']);
    }));

    it('follows a change made elsewhere', fakeAsync(() => {
      open();
      events.outdated(7);
      read().flush(ticket({ time: '08:15' }));
      settle();

      expect(caseTime().value).toBe('08:15');
    }));
  });

  describe('closing and moving on', () => {
    it('Escape leaves the field the person is in first, so what they typed is saved', fakeAsync(() => {
      open();
      const box = find<TextControl>('#tp-description');
      document.body.appendChild(el);
      try {
        box.focus();
        box.value = 'No imprime desde ayer';
        // The browser itself sends "change" when a field with another text loses the focus.
        box.addEventListener('blur', () => box.dispatchEvent(new Event('change')), { once: true });

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        render();

        expect(closed).toBe(1);
        const save = patch();
        expect(save.request.body).toEqual({ description: 'No imprime desde ayer' });
        save.flush(ticket({ description: 'No imprime desde ayer' }));
        settle();
      } finally {
        el.remove();
      }
    }));

    it('an observation typed and not added does not follow the panel to another case', fakeAsync(() => {
      open();
      const box = noteBox();
      box.value = 'Llamar mañana al cliente';
      fire(box, 'input');
      expect(noteBox().value).toBe('Llamar mañana al cliente');

      moveTo(OTHER);

      expect(noteBox().value).toBe('');
      expect(button('Agregar').disabled).toBeTrue();
    }));

    // A save made from the list can be answered before the first read of the panel: the case is
    // then on screen, and a read that fails says nothing about it.
    it('stays open when a read fails after a save already put the case on screen', fakeAsync(() => {
      create(7);
      events.saved(ticket({ status: 'UNRESOLVED' }));
      render();
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Acme');

      for (const request of reads()) request.flush(null, { status: 500, statusText: 'Server Error' });
      settle();
      for (const request of reads()) request.flush(null, { status: 500, statusText: 'Server Error' });
      settle();

      expect(closed).toBe(0);
      expect(find<HTMLInputElement>('#tp-company').value).toBe('Acme');
    }));

    it('closes when the first read fails and nothing is on screen', fakeAsync(() => {
      create(7);
      read().flush(null, { status: 500, statusText: 'Server Error' });
      settle();

      expect(closed).toBe(1);
    }));
  });

  describe('"Generar con IA" over a message of the person', () => {
    beforeEach(() => TestBed.inject(Catalogs).aiReady.set(true));

    // The typed message is not in the case yet when the button is pressed: leaving the box has
    // only just sent it.
    it('asks before replacing a message that was just typed, and leaves it when the answer is no', fakeAsync(() => {
      confirmed.and.returnValue(false);
      open();
      write(replyBox(), 'Ya puede imprimir.');
      const save = patch();

      click(button('Generar con IA'));

      expect(confirmed).toHaveBeenCalledOnceWith('¿Reemplazar la respuesta actual por una nueva?');
      http.expectNone({ method: 'POST', url: '/api/ai/reply/7' });
      save.flush(ticket({ customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya puede imprimir.');
    }));

    it('asks nothing when there is no message at all', fakeAsync(() => {
      open();

      click(button('Generar con IA'));

      expect(confirmed).not.toHaveBeenCalled();
      http.expectOne({ method: 'POST', url: '/api/ai/reply/7' }).flush(ticket({ customerReply: 'Estimado cliente: listo.' }));
      settle();
      expect(replyBox().value).toBe('Estimado cliente: listo.');
    }));
  });
});
