import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { Assignee, Company, SupportType, SystemModule, TicketDetail } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { TicketEvents } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { UnsavedChanges } from '../../core/unsaved-changes';
import { chooseOption, clearSelect, closeSelect, ngSelect, openSelect, optionTexts, removeChosen, selectedTexts, typeInSelect } from '../../testing/ng-select';
import { TicketPanel } from './ticket-panel';

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

const OTHER = ticket({ id: 8, code: 'SOP-00008', date: '2026-11-03', companyId: 5, company: 'Bodega Sur', description: 'No abre la caja' });

// The catalogs the selects of the form offer. One entry of each is deactivated: it keeps its cases and takes no new ones.
const COMPANIES: Company[] = [
  { id: 1, name: 'Acme', active: true, tickets: 3 },
  { id: 5, name: 'Bodega Sur', active: true, tickets: 1 },
  { id: 6, name: 'Taller Viejo', active: false, tickets: 2 },
];
const ASSIGNEES: Assignee[] = [
  { id: 4, name: 'Ana', active: true, tickets: 1 },
  { id: 5, name: 'Luis', active: true, tickets: 0 },
  { id: 6, name: 'Zoe', active: false, tickets: 2 },
];
const TRAINING = { id: 1, name: 'Capacitación', color: '#12b76a' };
const FAILURE = { id: 2, name: 'Falla del sistema', color: '#b91c1c' };
const WARRANTY = { id: 3, name: 'Garantía', color: '#64748b' };
const TYPES: SupportType[] = [
  { ...TRAINING, active: true, tickets: 0 },
  { ...FAILURE, active: true, tickets: 4 },
  { ...WARRANTY, active: false, tickets: 1 },
];
const MODULES: SystemModule[] = [
  { id: 1, name: 'Ventas', parentId: null, active: true, fullName: 'Ventas' },
  { id: 2, name: 'Facturas', parentId: 1, active: true, fullName: 'Ventas / Facturas' },
  { id: 8, name: 'Bodega vieja', parentId: null, active: false, fullName: 'Bodega vieja' },
];

const REFUSED = { status: 400, statusText: 'Bad Request' };
const NOTE = { id: 1, text: 'Se llamó al cliente', authorName: 'Ana', createdAt: '2026-11-06T09:00:00.000Z' };

type TextControl = HTMLInputElement | HTMLTextAreaElement;

// The form edits a draft and saves it with "Actualizar", so these tests act on the real controls
// and look at the requests that leave (none, until the button) and at what the form shows
// afterwards. Time is the test's own (fakeAsync): answers arrive when the test sends them, which
// is what lets one arrive late. The questions the panel asks go to the dialog of the app, which
// the shell has: here the test reads the question and answers it.
describe('TicketPanel', () => {
  let http: HttpTestingController;
  let events: TicketEvents;
  let catalogs: Catalogs;
  let confirm: Confirm;
  let fixture: ComponentFixture<TicketPanel>;
  let el: HTMLElement;
  let closed: number;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    events = TestBed.inject(TicketEvents);
    confirm = TestBed.inject(Confirm);
    catalogs = TestBed.inject(Catalogs);
    catalogs.companies.set(COMPANIES);
    catalogs.assignees.set(ASSIGNEES);
    catalogs.supportTypes.set(TYPES);
    catalogs.modules.set(MODULES);
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
    fixture.detectChanges();
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

  /** What `?caso=8` in the address does to an open panel: the same panel is given another case. */
  function give(id: number): void {
    fixture.componentRef.setInput('ticketId', id);
    render();
  }

  /** The panel goes on to another case, with nothing unsaved in the one it leaves. */
  function moveTo(stored: TicketDetail): void {
    give(stored.id);
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

  /** What the person types in a field, or picks in the calendar of a date: the browser reports both the same way. */
  function type(control: TextControl, text: string): void {
    control.value = text;
    fire(control, 'input');
  }

  function turnPromise(on: boolean): void {
    const toggle = promiseSwitch();
    toggle.checked = on;
    fire(toggle, 'change');
  }

  function pressEscape(): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    render();
  }

  // The fields of the form.
  const caseDate = (): HTMLInputElement => find('#tp-date');
  const caseTime = (): HTMLInputElement => find('#tp-time');
  const description = (): HTMLTextAreaElement => find('#tp-description');
  const estimated = (): HTMLInputElement => find('#tp-estimated');
  const spent = (): HTMLInputElement => find('#tp-spent');
  const promiseSwitch = (): HTMLInputElement => find('input[role=switch]');
  const promiseDate = (): HTMLInputElement | null => el.querySelector('input[aria-label="Fecha prometida de entrega"]');
  const replyBox = (): HTMLTextAreaElement => find('textarea[aria-label="Respuesta para el cliente"]');
  const noteBox = (): HTMLTextAreaElement => find('textarea[aria-label="Nueva observación"]');

  // Its selects, each by the id its label points at.
  const select = (name: string): HTMLElement => ngSelect(el, name);
  /** What a select shows as chosen. */
  const chosen = (name: string): string[] => selectedTexts(select(name));

  /** What a select offers. Its list is closed again: left open, it would stay on the page. */
  function offers(name: string): string[] {
    const texts = optionTexts(select(name));
    closeSelect(select(name));
    render();
    return texts;
  }

  function pick(name: string, option: string): void {
    chooseOption(select(name), option);
    render();
  }

  // The foot of the form: what is unsaved, and the two buttons that end it.
  const footer = (): HTMLElement => find('footer');
  /** "Actualizar". It reads "Guardando…" while its save is on its way. */
  const save = (): HTMLButtonElement => find('footer button.btn-primary');
  const discard = (): HTMLButtonElement | null => Array.from(footer().querySelectorAll('button')).find((candidate) => candidate.textContent?.includes('Descartar cambios')) ?? null;
  const unsaved = (): boolean => !!footer().textContent?.includes('Cambios sin guardar');
  /** The notice that the case changed elsewhere while the form had changes. */
  const notice = (): HTMLElement | null => Array.from(el.querySelectorAll<HTMLElement>('[role=status]')).find((item) => item.textContent?.includes('Este caso cambió en otra pantalla')) ?? null;
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);

  /** Presses "Actualizar" and gives back the save it sends. */
  function update(id = 7): TestRequest {
    click(save());
    return patch(id);
  }

  /** Answers the question the panel has on screen: true presses the button that confirms. */
  function answer(confirmed: boolean): void {
    confirm.answer(confirmed);
    settle();
  }

  const LEAVE = { title: 'Hay cambios sin guardar', confirmLabel: 'Descartar y salir', cancelLabel: 'Seguir editando' };

  describe('the draft', () => {
    it('sends nothing while the person types, chooses and switches, however long they take', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      // Leaving a field saves nothing either.
      fire(description(), 'change');
      fire(description(), 'blur');
      type(caseDate(), '2026-11-02');
      type(caseTime(), '14:35');
      pick('tp-company', 'Bodega Sur');
      pick('tp-status', 'Resuelto');
      pick('tp-assignee', 'Luis');
      pick('tp-priority', 'Alta');
      pick('tp-module', 'Ventas / Facturas');
      pick('tp-types', 'Capacitación');
      closeSelect(select('tp-types'));
      type(estimated(), '45');
      type(spent(), '30');
      turnPromise(true);
      type(promiseDate()!, '2026-12-24');
      type(replyBox(), 'Ya puede imprimir.');
      wait(60_000);

      noPatch();
      expect(unsaved()).toBeTrue();
      // The case itself is as it was: its badge is the stored status, not the one chosen.
      expect(find('header .badge').textContent).toContain('Pendiente');
    }));

    it('has nothing to save, and nothing to discard, until something changes', fakeAsync(() => {
      open();
      expect(save().disabled).toBeTrue();
      expect(save().textContent).toContain('Actualizar');
      expect(discard()).toBeNull();
      expect(unsaved()).toBeFalse();

      type(description(), 'No imprime desde el lunes');
      expect(save().disabled).toBeFalse();
      expect(discard()).not.toBeNull();
      expect(unsaved()).toBeTrue();

      // Put back by hand, it is the case again.
      type(description(), 'No imprime');
      expect(save().disabled).toBeTrue();
      expect(discard()).toBeNull();
      expect(unsaved()).toBeFalse();
    }));

    it('"Actualizar" sends what changed, and only that, in one save', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      pick('tp-status', 'Sin resolver');
      pick('tp-assignee', 'Luis');

      const sent = update();
      expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes', status: 'UNRESOLVED', assigneeId: 5 });
      sent.flush(ticket({ description: 'No imprime desde el lunes', status: 'UNRESOLVED', assigneeId: 5, assigneeName: 'Luis' }));
      settle();

      expect(toasts()).toEqual(['Caso actualizado']);
      expect(find('header .badge').textContent).toContain('Sin resolver');
      expect(description().value).toBe('No imprime desde el lunes');
      expect(chosen('tp-assignee')).toEqual(['Luis']);
      expect(save().disabled).toBeTrue();
      expect(unsaved()).toBeFalse();
      expect(discard()).toBeNull();
    }));

    it('shows the case as the server stored it once the save is answered', fakeAsync(() => {
      open();
      type(description(), '  No imprime desde el lunes \n');

      const sent = update();
      expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes' });
      sent.flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      expect(description().value).toBe('No imprime desde el lunes');
    }));

    // A double click, or Enter held down on the button.
    it('"Actualizar" pressed twice sends one save, and cannot be pressed again until it is answered', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      save().click();
      save().click();
      render();

      expect(patches().length).toBe(1);
      expect(save().disabled).toBeTrue();
      expect(save().textContent).toContain('Guardando…');
      // Nor can the draft be discarded from under the save.
      expect(discard()!.disabled).toBeTrue();
      click(save());
      noPatch();
    }));

    it('keeps the draft when the server refuses it, says why, and sends it again with "Actualizar"', fakeAsync(() => {
      open();
      type(caseDate(), '2099-01-01');
      pick('tp-priority', 'Alta');

      update().flush({ message: 'La fecha del caso no puede ser posterior a hoy' }, REFUSED);
      settle();
      expect(toasts()).toEqual(['La fecha del caso no puede ser posterior a hoy']);
      expect(caseDate().value).toBe('2099-01-01');
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeTrue();
      expect(save().disabled).toBeFalse();
      expect(save().textContent).toContain('Actualizar');

      // Corrected, the whole draft goes again.
      type(caseDate(), '2026-11-02');
      const again = update();
      expect(again.request.body).toEqual({ date: '2026-11-02', priority: 'HIGH' });
      again.flush(ticket({ date: '2026-11-02', priority: 'HIGH' }));
      settle();
      expect(unsaved()).toBeFalse();
    }));

    it('keeps the draft when the save does not reach the server', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');

      update().error(new ProgressEvent('error'));
      settle();
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
      expect(description().value).toBe('No imprime desde el lunes');
      expect(unsaved()).toBeTrue();

      const again = update();
      expect(again.request.body).toEqual({ description: 'No imprime desde el lunes' });
      again.flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      expect(toasts()).toEqual(['No hay conexión con el servidor', 'Caso actualizado']);
    }));

    it('"Descartar cambios" puts every field back as the case has it, and sends nothing', fakeAsync(() => {
      open(ticket({ time: '09:00', assigneeId: 4, assigneeName: 'Ana', supportTypes: [FAILURE], estimatedMinutes: 20, promisedDate: '2026-12-24', promiseState: 'later', customerReply: 'Listo.' }));
      type(description(), 'Otra cosa');
      type(caseDate(), '2026-11-01');
      type(caseTime(), '10:30');
      pick('tp-company', 'Bodega Sur');
      pick('tp-status', 'Resuelto');
      clearSelect(select('tp-assignee'));
      render();
      pick('tp-priority', 'Crítica');
      pick('tp-module', 'Ventas');
      removeChosen(select('tp-types'), 'Falla del sistema');
      render();
      type(estimated(), '90');
      type(spent(), '15');
      turnPromise(false);
      type(replyBox(), 'Ya quedó.');

      click(discard()!);

      expect(description().value).toBe('No imprime');
      expect(caseDate().value).toBe('2026-11-05');
      expect(caseTime().value).toBe('09:00');
      expect(chosen('tp-company')).toEqual(['Acme']);
      expect(chosen('tp-status')).toEqual(['Pendiente']);
      expect(chosen('tp-assignee')).toEqual(['Ana']);
      expect(chosen('tp-priority')).toEqual([]);
      expect(chosen('tp-module')).toEqual([]);
      expect(chosen('tp-types')).toEqual(['Falla del sistema']);
      expect(estimated().value).toBe('20');
      expect(spent().value).toBe('0');
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()!.value).toBe('2026-12-24');
      expect(replyBox().value).toBe('Listo.');
      expect(unsaved()).toBeFalse();
      expect(save().disabled).toBeTrue();
      noPatch();
    }));

    // What counts as a change is what would be stored differently.
    it('has nothing to save when only the spaces around a text changed', fakeAsync(() => {
      open(ticket({ customerReply: 'Listo.' }));
      type(description(), '  No imprime \n');
      type(replyBox(), 'Listo. ');

      expect(save().disabled).toBeTrue();
      expect(unsaved()).toBeFalse();
    }));

    // A text that came from an import or an assistant. The textarea gives it back with its own line ends.
    it('does not take a text stored with Windows line ends for a change of the person', fakeAsync(() => {
      open(ticket({ description: 'No imprime.\r\nNi escanea.' }));
      expect(unsaved()).toBeFalse();

      type(description(), 'No imprime.\nNi escanea. Tampoco copia.');
      expect(unsaved()).toBeTrue();
      type(description(), 'No imprime.\nNi escanea.');
      expect(unsaved()).toBeFalse();
    }));

    it('written on while its save is on its way: what was typed after stays, as a change still to save', fakeAsync(() => {
      open();
      type(description(), 'Uno');
      pick('tp-priority', 'Alta');
      const first = update();
      type(description(), 'Uno dos');

      first.flush(ticket({ description: 'Uno', priority: 'HIGH' }));
      settle();
      expect(description().value).toBe('Uno dos');
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeTrue();

      // What was stored is not sent again.
      const second = update();
      expect(second.request.body).toEqual({ description: 'Uno dos' });
      second.flush(ticket({ description: 'Uno dos', priority: 'HIGH' }));
      settle();
      expect(unsaved()).toBeFalse();
    }));

    // The limits of the server. Without them a long paste is refused only after it was typed.
    it('cannot be given more text, or more minutes, than the server stores', fakeAsync(() => {
      open();
      expect(select('tp-company').querySelector<HTMLInputElement>('input[role=combobox]')!.maxLength).toBe(200);
      expect(description().maxLength).toBe(5000);
      expect(replyBox().maxLength).toBe(5000);
      expect(noteBox().maxLength).toBe(5000);
      expect(estimated().max).toBe('1000000');
      expect(spent().max).toBe('1000000');
    }));
  });

  describe('a field that cannot be saved as it stands', () => {
    // The browser reports an empty date while a day is half typed, and a year as "0002", "0020", "0202" on its way to "2026".
    it('the date of the case, empty or with its year half typed: says so, and nothing can be saved until it is whole', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      for (const typed of ['', '0002-11-05', '0202-11-05']) {
        type(caseDate(), typed);
        expect(save().disabled).withContext(typed).toBeTrue();
        expect(caseDate().getAttribute('aria-invalid')).toBe('true');
        expect(find(`#${caseDate().getAttribute('aria-describedby')}`).textContent).toContain('Escribe la fecha completa.');
      }

      type(caseDate(), '2026-11-02');
      expect(caseDate().hasAttribute('aria-invalid')).toBeFalse();
      expect(el.querySelector('#tp-date-error')).toBeNull();
      const sent = update();
      expect(sent.request.body).toEqual({ date: '2026-11-02', priority: 'HIGH' });
      sent.flush(ticket({ date: '2026-11-02', priority: 'HIGH' }));
      settle();
    }));

    it('the date of the case, left empty: "Descartar cambios" shows the one the case has', fakeAsync(() => {
      open();
      type(caseDate(), '');
      expect(unsaved()).toBeTrue();

      click(discard()!);
      expect(caseDate().value).toBe('2026-11-05');
      expect(el.querySelector('#tp-date-error')).toBeNull();
    }));

    it('the description, emptied: says so, and nothing can be saved until it has a text', fakeAsync(() => {
      open();
      type(description(), '   ');

      expect(save().disabled).toBeTrue();
      expect(description().getAttribute('aria-invalid')).toBe('true');
      expect(find(`#${description().getAttribute('aria-describedby')}`).textContent).toContain('La descripción no puede quedar vacía.');
      wait(1000);
      noPatch();

      type(description(), 'No enciende');
      expect(description().hasAttribute('aria-invalid')).toBeFalse();
      expect(save().disabled).toBeFalse();
    }));

    // It was 12 px text in the danger colour, under 4:1 against the panel in the light theme.
    it('says it in the colour of the text around it, with the danger colour only in its icon and in the border of the field', fakeAsync(() => {
      open();
      const danger = 'rgb(229, 72, 77)';
      const ink = getComputedStyle(description()).color;
      expect(ink).not.toBe(danger);
      type(description(), '');

      const message = find('#tp-description-error');
      expect(getComputedStyle(message).color).toBe(ink);
      expect(getComputedStyle(message).fontSize).toBe('12px');
      expect(getComputedStyle(find('#tp-description-error i[aria-hidden=true]')).color).toBe(danger);
      expect(getComputedStyle(description()).borderTopColor).toBe(danger);
    }));
  });

  describe('the time of the case', () => {
    const clearButton = (): HTMLButtonElement | null => el.querySelector('button[aria-label="Quitar la hora del caso"]');

    /**
     * A time left half typed ("14:--"), as the browser reports it: an empty field that is not a
     * valid one. It says the field changed only when it held a time before: empty, it still is,
     * and all the page gets is the key.
     */
    function halfType(): void {
      Object.defineProperty(caseTime(), 'validity', { configurable: true, value: { badInput: true } });
      if (caseTime().value) type(caseTime(), '');
      fire(caseTime(), 'keyup');
    }

    /** The time typed to the end: the field is a valid one again. */
    function complete(time: string): void {
      Reflect.deleteProperty(caseTime(), 'validity');
      type(caseTime(), time);
    }

    it('is empty, with nothing to remove, on a case that only has its date', fakeAsync(() => {
      open();

      expect(caseTime().value).toBe('');
      expect(caseTime().type).toBe('time');
      expect(clearButton()).toBeNull();
    }));

    it('typed, is saved with "Actualizar"', fakeAsync(() => {
      open();
      type(caseTime(), '01:00');
      type(caseTime(), '14:00');
      type(caseTime(), '14:35');
      wait(5000);
      noPatch();
      expect(clearButton()).not.toBeNull();

      const sent = update();
      expect(sent.request.body).toEqual({ time: '14:35' });
      sent.flush(ticket({ time: '14:35' }));
      settle();
      expect(caseTime().value).toBe('14:35');
    }));

    it('is removed with its button, which empties the field: saved, the case has only its date', fakeAsync(() => {
      open(ticket({ time: '14:35' }));

      click(clearButton()!);
      expect(caseTime().value).toBe('');
      expect(clearButton()).toBeNull();
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ time: null });
      sent.flush(ticket({ time: null }));
      settle();
      expect(caseTime().value).toBe('');
    }));

    it('stays in the draft as removed when the server refuses to remove it', fakeAsync(() => {
      open(ticket({ time: '14:35' }));
      click(clearButton()!);

      update().flush({ message: 'No se pudo guardar' }, REFUSED);
      settle();
      expect(toasts()).toEqual(['No se pudo guardar']);
      expect(caseTime().value).toBe('');
      expect(unsaved()).toBeTrue();

      click(discard()!);
      expect(caseTime().value).toBe('14:35');
    }));

    // The browser reports an empty value while a time is half typed. Taken for a field that was
    // emptied, saving would take the time off the case.
    it('left half typed: says so, and nothing can be saved until it is completed', fakeAsync(() => {
      open(ticket({ time: '14:35' }));
      pick('tp-priority', 'Alta');
      halfType();

      expect(save().disabled).toBeTrue();
      expect(caseTime().getAttribute('aria-invalid')).toBe('true');
      expect(find(`#${caseTime().getAttribute('aria-describedby')}`).textContent).toContain('Completa la hora o quítala.');

      complete('15:00');
      expect(caseTime().hasAttribute('aria-invalid')).toBeFalse();
      const sent = update();
      expect(sent.request.body).toEqual({ time: '15:00', priority: 'HIGH' });
      sent.flush(ticket({ time: '15:00', priority: 'HIGH' }));
      settle();
    }));

    it('left half typed on a case without a time: counts as unsaved, and its button or "Descartar cambios" clears it', fakeAsync(() => {
      open();
      halfType();
      expect(unsaved()).toBeTrue();
      expect(save().disabled).toBeTrue();

      click(clearButton()!);
      expect(el.querySelector('#tp-time-error')).toBeNull();
      expect(unsaved()).toBeFalse();

      halfType();
      click(discard()!);
      expect(el.querySelector('#tp-time-error')).toBeNull();
      expect(caseTime().value).toBe('');
      expect(unsaved()).toBeFalse();
    }));

    it('follows a change made elsewhere', fakeAsync(() => {
      open();
      events.outdated(7);
      read().flush(ticket({ time: '08:15' }));
      settle();

      expect(caseTime().value).toBe('08:15');
    }));
  });

  describe('the promise switch', () => {
    const promised = ticket({ promisedDate: '2026-12-24', promiseState: 'later' });

    it('turned on, shows the date field and waits for a date: there is nothing to save yet', fakeAsync(() => {
      open();
      expect(promiseDate()).toBeNull();
      expect(el.textContent).toContain('Sin fecha prometida al cliente');

      turnPromise(true);
      expect(promiseDate()).not.toBeNull();
      expect(el.textContent).toContain('Elige la fecha prometida');
      expect(save().disabled).toBeTrue();
      // It is the person's all the same: leaving would ask, and it can be given up.
      expect(unsaved()).toBeTrue();

      click(discard()!);
      expect(promiseSwitch().checked).toBeFalse();
      expect(promiseDate()).toBeNull();
    }));

    // The switch on, with no date yet, is only in the form. A form that followed the case would turn it off.
    it('stays on, with no date yet, when the case changes elsewhere and when something else is done on it', fakeAsync(() => {
      open();
      turnPromise(true);

      events.outdated(7);
      read().flush(ticket({ priority: 'HIGH' }));
      settle();
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()).not.toBeNull();

      type(noteBox(), 'Se llamó al cliente');
      click(button('Agregar'));
      http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' }).flush(ticket({ priority: 'HIGH', notes: [NOTE], notesCount: 1 }));
      settle();
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()).not.toBeNull();
    }));

    it('is saved with the date chosen, once', fakeAsync(() => {
      open();
      turnPromise(true);
      type(promiseDate()!, '2026-12-02');
      type(promiseDate()!, '2026-12-24');
      expect(el.textContent).not.toContain('Elige la fecha prometida');
      wait(5000);
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ promisedDate: '2026-12-24' });
      sent.flush(promised);
      settle();
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()!.value).toBe('2026-12-24');
      expect(unsaved()).toBeFalse();
    }));

    it('with its date emptied, or its year half typed, cannot be saved', fakeAsync(() => {
      open(promised);
      for (const typed of ['', '0202-12-24']) {
        type(promiseDate()!, typed);
        expect(save().disabled).withContext(typed).toBeTrue();
        expect(el.textContent).toContain('Elige la fecha prometida');
      }

      type(promiseDate()!, '2026-12-30');
      const sent = update();
      expect(sent.request.body).toEqual({ promisedDate: '2026-12-30' });
      sent.flush(ticket({ promisedDate: '2026-12-30', promiseState: 'later' }));
      settle();
    }));

    it('turned off, removes the promise with "Actualizar"', fakeAsync(() => {
      open(promised);
      turnPromise(false);
      expect(promiseDate()).toBeNull();
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ promisedDate: null });
      sent.flush(ticket());
      settle();
      expect(promiseSwitch().checked).toBeFalse();
      expect(unsaved()).toBeFalse();
    }));

    it('turned off and on again, has its date back and nothing to save', fakeAsync(() => {
      open(promised);
      turnPromise(false);
      expect(unsaved()).toBeTrue();

      turnPromise(true);
      expect(promiseDate()!.value).toBe('2026-12-24');
      expect(unsaved()).toBeFalse();
      expect(save().disabled).toBeTrue();
    }));

    it('turned off, stays off in the draft when the server refuses to remove the promise', fakeAsync(() => {
      open(promised);
      turnPromise(false);

      update().flush({ message: 'No se puede quitar la promesa' }, REFUSED);
      settle();
      expect(toasts()).toEqual(['No se puede quitar la promesa']);
      expect(promiseSwitch().checked).toBeFalse();
      expect(unsaved()).toBeTrue();

      click(discard()!);
      expect(promiseSwitch().checked).toBeTrue();
      expect(promiseDate()!.value).toBe('2026-12-24');
    }));

    // "vence hoy", "venció hace 2 días": said of the promise the case has, not of a date still in the draft.
    it('says where the promise of the case stands, and nothing of a date that is not saved yet', fakeAsync(() => {
      open(ticket({ promisedDate: '2020-01-01', promiseState: 'overdue' }));
      const standing = (): HTMLElement | null => el.querySelector('span.text-danger');
      expect(standing()!.textContent).toContain('venció hace');

      type(promiseDate()!, '2020-01-02');
      expect(standing()).toBeNull();
    }));
  });

  // A case is of a company of the catalog.
  describe('Empresa', () => {
    it('is the company of the case, among the active ones of the catalog', fakeAsync(() => {
      open();

      expect(find('label[for=tp-company]').textContent).toBe('Empresa');
      expect(chosen('tp-company')).toEqual(['Acme']);
      expect(offers('tp-company')).toEqual(['Acme', 'Bodega Sur']);
    }));

    it('that was deactivated is still offered to the case that has it', fakeAsync(() => {
      open(ticket({ companyId: 6, company: 'Taller Viejo' }));

      expect(chosen('tp-company')).toEqual(['Taller Viejo']);
      expect(offers('tp-company')).toEqual(['Acme', 'Bodega Sur', 'Taller Viejo']);
    }));

    // The catalogs are read once for every screen, and may arrive after the case.
    it('is shown by the name the case brings while the catalog has not arrived', fakeAsync(() => {
      catalogs.companies.set([]);
      open();
      expect(chosen('tp-company')).toEqual(['Acme']);

      catalogs.companies.set(COMPANIES);
      render();
      expect(chosen('tp-company')).toEqual(['Acme']);
      expect(unsaved()).toBeFalse();
    }));

    it('cannot be left empty: a case always has a company', fakeAsync(() => {
      open();

      expect(() => clearSelect(select('tp-company'))).toThrowError('The select has nothing to clear, or cannot be cleared');
    }));

    it('is found by typing part of its name, and saved by its number', fakeAsync(() => {
      open();
      typeInSelect(select('tp-company'), 'bodega');
      render();
      expect(optionTexts(select('tp-company'))).toEqual(['Bodega Sur', 'Crear empresa «bodega»']);
      pick('tp-company', 'Bodega Sur');
      expect(chosen('tp-company')).toEqual(['Bodega Sur']);
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ companyId: 5 });
      sent.flush(ticket({ companyId: 5, company: 'Bodega Sur' }));
      settle();
      expect(chosen('tp-company')).toEqual(['Bodega Sur']);
    }));

    describe('"Crear empresa «X»", for a company that is not in the catalog', () => {
      const created: Company = { id: 9, name: 'Ferretería El Tornillo', active: true, tickets: 0 };

      /** Types the name and presses the option that creates it. Gives back the request that adds it to the catalog. */
      function createFromSelect(name: string): TestRequest {
        typeInSelect(select('tp-company'), name);
        render();
        pick('tp-company', `Crear empresa «${name}»`);
        return http.expectOne({ method: 'POST', url: '/api/companies' });
      }

      it('adds it to the catalog and chooses it in the draft: the case gets it with "Actualizar"', fakeAsync(() => {
        open();
        const add = createFromSelect('Ferretería El Tornillo');
        expect(add.request.body).toEqual({ name: 'Ferretería El Tornillo' });
        add.flush(created);
        settle();

        expect(toasts()).toEqual(['Empresa «Ferretería El Tornillo» creada']);
        expect(chosen('tp-company')).toEqual(['Ferretería El Tornillo']);
        // The other screens offer it too, without reading the catalogs again.
        expect(catalogs.activeCompanies().map((company) => company.name)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
        expect(offers('tp-company')).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
        // The case is not touched yet.
        noPatch();
        expect(unsaved()).toBeTrue();

        const sent = update();
        expect(sent.request.body).toEqual({ companyId: 9 });
        sent.flush(ticket({ companyId: 9, company: 'Ferretería El Tornillo' }));
        settle();
        expect(chosen('tp-company')).toEqual(['Ferretería El Tornillo']);
        expect(unsaved()).toBeFalse();
      }));

      it('stays in the catalog when the draft is discarded: only the case goes back to its company', fakeAsync(() => {
        open();
        createFromSelect('Ferretería El Tornillo').flush(created);
        settle();

        click(discard()!);
        expect(chosen('tp-company')).toEqual(['Acme']);
        expect(offers('tp-company')).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
        noPatch();
      }));

      it('that the server refuses: says why, and the draft keeps the company it had', fakeAsync(() => {
        open();
        createFromSelect('acmé').flush({ message: 'Ya existe una empresa con ese nombre' }, { status: 409, statusText: 'Conflict' });
        settle();

        expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
        closeSelect(select('tp-company'));
        render();
        expect(chosen('tp-company')).toEqual(['Acme']);
        expect(unsaved()).toBeFalse();
      }));
    });
  });

  describe('the responsible', () => {
    // "Cliente" is not an option of its own. A deactivated responsible is offered only to the case that has it.
    it('is one of the active responsibles of the catalog, the one the case has, or nobody', fakeAsync(() => {
      open(ticket({ assigneeId: 6, assigneeName: 'Zoe' }));
      expect(chosen('tp-assignee')).toEqual(['Zoe']);
      expect(offers('tp-assignee')).toEqual(['Ana', 'Luis', 'Zoe']);

      moveTo(OTHER);
      expect(chosen('tp-assignee')).toEqual([]);
      expect(select('tp-assignee').textContent).toContain('Sin asignar');
      expect(offers('tp-assignee')).toEqual(['Ana', 'Luis']);
    }));

    it('is saved by its number, and as nobody when the select is emptied', fakeAsync(() => {
      open();
      pick('tp-assignee', 'Luis');
      const assign = update();
      expect(assign.request.body).toEqual({ assigneeId: 5 });
      assign.flush(ticket({ assigneeId: 5, assigneeName: 'Luis' }));
      settle();
      expect(chosen('tp-assignee')).toEqual(['Luis']);

      clearSelect(select('tp-assignee'));
      render();
      const unassign = update();
      expect(unassign.request.body).toEqual({ assigneeId: null });
      unassign.flush(ticket());
      settle();
      expect(chosen('tp-assignee')).toEqual([]);
    }));
  });

  describe('the support types', () => {
    const types = (): HTMLElement => select('tp-types');

    it('are the chips of the case, each in its colour', fakeAsync(() => {
      open(ticket({ supportTypes: [TRAINING, FAILURE] }));

      expect(find('label[for=tp-types]').textContent).toBe('Tipos de soporte');
      expect(chosen('tp-types')).toEqual(['Capacitación', 'Falla del sistema']);
      const colours = Array.from(types().querySelectorAll('app-type-chip')).map((chip) => getComputedStyle(chip).backgroundColor);
      expect(colours).toEqual(['rgb(18, 183, 106)', 'rgb(185, 28, 28)']);
    }));

    it('are none on a case without any, which says so', fakeAsync(() => {
      open();

      expect(chosen('tp-types')).toEqual([]);
      expect(types().textContent).toContain('Sin tipo de soporte');
    }));

    it('are chosen among the active types of the catalog and the ones the case has', fakeAsync(() => {
      open(ticket({ supportTypes: [WARRANTY] }));
      expect(offers('tp-types')).toEqual(['Capacitación', 'Falla del sistema', 'Garantía']);

      moveTo(OTHER);
      expect(offers('tp-types')).toEqual(['Capacitación', 'Falla del sistema']);
    }));

    it('chosen and taken off, are saved as the whole set, in one save', fakeAsync(() => {
      open(ticket({ supportTypes: [FAILURE] }));
      // The list stays open to choose several in a row.
      pick('tp-types', 'Capacitación');
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();
      closeSelect(types());
      render();
      removeChosen(types(), 'Falla del sistema');
      render();
      expect(chosen('tp-types')).toEqual(['Capacitación']);
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ supportTypeIds: [1] });
      sent.flush(ticket({ supportTypes: [TRAINING] }));
      settle();
      expect(chosen('tp-types')).toEqual(['Capacitación']);
      expect(unsaved()).toBeFalse();
    }));

    it('all taken off, are saved as none', fakeAsync(() => {
      open(ticket({ supportTypes: [TRAINING, FAILURE] }));
      removeChosen(types(), 'Capacitación');
      render();
      removeChosen(types(), 'Falla del sistema');
      render();

      const sent = update();
      expect(sent.request.body).toEqual({ supportTypeIds: [] });
      sent.flush(ticket());
      settle();
      expect(chosen('tp-types')).toEqual([]);
    }));

    // They are a set: the same types in another order are the same types.
    it('taken off and chosen again are nothing to save', fakeAsync(() => {
      open(ticket({ supportTypes: [TRAINING, FAILURE] }));
      removeChosen(types(), 'Capacitación');
      render();
      expect(unsaved()).toBeTrue();

      pick('tp-types', 'Capacitación');
      closeSelect(types());
      render();
      expect(chosen('tp-types')).toEqual(['Falla del sistema', 'Capacitación']);
      expect(unsaved()).toBeFalse();
      expect(save().disabled).toBeTrue();
    }));
  });

  describe('the status, the priority and the module', () => {
    it('are chosen in selects of the app, like every other list of the form', fakeAsync(() => {
      open();

      expect(el.querySelector('select')).toBeNull();
      for (const [name, label] of [
        ['tp-company', 'Empresa'],
        ['tp-status', 'Estado'],
        ['tp-assignee', 'Responsable'],
        ['tp-priority', 'Prioridad'],
        ['tp-module', 'Módulo'],
        ['tp-types', 'Tipos de soporte'],
      ]) {
        expect(select(name)).withContext(name).toBeTruthy();
        expect(find(`label[for=${name}]`).textContent).toBe(label);
      }
    }));

    it('the status is one of the three, and never none', fakeAsync(() => {
      open();

      expect(chosen('tp-status')).toEqual(['Pendiente']);
      expect(offers('tp-status')).toEqual(['Sin resolver', 'Pendiente', 'Resuelto']);
      expect(() => clearSelect(select('tp-status'))).toThrowError('The select has nothing to clear, or cannot be cleared');
    }));

    it('the priority is one of the four, or none', fakeAsync(() => {
      open(ticket({ priority: 'LOW' }));
      expect(chosen('tp-priority')).toEqual(['Baja']);
      expect(offers('tp-priority')).toEqual(['Baja', 'Media', 'Alta', 'Crítica']);

      clearSelect(select('tp-priority'));
      render();
      expect(select('tp-priority').textContent).toContain('Sin prioridad');
      const cleared = update();
      expect(cleared.request.body).toEqual({ priority: null });
      cleared.flush(ticket());
      settle();

      pick('tp-priority', 'Crítica');
      const set = update();
      expect(set.request.body).toEqual({ priority: 'CRITICAL' });
      set.flush(ticket({ priority: 'CRITICAL' }));
      settle();
      expect(chosen('tp-priority')).toEqual(['Crítica']);
    }));

    it('the module is chosen by its full name, or none', fakeAsync(() => {
      open();
      expect(select('tp-module').textContent).toContain('Sin módulo');
      expect(offers('tp-module')).toEqual(['Ventas', 'Ventas / Facturas']);

      pick('tp-module', 'Ventas / Facturas');
      const sent = update();
      expect(sent.request.body).toEqual({ moduleId: 2 });
      sent.flush(ticket({ moduleId: 2, moduleName: 'Ventas / Facturas' }));
      settle();
      expect(chosen('tp-module')).toEqual(['Ventas / Facturas']);

      clearSelect(select('tp-module'));
      render();
      const cleared = update();
      expect(cleared.request.body).toEqual({ moduleId: null });
      cleared.flush(ticket());
      settle();
    }));

    // A deactivated module takes no new cases, and keeps the ones it has.
    it('a module that was deactivated is still shown, and offered, on the case that has it', fakeAsync(() => {
      open(ticket({ moduleId: 8, moduleName: 'Bodega vieja' }));

      expect(chosen('tp-module')).toEqual(['Bodega vieja']);
      expect(offers('tp-module')).toEqual(['Ventas', 'Ventas / Facturas', 'Bodega vieja']);
      expect(unsaved()).toBeFalse();
    }));
  });

  describe('the minutes', () => {
    it('are saved as whole minutes, and the field shows them so once it is left', fakeAsync(() => {
      open(ticket({ estimatedMinutes: 20, spentMinutes: 15 }));
      type(estimated(), '45.6');
      fire(estimated(), 'change');
      expect(estimated().value).toBe('46');
      type(spent(), '-5');
      fire(spent(), 'change');
      expect(spent().value).toBe('0');
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ estimatedMinutes: 46, spentMinutes: 0 });
      sent.flush(ticket({ estimatedMinutes: 46, spentMinutes: 0 }));
      settle();
    }));

    it('emptied: the estimate is saved as none, and the time spent goes back to zero', fakeAsync(() => {
      open(ticket({ estimatedMinutes: 20, spentMinutes: 15 }));
      type(estimated(), '');
      type(spent(), '');
      fire(spent(), 'change');
      expect(estimated().value).toBe('');
      expect(spent().value).toBe('0');

      const sent = update();
      expect(sent.request.body).toEqual({ estimatedMinutes: null, spentMinutes: 0 });
      sent.flush(ticket());
      settle();
    }));

    it('written another way are the same minutes: nothing to save', fakeAsync(() => {
      open(ticket({ estimatedMinutes: 20 }));
      type(estimated(), '20.2');
      expect(save().disabled).toBeTrue();
      expect(unsaved()).toBeFalse();

      fire(estimated(), 'change');
      expect(estimated().value).toBe('20');
    }));

    // "30e" in one browser, "45 min" in another. The browser reports such a field as empty, as
    // it does a time half typed: taken for a field that was emptied, saving would take the
    // minutes off the case.
    describe('written as a text that is not a number', () => {
      /** The text typed, as the browser reports it: an empty field that is not a valid one. */
      function typeText(box: HTMLInputElement): void {
        Object.defineProperty(box, 'validity', { configurable: true, value: { badInput: true } });
        type(box, '');
      }

      /** A number typed in its place: the field is a valid one again. */
      function typeNumber(box: HTMLInputElement, minutes: string): void {
        Reflect.deleteProperty(box, 'validity');
        type(box, minutes);
      }

      it('in "Estimado": says so, and nothing can be saved until it is a number', fakeAsync(() => {
        open(ticket({ estimatedMinutes: 30 }));
        pick('tp-priority', 'Alta');
        typeText(estimated());

        expect(save().disabled).toBeTrue();
        expect(estimated().getAttribute('aria-invalid')).toBe('true');
        expect(find(`#${estimated().getAttribute('aria-describedby')}`).textContent).toContain('Escribe solo el número de minutos.');
        // Leaving the field does not make it something to save.
        fire(estimated(), 'change');
        expect(save().disabled).toBeTrue();
        expect(el.querySelector('#tp-spent-error')).toBeNull();
        noPatch();

        typeNumber(estimated(), '45');
        expect(estimated().hasAttribute('aria-invalid')).toBeFalse();
        expect(el.querySelector('#tp-estimated-error')).toBeNull();
        const sent = update();
        expect(sent.request.body).toEqual({ estimatedMinutes: 45, priority: 'HIGH' });
        sent.flush(ticket({ estimatedMinutes: 45, priority: 'HIGH' }));
        settle();
      }));

      // An emptied "Real" goes back to zero when the field is left. A text is not an emptied field.
      it('in "Real": says so, and the text is not turned into a zero when the field is left', fakeAsync(() => {
        open(ticket({ spentMinutes: 15 }));
        typeText(spent());
        fire(spent(), 'change');

        expect(spent().value).toBe('');
        expect(spent().getAttribute('aria-invalid')).toBe('true');
        expect(find(`#${spent().getAttribute('aria-describedby')}`).textContent).toContain('Escribe solo el número de minutos.');
        expect(save().disabled).toBeTrue();

        typeNumber(spent(), '20');
        fire(spent(), 'change');
        expect(el.querySelector('#tp-spent-error')).toBeNull();
        const sent = update();
        expect(sent.request.body).toEqual({ spentMinutes: 20 });
        sent.flush(ticket({ spentMinutes: 20 }));
        settle();
      }));

      it('on a case without an estimate: counts as unsaved, and "Descartar cambios" clears it', fakeAsync(() => {
        open();
        typeText(estimated());
        expect(unsaved()).toBeTrue();
        expect(save().disabled).toBeTrue();
        pressEscape();
        expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
        answer(false);

        click(discard()!);
        expect(el.querySelector('#tp-estimated-error')).toBeNull();
        expect(estimated().value).toBe('');
        expect(unsaved()).toBeFalse();
      }));
    });
  });

  describe('leaving with unsaved changes', () => {
    const ways: { name: string; leave: () => void }[] = [
      { name: 'the button that closes', leave: () => click(find('button[aria-label="Cerrar"]')) },
      { name: 'a press outside the panel', leave: () => click(find('div[aria-hidden=true]')) },
      { name: 'Escape', leave: pressEscape },
    ];

    for (const { name, leave } of ways) {
      it(`${name}: with nothing unsaved, closes at once`, fakeAsync(() => {
        open();
        leave();

        expect(closed).toBe(1);
        expect(confirm.current()).toBeNull();
      }));

      it(`${name}: asks first, and "Seguir editando" leaves the panel open with the draft as it was`, fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        leave();

        expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
        expect(closed).toBe(0);

        answer(false);
        expect(closed).toBe(0);
        expect(description().value).toBe('No imprime desde el lunes');
        expect(unsaved()).toBeTrue();
        noPatch();
      }));

      it(`${name}: asks first, and "Descartar y salir" closes without saving anything`, fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        leave();

        answer(true);
        expect(closed).toBe(1);
        noPatch();
      }));
    }

    // The lists of the form hang from the body, and a press outside the panel is how one is put away.
    it('a press outside the panel with a list of options open closes the list, not the panel', fakeAsync(() => {
      open();
      openSelect(select('tp-priority'));
      render();
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

      click(find('div[aria-hidden=true]'));
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
      expect(closed).toBe(0);
      expect(confirm.current()).toBeNull();

      // With no list open, the same press closes the panel, as it always did.
      click(find('div[aria-hidden=true]'));
      expect(closed).toBe(1);
    }));

    // Discarding cannot be undone: Enter, pressed without reading, must not do it.
    it('asks with the focus on staying', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      pressEscape();

      expect(confirm.current()!.danger).toBeTrue();
    }));

    it('asks once, however many times the way out is taken while the question is on screen', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      pressEscape();
      pressEscape();
      click(find('button[aria-label="Cerrar"]'));

      answer(false);
      expect(confirm.current()).toBeNull();
      expect(closed).toBe(0);

      // Asked again the next time.
      pressEscape();
      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
      answer(true);
      expect(closed).toBe(1);
    }));

    // The promise switch turned on with no date yet, or a time half typed: nothing "Actualizar" could send, and still the person's.
    it('asks too for what is in the form and cannot be saved yet', fakeAsync(() => {
      open();
      turnPromise(true);
      pressEscape();

      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
      answer(false);
      expect(promiseSwitch().checked).toBeTrue();
    }));

    // The case was deleted somewhere else, or the screen under the panel closed it, while the
    // question was on screen: left there, it would ask about a form that is gone.
    it('takes its question with it when the panel goes away before the person answers', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      pressEscape();
      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));

      fixture.destroy();
      tick();
      expect(confirm.current()).toBeNull();
      expect(closed).toBe(0);
      noPatch();
    }));

    describe('another case given to the panel', () => {
      /** The cases the panel said it is on, to whoever gave it another one. */
      let stayedOn: number[];

      function editing(): void {
        open();
        stayedOn = [];
        fixture.componentInstance.ticketId.subscribe((id) => stayedOn.push(id));
        type(description(), 'No imprime desde el lunes');
      }

      it('asks first, and reads nothing of the other case meanwhile', fakeAsync(() => {
        editing();
        give(OTHER.id);

        expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
        http.expectNone({ method: 'GET', url: '/api/tickets/8' });
        expect(find('header').textContent).toContain('SOP-00007');
        expect(description().value).toBe('No imprime desde el lunes');
        answer(false);
      }));

      it('"Seguir editando" keeps the case and its draft, and tells whoever gave the other one which case is open', fakeAsync(() => {
        editing();
        give(OTHER.id);
        answer(false);

        expect(stayedOn).toEqual([7]);
        http.expectNone({ method: 'GET', url: '/api/tickets/8' });
        expect(find('header').textContent).toContain('SOP-00007');
        expect(description().value).toBe('No imprime desde el lunes');
        expect(unsaved()).toBeTrue();

        // The draft is still to be saved, to its own case.
        const sent = update();
        expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes' });
        sent.flush(ticket({ description: 'No imprime desde el lunes' }));
        settle();
      }));

      it('"Descartar y salir" goes on to the other case, with nothing of the draft', fakeAsync(() => {
        editing();
        give(OTHER.id);
        answer(true);
        read(OTHER.id).flush(OTHER);
        settle();

        expect(stayedOn).toEqual([]);
        expect(find('header').textContent).toContain('SOP-00008');
        expect(description().value).toBe('No abre la caja');
        expect(unsaved()).toBeFalse();
        noPatch();
      }));

      it('twice while the question is on screen: asked once, and it goes on to the last one given', fakeAsync(() => {
        editing();
        give(OTHER.id);
        give(9);
        answer(true);

        expect(confirm.current()).toBeNull();
        http.expectNone({ method: 'GET', url: '/api/tickets/8' });
        read(9).flush(ticket({ id: 9, code: 'SOP-00009' }));
        settle();
        expect(find('header').textContent).toContain('SOP-00009');
      }));
    });

    // The Back button of the browser, or of a phone, does not close the panel: it takes away the
    // screen the panel is on. That screen asks the panel first (see UnsavedChanges).
    describe('the screen under the panel being left', () => {
      /** Asks as the screen does before it goes. `allowed` is what it is told, once the panel has answered. */
      function leaveScreen(): { allowed?: boolean } {
        const outcome: { allowed?: boolean } = {};
        void TestBed.inject(UnsavedChanges)
          .mayLeave()
          .then((allowed) => (outcome.allowed = allowed));
        settle();
        return outcome;
      }

      it('is allowed at once with nothing unsaved', fakeAsync(() => {
        open();

        expect(leaveScreen().allowed).toBeTrue();
        expect(confirm.current()).toBeNull();
      }));

      it('asks first, and "Seguir editando" keeps the screen, the panel and the draft', fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        const leaving = leaveScreen();

        expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
        expect(leaving.allowed).toBeUndefined();
        answer(false);
        expect(leaving.allowed).toBeFalse();
        expect(description().value).toBe('No imprime desde el lunes');
        expect(closed).toBe(0);
      }));

      it('asks first, and "Descartar y salir" lets the screen go', fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        const leaving = leaveScreen();

        answer(true);
        expect(leaving.allowed).toBeTrue();
        noPatch();
      }));

      it('asks too for an observation typed and not added', fakeAsync(() => {
        open();
        type(noteBox(), 'Se llamó al cliente');
        const leaving = leaveScreen();

        expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
        answer(false);
        expect(leaving.allowed).toBeFalse();
        expect(noteBox().value).toBe('Se llamó al cliente');
      }));

      it('asks nothing once the panel is closed', fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        fixture.destroy();

        let allowed: boolean | undefined;
        void TestBed.inject(UnsavedChanges)
          .mayLeave()
          .then((result) => (allowed = result));
        // No screen is left to update.
        tick();
        expect(allowed).toBeTrue();
        expect(confirm.current()).toBeNull();
      }));
    });

    describe('closing or reloading the tab', () => {
      /** What the browser sends to the page before it goes. Prevented, the browser asks the person first. */
      function leaveTab(): Event {
        // The test runner listens for this event too, to complain about a page that reloads: not while the test sends its own.
        const runner = window.onbeforeunload;
        window.onbeforeunload = null;
        try {
          const event = new Event('beforeunload', { cancelable: true });
          window.dispatchEvent(event);
          return event;
        } finally {
          window.onbeforeunload = runner;
        }
      }

      it('makes the browser ask, with unsaved changes only', fakeAsync(() => {
        open();
        expect(leaveTab().defaultPrevented).toBeFalse();

        type(description(), 'No imprime desde el lunes');
        expect(leaveTab().defaultPrevented).toBeTrue();

        click(discard()!);
        expect(leaveTab().defaultPrevented).toBeFalse();

        // An observation typed and not added would be lost with the tab too.
        type(noteBox(), 'Se llamó al cliente');
        expect(leaveTab().defaultPrevented).toBeTrue();
      }));
    });

    // There is no case left to save the draft to.
    it('is not asked about when the case is deleted: the panel closes', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      events.removed(7);
      render();

      expect(closed).toBe(1);
      expect(confirm.current()).toBeNull();
    }));
  });

  describe('a change made elsewhere', () => {
    it('is followed silently by a form with nothing unsaved', fakeAsync(() => {
      open();
      events.outdated(7);
      read().flush(ticket({ description: 'Escrito por otra persona', status: 'RESOLVED', priority: 'HIGH', companyId: 5, company: 'Bodega Sur', supportTypes: [FAILURE] }));
      settle();

      expect(description().value).toBe('Escrito por otra persona');
      expect(chosen('tp-status')).toEqual(['Resuelto']);
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(chosen('tp-company')).toEqual(['Bodega Sur']);
      expect(chosen('tp-types')).toEqual(['Falla del sistema']);
      expect(notice()).toBeNull();
      expect(unsaved()).toBeFalse();
    }));

    describe('while the form has unsaved changes', () => {
      /** The person is changing the priority when someone else rewrites the description and resolves the case. */
      function changedUnderTheDraft(): void {
        open();
        pick('tp-priority', 'Alta');
        events.outdated(7);
        read().flush(ticket({ description: 'Escrito por otra persona', status: 'RESOLVED' }));
        settle();
      }

      it('leaves the whole form as the person sees it, and says that the case changed', fakeAsync(() => {
        changedUnderTheDraft();

        expect(notice()).not.toBeNull();
        expect(button('Ver la versión actual', notice()!).disabled).toBeFalse();
        expect(chosen('tp-priority')).toEqual(['Alta']);
        expect(description().value).toBe('No imprime');
        expect(chosen('tp-status')).toEqual(['Pendiente']);
        expect(unsaved()).toBeTrue();
        // What is not a field of the form shows the case as it is.
        expect(find('header .badge').textContent).toContain('Resuelto');
      }));

      it('"Ver la versión actual" drops the draft and shows the case as it is now', fakeAsync(() => {
        changedUnderTheDraft();
        click(button('Ver la versión actual'));

        expect(notice()).toBeNull();
        expect(chosen('tp-priority')).toEqual([]);
        expect(description().value).toBe('Escrito por otra persona');
        expect(chosen('tp-status')).toEqual(['Resuelto']);
        expect(unsaved()).toBeFalse();
        noPatch();
      }));

      it('"Descartar cambios" does the same', fakeAsync(() => {
        changedUnderTheDraft();
        click(discard()!);

        expect(notice()).toBeNull();
        expect(description().value).toBe('Escrito por otra persona');
        expect(chosen('tp-status')).toEqual(['Resuelto']);
      }));

      // Sent whole, the form would put back the description and the status someone else just changed.
      it('"Actualizar" sends only what the person changed, and the form then shows the stored case', fakeAsync(() => {
        changedUnderTheDraft();

        const sent = update();
        expect(sent.request.body).toEqual({ priority: 'HIGH' });
        sent.flush(ticket({ description: 'Escrito por otra persona', status: 'RESOLVED', priority: 'HIGH' }));
        settle();
        expect(notice()).toBeNull();
        expect(description().value).toBe('Escrito por otra persona');
        expect(chosen('tp-status')).toEqual(['Resuelto']);
        expect(chosen('tp-priority')).toEqual(['Alta']);
        expect(unsaved()).toBeFalse();
      }));

      it('keeps what the person wrote in the very field someone else changed', fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        events.outdated(7);
        read().flush(ticket({ description: 'Escrito por otra persona' }));
        settle();

        expect(description().value).toBe('No imprime desde el lunes');
        expect(notice()).not.toBeNull();

        // Theirs is saved over the other text only if they say so.
        const sent = update();
        expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes' });
        sent.flush(ticket({ description: 'No imprime desde el lunes' }));
        settle();
        expect(notice()).toBeNull();
      }));

      // An observation or a file added by someone else changes nothing the form edits.
      it('says nothing when the change is not in a field of the form, and shows it', fakeAsync(() => {
        open();
        pick('tp-priority', 'Alta');
        events.outdated(7);
        read().flush(ticket({ notes: [NOTE], notesCount: 1 }));
        settle();

        expect(notice()).toBeNull();
        expect(el.textContent).toContain('Se llamó al cliente');
        expect(chosen('tp-priority')).toEqual(['Alta']);
        expect(unsaved()).toBeTrue();
      }));

      // The save was stored and only its answer got lost, or someone else wrote the same.
      it('has nothing left to save once the case arrives with what the form holds', fakeAsync(() => {
        open();
        type(description(), 'No imprime desde el lunes');
        update().error(new ProgressEvent('error'));
        settle();
        expect(unsaved()).toBeTrue();

        events.outdated(7);
        read().flush(ticket({ description: 'No imprime desde el lunes' }));
        settle();
        expect(description().value).toBe('No imprime desde el lunes');
        expect(unsaved()).toBeFalse();
        expect(notice()).toBeNull();
        expect(save().disabled).toBeTrue();
      }));

      // An observation added from the panel is answered with the case as it is now. The form is still the person's.
      it('stays as the person sees it, with its notice, through what they do on the case meanwhile', fakeAsync(() => {
        changedUnderTheDraft();
        type(noteBox(), 'Se llamó al cliente');
        click(button('Agregar'));
        http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' }).flush(ticket({ description: 'Escrito por otra persona', status: 'RESOLVED', notes: [NOTE], notesCount: 1 }));
        settle();

        expect(el.textContent).toContain('Se llamó al cliente');
        expect(notice()).not.toBeNull();
        expect(description().value).toBe('No imprime');
        expect(chosen('tp-status')).toEqual(['Pendiente']);
        expect(chosen('tp-priority')).toEqual(['Alta']);
      }));

      it('cannot be looked at while a save is on its way: its answer shows it', fakeAsync(() => {
        changedUnderTheDraft();
        const sent = update();

        expect(button('Ver la versión actual', notice()!).disabled).toBeTrue();
        sent.flush(ticket({ description: 'Escrito por otra persona', status: 'RESOLVED', priority: 'HIGH' }));
        settle();
        expect(notice()).toBeNull();
      }));
    });
  });

  describe('a re-read after someone else changed the case', () => {
    it('that fails leaves the panel open with the case it shows', fakeAsync(() => {
      open();
      events.outdated(7);
      read().error(new ProgressEvent('error'));
      settle();
      expect(closed).toBe(0);
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
      expect(description().value).toBe('No imprime');
    }));

    // The read may have been taken before the save was stored. Shown, it would undo the save on
    // screen; dropped, the note that asked for the read would be lost.
    it('does not replace a save answered while it was on its way, and is asked for again', fakeAsync(() => {
      open();
      events.outdated(7);
      const stale = read();

      pick('tp-priority', 'Alta');
      update().flush(ticket({ priority: 'HIGH' }));
      settle();

      stale.flush(ticket({ notes: [NOTE], notesCount: 1 }));
      settle();
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeFalse();

      read().flush(ticket({ priority: 'HIGH', notes: [NOTE], notesCount: 1 }));
      settle();
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(el.textContent).toContain('Se llamó al cliente');

      // The stored case is the newest one too: a discarded change goes back to it.
      pick('tp-priority', 'Baja');
      click(discard()!);
      expect(chosen('tp-priority')).toEqual(['Alta']);
    }));

    it('is dropped when a newer one was asked for and answered first', fakeAsync(() => {
      open();
      events.outdated(7);
      const older = read();
      events.outdated(7);
      const newer = read();

      newer.flush(ticket({ description: 'Nueva' }));
      settle();
      older.flush(ticket({ description: 'Vieja' }));
      settle();
      expect(description().value).toBe('Nueva');
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

  // The first read is one more read: numbered with the re-reads, and compared with the saves.
  describe('the first read of the case', () => {
    it('answered after a save of that case was shown: does not undo it, and the case is read again', fakeAsync(() => {
      create(7);
      const first = read();
      events.saved(ticket({ priority: 'HIGH' }));
      render();
      expect(chosen('tp-priority')).toEqual(['Alta']);

      first.flush(ticket());
      settle();
      expect(chosen('tp-priority')).toEqual(['Alta']);

      read().flush(ticket({ priority: 'HIGH', description: 'No imprime desde el lunes' }));
      settle();
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(description().value).toBe('No imprime desde el lunes');
    }));

    it('answered after a newer read was shown: is dropped', fakeAsync(() => {
      create(7);
      events.outdated(7);
      const [first, newer] = reads();

      newer.flush(ticket({ description: 'Nueva' }));
      settle();
      first.flush(ticket({ description: 'Vieja' }));
      settle();
      expect(description().value).toBe('Nueva');
    }));

    // What the first read is there for is done by whichever read shows the case first.
    it('replaced by a newer read: that one drafts the reply the panel was opened for, once', fakeAsync(() => {
      catalogs.aiReady.set(true);
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

    // A save made from the board can be answered before the first read of the panel: the case is
    // then on screen, and a read that fails says nothing about it.
    it('failed after a save already put the case on screen: the panel stays open', fakeAsync(() => {
      create(7);
      events.saved(ticket({ status: 'UNRESOLVED' }));
      render();
      expect(description().value).toBe('No imprime');

      for (const request of reads()) request.flush(null, { status: 500, statusText: 'Server Error' });
      settle();
      for (const request of reads()) request.flush(null, { status: 500, statusText: 'Server Error' });
      settle();

      expect(closed).toBe(0);
      expect(description().value).toBe('No imprime');
    }));
  });

  // What is not a field of the case has its own button, and is done the moment it is pressed.
  describe('the observations', () => {
    it('are added at once, and the draft of the form stays as it was', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      type(noteBox(), ' Se llamó al cliente ');
      click(button('Agregar'));

      const add = http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' });
      expect(add.request.body).toEqual({ text: 'Se llamó al cliente' });
      expect(noteBox().value).toBe('');
      add.flush(ticket({ notes: [NOTE], notesCount: 1 }));
      settle();

      expect(el.textContent).toContain('Se llamó al cliente');
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeTrue();
      expect(notice()).toBeNull();
      noPatch();
    }));

    it('that could not be added go back into their box, to be sent again', fakeAsync(() => {
      open();
      type(noteBox(), ' Se llamó al cliente ');
      click(button('Agregar'));
      const add = http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' });
      expect(noteBox().value).toBe('');

      add.error(new ProgressEvent('error'));
      settle();
      expect(noteBox().value).toBe('Se llamó al cliente');
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
    }));

    it('are deleted once the person confirms it in the dialog', fakeAsync(() => {
      open(ticket({ notes: [NOTE], notesCount: 1 }));
      click(find('button[aria-label="Eliminar observación"]'));

      expect(confirm.current()).toEqual(jasmine.objectContaining({ title: '¿Eliminar esta observación?', confirmLabel: 'Eliminar', danger: true }));
      http.expectNone({ method: 'DELETE', url: '/api/tickets/7/notes/1' });

      answer(true);
      http.expectOne({ method: 'DELETE', url: '/api/tickets/7/notes/1' }).flush(ticket());
      settle();
      expect(el.textContent).toContain('Sin observaciones.');
    }));

    it('stay when the person cancels the question', fakeAsync(() => {
      open(ticket({ notes: [NOTE], notesCount: 1 }));
      click(find('button[aria-label="Eliminar observación"]'));
      answer(false);

      http.expectNone({ method: 'DELETE', url: '/api/tickets/7/notes/1' });
      expect(el.textContent).toContain('Se llamó al cliente');
    }));

    // Typed for the case that is left: carried along, it would be added to another one.
    it('typed and not added do not follow the panel to another case: the person is asked, and it is left behind', fakeAsync(() => {
      open();
      type(noteBox(), 'Llamar mañana al cliente');
      expect(noteBox().value).toBe('Llamar mañana al cliente');

      give(OTHER.id);
      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
      answer(true);
      read(OTHER.id).flush(OTHER);
      settle();

      expect(noteBox().value).toBe('');
      expect(button('Agregar').disabled).toBeTrue();
      http.expectNone({ method: 'POST', url: '/api/tickets/7/notes' });
    }));
  });

  // Whoever presses "Actualizar" takes the whole form for saved, the observation they typed
  // too. It used to stay in its box, and was lost on the way out without a question.
  describe('an observation typed and not added with its button', () => {
    const TYPED = 'Se reinició el servicio';
    const noted = { notes: [{ ...NOTE, text: TYPED }], notesCount: 1 };
    const noteAdd = (): TestRequest => http.expectOne({ method: 'POST', url: '/api/tickets/7/notes' });
    const noNoteAdd = (): void => http.expectNone({ method: 'POST', url: '/api/tickets/7/notes' });

    it('counts as an unsaved change: "Actualizar" can be pressed, and the form says so', fakeAsync(() => {
      open();
      expect(save().disabled).toBeTrue();

      type(noteBox(), TYPED);
      expect(save().disabled).toBeFalse();
      expect(unsaved()).toBeTrue();
      expect(discard()).not.toBeNull();
      // Typing it sends nothing, however long it stays there.
      wait(60_000);
      noNoteAdd();

      // Spaces are not an observation.
      type(noteBox(), '   ');
      expect(save().disabled).toBeTrue();
      expect(unsaved()).toBeFalse();
    }));

    it('is added by "Actualizar", with no save of the case when nothing else changed', fakeAsync(() => {
      open();
      type(noteBox(), ` ${TYPED} `);
      click(save());

      noPatch();
      const add = noteAdd();
      expect(add.request.body).toEqual({ text: TYPED });
      expect(save().disabled).toBeTrue();
      expect(save().textContent).toContain('Guardando…');
      add.flush(ticket(noted));
      settle();

      expect(toasts()).toEqual(['Caso actualizado']);
      expect(noteBox().value).toBe('');
      expect(find('ul li p').textContent).toBe(TYPED);
      expect(unsaved()).toBeFalse();
      expect(save().textContent).toContain('Actualizar');
    }));

    it('is added after the fields that changed: first the save of the case, then the observation', fakeAsync(() => {
      open();
      pick('tp-status', 'Sin resolver');
      type(noteBox(), TYPED);

      const sent = update();
      expect(sent.request.body).toEqual({ status: 'UNRESOLVED' });
      // Not before the case is stored.
      noNoteAdd();
      sent.flush(ticket({ status: 'UNRESOLVED' }));
      settle();

      const add = noteAdd();
      expect(add.request.body).toEqual({ text: TYPED });
      // One "Actualizar" for the person: its button waits for both.
      expect(save().textContent).toContain('Guardando…');
      add.flush(ticket({ status: 'UNRESOLVED', ...noted }));
      settle();

      expect(toasts()).toEqual(['Caso actualizado']);
      expect(find('header .badge').textContent).toContain('Sin resolver');
      expect(noteBox().value).toBe('');
      expect(unsaved()).toBeFalse();
      noPatch();
    }));

    // What used to lose the text: written, the case resolved with "Actualizar", and the panel closed.
    it('saved with "Actualizar", lets the panel close at once: nothing is left to lose', fakeAsync(() => {
      open();
      pick('tp-status', 'Resuelto');
      type(noteBox(), TYPED);
      update().flush(ticket({ status: 'RESOLVED' }));
      settle();
      noteAdd().flush(ticket({ status: 'RESOLVED', ...noted }));
      settle();

      pressEscape();
      expect(confirm.current()).toBeNull();
      expect(closed).toBe(1);
    }));

    it('is not sent when the save of the case is refused: the draft and the text stay, to be sent again', fakeAsync(() => {
      open();
      pick('tp-status', 'Sin resolver');
      type(noteBox(), TYPED);
      update().flush({ message: 'No se pudo guardar' }, REFUSED);
      settle();

      noNoteAdd();
      expect(toasts()).toEqual(['No se pudo guardar']);
      expect(noteBox().value).toBe(TYPED);
      expect(chosen('tp-status')).toEqual(['Sin resolver']);
      expect(unsaved()).toBeTrue();

      // Sent again, both go, in the same order.
      update().flush(ticket({ status: 'UNRESOLVED' }));
      settle();
      noteAdd().flush(ticket({ status: 'UNRESOLVED', ...noted }));
      settle();
      expect(unsaved()).toBeFalse();
    }));

    it('that could not be added: the fields stay saved, the text stays in its box, and the form still has it to save', fakeAsync(() => {
      open();
      pick('tp-status', 'Sin resolver');
      type(noteBox(), TYPED);
      update().flush(ticket({ status: 'UNRESOLVED' }));
      settle();
      noteAdd().error(new ProgressEvent('error'));
      settle();

      // Each said as what it is.
      expect(toasts()).toEqual(['Caso actualizado', 'No se pudo agregar la observación: No hay conexión con el servidor']);
      expect(find('header .badge').textContent).toContain('Sin resolver');
      expect(chosen('tp-status')).toEqual(['Sin resolver']);
      expect(noteBox().value).toBe(TYPED);
      expect(unsaved()).toBeTrue();
      expect(save().disabled).toBeFalse();
      pressEscape();
      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
      answer(false);

      // "Actualizar" again sends what is left: the observation alone.
      click(save());
      noPatch();
      noteAdd().flush(ticket({ status: 'UNRESOLVED', ...noted }));
      settle();
      expect(noteBox().value).toBe('');
      expect(unsaved()).toBeFalse();
    }));

    it('is asked about on the way out, like the draft, and goes with "Descartar y salir"', fakeAsync(() => {
      open();
      type(noteBox(), TYPED);

      pressEscape();
      expect(confirm.current()).toEqual(jasmine.objectContaining(LEAVE));
      answer(false);
      expect(closed).toBe(0);
      expect(noteBox().value).toBe(TYPED);

      click(find('button[aria-label="Cerrar"]'));
      answer(true);
      expect(closed).toBe(1);
      noNoteAdd();
    }));

    it('"Descartar cambios" empties it too, and sends nothing', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      type(noteBox(), TYPED);
      click(discard()!);

      expect(noteBox().value).toBe('');
      expect(description().value).toBe('No imprime');
      expect(unsaved()).toBeFalse();
      expect(save().disabled).toBeTrue();
      noPatch();
      noNoteAdd();
    }));

    it('"Agregar" still adds it at once, and "Actualizar" then has only the fields to save', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      type(noteBox(), TYPED);
      click(button('Agregar'));
      noteAdd().flush(ticket(noted));
      settle();
      expect(noteBox().value).toBe('');
      expect(unsaved()).toBeTrue();

      const sent = update();
      expect(sent.request.body).toEqual({ priority: 'HIGH' });
      sent.flush(ticket({ priority: 'HIGH', ...noted }));
      settle();
      noNoteAdd();
      expect(unsaved()).toBeFalse();
    }));

    it('added with its own button while the case is being saved is not added twice', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      type(noteBox(), TYPED);
      const sent = update();
      click(button('Agregar'));
      const add = noteAdd();

      sent.flush(ticket({ priority: 'HIGH' }));
      settle();
      noNoteAdd();
      add.flush(ticket({ priority: 'HIGH', ...noted }));
      settle();
      expect(noteBox().value).toBe('');
      expect(unsaved()).toBeFalse();
    }));

    // Sent as it was when the button was pressed, it would be cut where the person was by then.
    it('written on while the case is being saved stays in its box, still to be added', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      type(noteBox(), 'Se reinició');
      const sent = update();
      type(noteBox(), 'Se reinició el servicio');

      sent.flush(ticket({ priority: 'HIGH' }));
      settle();
      noNoteAdd();
      expect(noteBox().value).toBe('Se reinició el servicio');
      expect(unsaved()).toBeTrue();
      expect(save().disabled).toBeFalse();
    }));

    // It is not a field of the case: nothing of the case is held back for it.
    it('does not keep the form from following a change made elsewhere, and stays in its box', fakeAsync(() => {
      open();
      type(noteBox(), TYPED);
      events.outdated(7);
      read().flush(ticket({ description: 'Escrito por otra persona' }));
      settle();

      expect(description().value).toBe('Escrito por otra persona');
      expect(notice()).toBeNull();
      expect(noteBox().value).toBe(TYPED);
      expect(unsaved()).toBeTrue();
    }));

    // "Ver la versión actual" is about the fields of the case. The observation is still to add.
    it('stays when the person asks to see the case as it changed elsewhere', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      type(noteBox(), TYPED);
      events.outdated(7);
      read().flush(ticket({ description: 'Escrito por otra persona' }));
      settle();
      click(button('Ver la versión actual'));

      expect(description().value).toBe('Escrito por otra persona');
      expect(noteBox().value).toBe(TYPED);
      expect(unsaved()).toBeTrue();
    }));

    describe('and the reply for the client', () => {
      const reply = { method: 'POST', url: '/api/ai/reply/7' };
      beforeEach(() => catalogs.aiReady.set(true));

      // The observation often says what was done, and the AI writes with the observations of the case.
      it('of a case resolved by the same "Actualizar": the reply is drafted once the observation is added', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');
        type(noteBox(), TYPED);
        update().flush(ticket({ status: 'RESOLVED' }));
        settle();
        http.expectNone(reply);

        noteAdd().flush(ticket({ status: 'RESOLVED', ...noted }));
        settle();
        http.expectOne(reply).flush(ticket({ status: 'RESOLVED', ...noted, customerReply: 'Estimado cliente: se reinició el servicio.' }));
        settle();
        expect(replyBox().value).toBe('Estimado cliente: se reinició el servicio.');
        expect(unsaved()).toBeFalse();
      }));

      it('of a case resolved by the same "Actualizar": the reply is drafted all the same when the observation could not be added', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');
        type(noteBox(), TYPED);
        update().flush(ticket({ status: 'RESOLVED' }));
        settle();
        noteAdd().error(new ProgressEvent('error'));
        settle();

        http.expectOne(reply).flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: listo.' }));
        settle();
        expect(noteBox().value).toBe(TYPED);
      }));

      it('"Generar con IA" waits for it to be added or discarded, as for the draft', fakeAsync(() => {
        open();
        type(noteBox(), TYPED);

        expect(button('Generar con IA').disabled).toBeTrue();
        expect(button('Generar con IA').title).toBe('Actualiza o descarta los cambios primero: la IA redacta con el caso guardado');
        click(discard()!);
        expect(button('Generar con IA').disabled).toBeFalse();
      }));
    });
  });

  // It runs on the stored case: nothing of the draft is sent with it, and it does not wait for the draft.
  describe('the timer', () => {
    const running = ticket({ spentMinutes: 10, timerStartedAt: '2026-11-06T09:00:00.000Z' });

    it('starts at once, also with unsaved changes, which stay as they were', fakeAsync(() => {
      open(ticket({ spentMinutes: 10 }));
      expect(el.textContent).toContain('Acumulado: 10 min');
      type(description(), 'No imprime desde el lunes');
      click(button('Iniciar cronómetro'));

      const start = http.expectOne({ method: 'POST', url: '/api/tickets/7/timer/start' });
      expect(start.request.body).toBeNull();
      start.flush(running);
      settle();

      expect(el.textContent).toContain('En marcha desde');
      expect(description().value).toBe('No imprime desde el lunes');
      expect(unsaved()).toBeTrue();
      expect(notice()).toBeNull();
      noPatch();
    }));

    it('stops at once, and the time it ran shows in the form without becoming a change to save', fakeAsync(() => {
      open(running);
      type(description(), 'No imprime desde el lunes');
      click(button('Detener cronómetro'));

      http.expectOne({ method: 'POST', url: '/api/tickets/7/timer/stop' }).flush(ticket({ spentMinutes: 22 }));
      settle();
      expect(el.textContent).toContain('Acumulado: 22 min');
      expect(spent().value).toBe('22');

      // Only what the person changed is still to be saved.
      const sent = update();
      expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes' });
      sent.flush(ticket({ description: 'No imprime desde el lunes', spentMinutes: 22 }));
      settle();
    }));

    // Stopped, it adds the minutes that ran to the time of the case. The draft, saved after it, would write its own number over that sum.
    it('cannot be stopped while "Real (minutos)" has an unsaved change, and says why', fakeAsync(() => {
      open(running);
      type(spent(), '45');

      expect(button('Detener cronómetro').disabled).toBeTrue();
      expect(el.textContent).toContain('Actualiza o descarta el cambio en «Real (minutos)» para detenerlo.');
      // A press that reaches it all the same.
      fire(button('Detener cronómetro'), 'click');
      http.expectNone({ method: 'POST', url: '/api/tickets/7/timer/stop' });

      click(discard()!);
      expect(button('Detener cronómetro').disabled).toBeFalse();
      expect(el.textContent).toContain('En marcha desde');
    }));

    it('can be started with that same change unsaved: starting writes no minutes', fakeAsync(() => {
      open(ticket({ spentMinutes: 10 }));
      type(spent(), '45');

      expect(button('Iniciar cronómetro').disabled).toBeFalse();
      click(button('Iniciar cronómetro'));
      http.expectOne({ method: 'POST', url: '/api/tickets/7/timer/start' }).flush(running);
      settle();
      expect(spent().value).toBe('45');
      expect(unsaved()).toBeTrue();
    }));

    // The server refuses it. What counts is the case as it is stored, not the status chosen in the draft.
    it('cannot be started on a case that is stored as resolved', fakeAsync(() => {
      open(ticket({ status: 'RESOLVED' }));
      expect(button('Iniciar cronómetro').disabled).toBeTrue();

      pick('tp-status', 'Pendiente');
      expect(button('Iniciar cronómetro').disabled).toBeTrue();
    }));

    it('that could not be started says why', fakeAsync(() => {
      open();
      click(button('Iniciar cronómetro'));
      http.expectOne({ method: 'POST', url: '/api/tickets/7/timer/start' }).flush({ message: 'El caso ya está resuelto' }, REFUSED);
      settle();

      expect(toasts()).toEqual(['El caso ya está resuelto']);
      expect(el.textContent).toContain('Acumulado: 0 min');
    }));
  });

  describe('the attachments and the history', () => {
    const picture = { id: 3, filename: 'captura.png', mime: 'image/png', size: 2048, createdAt: '2026-11-06T09:00:00.000Z' };

    it('files dropped anywhere on the panel are uploaded at once, and the draft stays as it was', fakeAsync(() => {
      open();
      pick('tp-priority', 'Alta');
      const dropped = new DataTransfer();
      dropped.items.add(new File(['png'], 'captura.png', { type: 'image/png' }));
      const drop = new DragEvent('drop', { dataTransfer: dropped, cancelable: true });
      find('aside').dispatchEvent(drop);
      render();

      // Not prevented, the browser would open the file in place of the app.
      expect(drop.defaultPrevented).toBeTrue();
      const upload = http.expectOne({ method: 'POST', url: '/api/tickets/7/attachments' });
      expect((upload.request.body as FormData).getAll('files').map((file) => (file as File).name)).toEqual(['captura.png']);
      upload.flush(ticket({ attachments: [picture], attachmentsCount: 1 }));
      settle();
      http.expectOne({ method: 'GET', url: '/api/attachments/3' }).flush(new Blob(['png'], { type: 'image/png' }));
      settle();

      expect(el.textContent).toContain('captura.png');
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeTrue();
      noPatch();
    }));

    it('Escape closes an enlarged picture first, and the panel after it', fakeAsync(() => {
      open(ticket({ attachments: [picture], attachmentsCount: 1 }));
      http.expectOne({ method: 'GET', url: '/api/attachments/3' }).flush(new Blob(['png'], { type: 'image/png' }));
      settle();
      click(find('button[title="captura.png"]'));
      expect(el.querySelector('button[aria-label="Cerrar imagen"]')).not.toBeNull();

      pressEscape();
      expect(el.querySelector('button[aria-label="Cerrar imagen"]')).toBeNull();
      expect(closed).toBe(0);

      pressEscape();
      expect(closed).toBe(1);
    }));

    it('the history tells every change of the case, with who made it', fakeAsync(() => {
      open(
        ticket({
          history: [
            { id: 2, field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación, Falla del sistema', userName: 'Ana Torres', createdAt: '2026-11-06T09:00:00.000Z' },
            { id: 1, field: 'Descripción', oldValue: null, newValue: null, userName: null, createdAt: '2026-11-05T12:00:00.000Z' },
          ],
        }),
      );
      const lines = Array.from(el.querySelectorAll('details li')).map((line) => line.textContent?.replace(/\s+/g, ' ').trim() ?? '');

      expect(find('details summary').textContent).toContain('Historial de cambios (2)');
      expect(lines[0]).toContain('Ana Torres: Tipos de soporte de «—» a «Capacitación, Falla del sistema»');
      expect(lines[1]).toContain('Sistema: Descripción modificada');
    }));
  });

  describe('"Archivar" and "Desarchivar"', () => {
    const archived = ticket({ archivedAt: '2026-11-07T15:00:00.000Z' });

    it('archives the case at once, with no question, and says so', fakeAsync(() => {
      open();
      expect(find('header').textContent).not.toContain('Archivado');
      click(button('Archivar'));

      const sent = patch();
      // Alone: sent with anything else, the server would count it as work on the case.
      expect(sent.request.body).toEqual({ archived: true });
      expect(confirm.current()).toBeNull();
      expect(button('Archivar').disabled).toBeTrue();
      sent.flush(archived);
      settle();

      expect(toasts()).toEqual(['Caso archivado']);
      expect(find('header').textContent).toContain('Archivado');
      expect(button('Desarchivar').disabled).toBeFalse();
      // The panel stays open: the same button brings the case back.
      expect(closed).toBe(0);
    }));

    it('brings an archived case back', fakeAsync(() => {
      open(archived);
      expect(find('header').textContent).toContain('Archivado');
      click(button('Desarchivar'));

      const sent = patch();
      expect(sent.request.body).toEqual({ archived: false });
      sent.flush(ticket());
      settle();
      expect(toasts()).toEqual(['Caso desarchivado']);
      expect(find('header').textContent).not.toContain('Archivado');
      expect(button('Archivar')).toBeTruthy();
    }));

    it('sends nothing of the draft, which stays to be saved or discarded', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      click(button('Archivar'));
      const archive = patch();
      expect(archive.request.body).toEqual({ archived: true });
      archive.flush(archived);
      settle();

      expect(description().value).toBe('No imprime desde el lunes');
      expect(unsaved()).toBeTrue();
      expect(notice()).toBeNull();

      const sent = update();
      expect(sent.request.body).toEqual({ description: 'No imprime desde el lunes' });
      sent.flush({ ...archived, description: 'No imprime desde el lunes' });
      settle();
      expect(find('header').textContent).toContain('Archivado');
    }));

    it('that the server refuses says why, and the case is as it was', fakeAsync(() => {
      open();
      click(button('Archivar'));
      patch().flush({ message: 'No se pudo archivar' }, REFUSED);
      settle();

      expect(toasts()).toEqual(['No se pudo archivar']);
      expect(find('header').textContent).not.toContain('Archivado');
      expect(button('Archivar').disabled).toBeFalse();
    }));

    // The same button does both. On a fast server it already says "Desarchivar" when the
    // second click of a double click arrives.
    it('pressed with a double click archives the case once: the second click does not bring it back', fakeAsync(() => {
      /** A click as the browser reports it: `count` is 2 for the second one of a double click. */
      function press(target: HTMLElement, count: number): void {
        target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: count }));
        render();
      }
      open();
      press(button('Archivar'), 1);
      patch().flush(archived);
      settle();
      press(button('Desarchivar'), 2);

      noPatch();
      expect(toasts()).toEqual(['Caso archivado']);
      expect(find('header').textContent).toContain('Archivado');

      // A click of its own brings the case back.
      press(button('Desarchivar'), 1);
      const sent = patch();
      expect(sent.request.body).toEqual({ archived: false });
      sent.flush(ticket());
      settle();
      expect(find('header').textContent).not.toContain('Archivado');
    }));
  });

  describe('"Eliminar caso"', () => {
    const remove = { method: 'DELETE', url: '/api/tickets/7' };

    it('asks in the dialog of the app, naming the case and what goes with it', fakeAsync(() => {
      open();
      click(button('Eliminar caso'));

      expect(confirm.current()).toEqual(
        jasmine.objectContaining({
          title: '¿Eliminar el caso SOP-00007?',
          message: 'Se eliminan también sus observaciones y adjuntos. No se puede deshacer.',
          confirmLabel: 'Eliminar',
          danger: true,
        }),
      );
      http.expectNone(remove);
      answer(false);
    }));

    it('confirmed, deletes the case, says so and closes the panel', fakeAsync(() => {
      open();
      click(button('Eliminar caso'));
      answer(true);

      http.expectOne(remove).flush(null);
      settle();
      expect(toasts()).toEqual(['Caso SOP-00007 eliminado']);
      expect(closed).toBe(1);
    }));

    it('cancelled, deletes nothing and leaves the panel as it was', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      click(button('Eliminar caso'));
      answer(false);

      http.expectNone(remove);
      expect(closed).toBe(0);
      expect(description().value).toBe('No imprime desde el lunes');
    }));

    it('with unsaved changes asks about the case only: the draft goes with it', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      click(button('Eliminar caso'));
      answer(true);
      http.expectOne(remove).flush(null);
      settle();

      expect(confirm.current()).toBeNull();
      expect(closed).toBe(1);
      noPatch();
    }));

    it('that the server refuses says why, and the panel stays open', fakeAsync(() => {
      open();
      click(button('Eliminar caso'));
      answer(true);
      http.expectOne(remove).flush({ message: 'No se pudo eliminar' }, { status: 500, statusText: 'Server Error' });
      settle();

      expect(toasts()).toEqual(['No se pudo eliminar']);
      expect(closed).toBe(0);
    }));

    // The question is about the case that was on screen when it was asked.
    it('answered after the panel moved on to another case, deletes nothing', fakeAsync(() => {
      open();
      click(button('Eliminar caso'));
      moveTo(OTHER);
      answer(true);

      http.expectNone((request) => request.method === 'DELETE');
      expect(closed).toBe(0);
    }));
  });

  describe('the reply for the client', () => {
    const reply = { method: 'POST', url: '/api/ai/reply/7' };
    beforeEach(() => catalogs.aiReady.set(true));

    it('is written like any other field, and saved with "Actualizar"', fakeAsync(() => {
      open();
      expect(button('Copiar').disabled).toBeTrue();
      type(replyBox(), ' Ya puede imprimir. ');
      // What is in the box can be copied before it is saved.
      expect(button('Copiar').disabled).toBeFalse();
      wait(5000);
      noPatch();

      const sent = update();
      expect(sent.request.body).toEqual({ customerReply: 'Ya puede imprimir.' });
      sent.flush(ticket({ customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya puede imprimir.');
    }));

    it('emptied, is saved as none, and there is nothing left to copy', fakeAsync(() => {
      open(ticket({ customerReply: 'Ya puede imprimir.' }));
      type(replyBox(), '  ');
      expect(button('Copiar').disabled).toBeTrue();

      const sent = update();
      expect(sent.request.body).toEqual({ customerReply: null });
      sent.flush(ticket());
      settle();
      expect(replyBox().value).toBe('');
    }));

    describe('"Generar con IA"', () => {
      it('asks nothing when the case has no message, and shows the one the AI writes', fakeAsync(() => {
        open();
        click(button('Generar con IA'));

        expect(confirm.current()).toBeNull();
        expect(button('Redactando').disabled).toBeTrue();
        http.expectOne(reply).flush(ticket({ customerReply: 'Estimado cliente: listo.' }));
        settle();
        expect(replyBox().value).toBe('Estimado cliente: listo.');
        // The server stored it with the case: nothing is left to save.
        expect(unsaved()).toBeFalse();
        expect(button('Volver a generar').disabled).toBeFalse();
      }));

      it('asks before replacing the message the case has, and leaves it when the answer is no', fakeAsync(() => {
        open(ticket({ customerReply: 'Ya puede imprimir.' }));
        click(button('Volver a generar'));

        expect(confirm.current()).toEqual(jasmine.objectContaining({ title: '¿Reemplazar la respuesta actual por una nueva?', confirmLabel: 'Reemplazar' }));
        http.expectNone(reply);
        answer(false);
        http.expectNone(reply);
        expect(replyBox().value).toBe('Ya puede imprimir.');
      }));

      it('replaces the message the case has when the answer is yes', fakeAsync(() => {
        open(ticket({ customerReply: 'Ya puede imprimir.' }));
        click(button('Volver a generar'));
        answer(true);

        http.expectOne(reply).flush(ticket({ customerReply: 'Estimado cliente: ya puede imprimir.' }));
        settle();
        expect(replyBox().value).toBe('Estimado cliente: ya puede imprimir.');
        expect(unsaved()).toBeFalse();
      }));

      // The AI writes from the case as it is stored, and stores its message in it: it would
      // leave out what the person is changing, and they would not know.
      it('waits for the draft to be saved or discarded: with unsaved changes it cannot be pressed, and says why', fakeAsync(() => {
        open();
        const generate = (): HTMLButtonElement => button('Generar con IA');
        expect(generate().disabled).toBeFalse();
        expect(generate().title).toBe('Redacta el mensaje con el caso y sus observaciones');

        type(description(), 'No imprime desde el lunes');
        expect(generate().disabled).toBeTrue();
        expect(generate().title).toBe('Actualiza o descarta los cambios primero: la IA redacta con el caso guardado');
        expect(el.textContent).toContain('Para redactarlo con IA, actualiza o descarta antes los cambios: la IA lee el caso guardado.');
        // A press that reaches it all the same.
        fire(generate(), 'click');
        http.expectNone(reply);

        click(discard()!);
        expect(generate().disabled).toBeFalse();
        expect(el.textContent).not.toContain('Para redactarlo con IA');
      }));

      it('cannot be pressed, and says where to turn it on, when no AI provider is active', fakeAsync(() => {
        catalogs.aiReady.set(false);
        open();

        expect(button('Generar con IA').disabled).toBeTrue();
        expect(button('Generar con IA').title).toBe('Activa un proveedor en Configuración > IA');
      }));

      it('that the AI could not write says why, and can be asked for again', fakeAsync(() => {
        open();
        click(button('Generar con IA'));
        http.expectOne(reply).flush({ message: 'El proveedor de IA no respondió' }, { status: 502, statusText: 'Bad Gateway' });
        settle();

        expect(toasts()).toEqual(['El proveedor de IA no respondió']);
        expect(button('Generar con IA').disabled).toBeFalse();
      }));
    });

    describe('drafted on its own when a case is resolved', () => {
      it('is asked for once the case is saved as resolved, not when the status is only chosen', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');
        wait(5000);
        http.expectNone(reply);

        update().flush(ticket({ status: 'RESOLVED' }));
        settle();
        expect(button('Redactando').disabled).toBeTrue();
        http.expectOne(reply).flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: ya puede imprimir.' }));
        settle();
        expect(replyBox().value).toBe('Estimado cliente: ya puede imprimir.');
        expect(unsaved()).toBeFalse();
      }));

      it('is not asked for when the case is saved with a message the person wrote', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');
        type(replyBox(), 'Ya puede imprimir.');

        update().flush(ticket({ status: 'RESOLVED', customerReply: 'Ya puede imprimir.' }));
        settle();
        http.expectNone(reply);
      }));

      it('is not asked for when the save is refused', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');

        update().flush({ message: 'No se puede resolver' }, REFUSED);
        settle();
        http.expectNone(reply);
        expect(chosen('tp-status')).toEqual(['Resuelto']);
        expect(find('header .badge').textContent).toContain('Pendiente');
      }));

      // The person may be writing their own meanwhile: nobody asked for the draft to take its place.
      it('leaves alone what the person is writing in the box, which is still theirs to save', fakeAsync(() => {
        open();
        pick('tp-status', 'Resuelto');
        update().flush(ticket({ status: 'RESOLVED' }));
        settle();
        const draft = http.expectOne(reply);
        type(replyBox(), 'Ya puede imprimir.');

        draft.flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: ya puede imprimir.' }));
        settle();
        expect(replyBox().value).toBe('Ya puede imprimir.');
        expect(unsaved()).toBeTrue();

        const sent = update();
        expect(sent.request.body).toEqual({ customerReply: 'Ya puede imprimir.' });
        sent.flush(ticket({ status: 'RESOLVED', customerReply: 'Ya puede imprimir.' }));
        settle();
        expect(replyBox().value).toBe('Ya puede imprimir.');
      }));

      // Dropped on "Resuelto" in the board: the panel opens to draft the message.
      it('is asked for on opening a case that was just resolved elsewhere, unless it has a message', fakeAsync(() => {
        create(7, true);
        read().flush(ticket({ status: 'RESOLVED' }));
        settle();
        http.expectOne(reply).flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: listo.' }));
        settle();
        expect(replyBox().value).toBe('Estimado cliente: listo.');

        fixture.destroy();
        create(7, true);
        read().flush(ticket({ status: 'RESOLVED', customerReply: 'Estimado cliente: listo.' }));
        settle();
        http.expectNone(reply);
      }));
    });
  });

  // `?caso=8` gives an open panel another case while requests of the first one are unanswered.
  describe('an answer that arrives after the panel moved on to another case', () => {
    /** Leaves case 7, with its draft, for the other one. */
    function leaveFor(stored: TicketDetail): void {
      give(stored.id);
      answer(true);
      read(stored.id).flush(stored);
      settle();
    }

    it('of the first read: is not shown', fakeAsync(() => {
      create(7);
      const left = read(7);
      moveTo(OTHER);

      left.flush(ticket());
      settle();
      expect(find('header').textContent).toContain('SOP-00008');
      expect(chosen('tp-company')).toEqual(['Bodega Sur']);
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

    it('of a save: is told, and the form of the case on screen is not touched', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      const left = update();
      leaveFor(OTHER);
      // The person goes on working, on the other case: even the same words are now of this one.
      type(description(), 'No imprime desde el lunes');
      pick('tp-priority', 'Alta');

      left.flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      expect(toasts()).toEqual(['Caso actualizado']);
      expect(find('header').textContent).toContain('SOP-00008');
      expect(description().value).toBe('No imprime desde el lunes');
      expect(chosen('tp-priority')).toEqual(['Alta']);
      expect(unsaved()).toBeTrue();
      // Its own "Actualizar" is not held by the save of the other case.
      expect(save().disabled).toBeFalse();
      expect(save().textContent).toContain('Actualizar');
    }));

    it('of a save that failed: is told, and the form of the case on screen is not touched', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      const left = update();
      leaveFor(OTHER);

      left.error(new ProgressEvent('error'));
      settle();
      expect(toasts()).toEqual(['No hay conexión con el servidor']);
      expect(description().value).toBe('No abre la caja');
      expect(unsaved()).toBeFalse();
    }));

    // The panel can be back on the case it left by the time the answer arrives. Its form was
    // made again from the stored case: the draft that was sent is not in it.
    it('of a save, with the panel back on the case it had left: shows the case as it was stored', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      const left = update();
      leaveFor(OTHER);
      moveTo(ticket());
      expect(save().textContent).toContain('Actualizar');

      left.flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      expect(description().value).toBe('No imprime desde el lunes');
      expect(unsaved()).toBeFalse();
    }));

    // The person was asked about what was not saved yet, and chose to leave it.
    it('of a save that had an observation to add after it: the observation is not added', fakeAsync(() => {
      open();
      type(description(), 'No imprime desde el lunes');
      type(noteBox(), 'Se llamó al cliente');
      const left = update();
      leaveFor(OTHER);

      left.flush(ticket({ description: 'No imprime desde el lunes' }));
      settle();
      http.expectNone({ method: 'POST', url: '/api/tickets/7/notes' });
      expect(toasts()).toEqual(['Caso actualizado']);
      expect(noteBox().value).toBe('');
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
      catalogs.aiReady.set(true);
      open();
      pick('tp-status', 'Resuelto');
      const left = update();
      leaveFor(OTHER);

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
      catalogs.aiReady.set(true);
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

    it('of an AI reply: does not take the place of what the person is writing for the case on screen', fakeAsync(() => {
      catalogs.aiReady.set(true);
      open();
      click(button('Generar con IA'));
      const left = http.expectOne({ method: 'POST', url: '/api/ai/reply/7' });
      moveTo(OTHER);
      type(replyBox(), 'Ya abre la caja.');

      left.flush(ticket({ customerReply: 'Ya puede imprimir.' }));
      settle();
      expect(replyBox().value).toBe('Ya abre la caja.');
      expect(unsaved()).toBeTrue();
      expect(button('Copiar').disabled).toBeFalse();
    }));
  });

  describe('the head of the panel', () => {
    it('names the case and says how it stands: its status, and whether it is overdue, forgotten, drafted by the AI or archived', fakeAsync(() => {
      open(ticket({ status: 'UNRESOLVED', overdue: true, stale: true, aiGenerated: true, archivedAt: '2026-11-07T15:00:00.000Z' }));
      const badges = Array.from(el.querySelectorAll('header .badge')).map((badge) => badge.textContent?.trim());

      expect(find('header').textContent).toContain('SOP-00007');
      expect(badges).toEqual(['Sin resolver', 'Vencido', 'Olvidado', 'IA', 'Archivado']);
    }));

    it('says nothing more than the status of a case that is in none of those', fakeAsync(() => {
      open();

      expect(Array.from(el.querySelectorAll('header .badge')).map((badge) => badge.textContent?.trim())).toEqual(['Pendiente']);
    }));

    it('says who registered the case and when, which cannot be edited', fakeAsync(() => {
      open(ticket({ createdByName: 'Ana Torres' }));
      const registered = find('[aria-labelledby=tp-registered-label]');

      expect(registered.textContent).toContain('Ana Torres');
      expect(registered.tagName).toBe('DIV');
    }));
  });
});
