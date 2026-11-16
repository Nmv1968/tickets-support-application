import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks } from '@angular/core/testing';
import type { TicketDetail } from '../../core/api';
import { ticket } from '../../testing/fixtures';
import { isDisabled, screenOf } from '../../testing/screen';
import { NO_NOT_NUMBER } from './ticket-form';
import type { NotNumber, Problems } from './ticket-form';
import { TicketTimes } from './ticket-times';

const RUNNING = { timerStartedAt: '2026-11-06T09:00:00.000Z' };

// The block only shows what the panel gives it and tells what the person does: the panel spec
// tries it with the draft and the saves.
describe('TicketTimes', () => {
  let fixture: ComponentFixture<TicketTimes>;
  let el: HTMLElement;
  /** What the block told, in the order it told it. */
  let told: string[];

  /** A screen update. ngModel writes a value into its field right after Angular goes through the block. */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function create(stored: Partial<TicketDetail> = {}, minutes: { estimated: number | null; spent: number | null } = { estimated: 30, spent: 15 }): void {
    fixture = TestBed.createComponent(TicketTimes);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('ticket', ticket({ spentMinutes: 15, ...stored }));
    fixture.componentRef.setInput('estimated', minutes.estimated);
    fixture.componentRef.setInput('spent', minutes.spent);
    fixture.componentRef.setInput('notNumber', NO_NOT_NUMBER);
    fixture.componentRef.setInput('problems', {});
    fixture.componentRef.setInput('spentUnsaved', false);
    told = [];
    const times = fixture.componentInstance;
    times.estimated.subscribe((value) => told.push(`estimated ${value}`));
    times.spent.subscribe((value) => told.push(`spent ${value}`));
    times.notNumber.subscribe((value: NotNumber) => told.push(`notNumber ${value.estimatedMinutes} ${value.spentMinutes}`));
    times.tidy.subscribe(() => told.push('tidy'));
    times.timer.subscribe((action) => told.push(`timer ${action}`));
    render();
  }

  function give(name: 'problems' | 'spentUnsaved' | 'notNumber', value: Problems | boolean | NotNumber): void {
    fixture.componentRef.setInput(name, value);
    render();
  }

  const { find, button, click, type, fire } = screenOf(() => el, render);
  const estimated = (): HTMLInputElement => find('#tp-estimated');
  const spent = (): HTMLInputElement => find('#tp-spent');

  /** A text typed in a field of numbers, as the browser reports it: an empty field that is not a valid one. */
  function typeText(box: HTMLInputElement, event = 'input'): void {
    Object.defineProperty(box, 'validity', { configurable: true, value: { badInput: true } });
    type(box, '', event);
  }

  it('shows the minutes of the draft in their fields, each with its label', fakeAsync(() => {
    create();

    expect(estimated().value).toBe('30');
    expect(spent().value).toBe('15');
    expect(find('label[for=tp-estimated]').textContent).toBe('Estimado (minutos)');
    expect(find('label[for=tp-spent]').textContent).toBe('Real (minutos)');
  }));

  it('gives back what the person types, as a number, and nothing for a field emptied', fakeAsync(() => {
    create();
    type(estimated(), '45');
    type(spent(), '');

    expect(told).toEqual(['estimated 45', 'spent null']);
  }));

  // "30e" in one browser, "45 min" in another: the browser reports the field as empty.
  it('tells a field that holds a text that is not a number, also when only a key says so, and when it is a number again', fakeAsync(() => {
    create();
    typeText(estimated());
    expect(told).toEqual(jasmine.arrayWithExactContents(['estimated null', 'notNumber true false']));

    told = [];
    typeText(spent(), 'keyup');
    expect(told).toEqual(['notNumber true true']);

    told = [];
    Reflect.deleteProperty(estimated(), 'validity');
    type(estimated(), '45');
    expect(told).toEqual(jasmine.arrayWithExactContents(['estimated 45', 'notNumber false true']));
  }));

  it('on leaving a field, tells first what it holds, and then asks for the minutes to be tidied', fakeAsync(() => {
    create();
    Object.defineProperty(spent(), 'validity', { configurable: true, value: { badInput: true } });
    fire(spent(), 'change');

    expect(told).toEqual(['notNumber false true', 'tidy']);
  }));

  it('says the problem of a field next to it, and marks the field', fakeAsync(() => {
    create();
    expect(estimated().hasAttribute('aria-invalid')).toBeFalse();
    expect(el.querySelector('#tp-estimated-error')).toBeNull();

    give('problems', { estimatedMinutes: 'Escribe solo el número de minutos.' });
    expect(estimated().getAttribute('aria-invalid')).toBe('true');
    expect(find(`#${estimated().getAttribute('aria-describedby')}`).textContent).toContain('Escribe solo el número de minutos.');
    expect(spent().hasAttribute('aria-invalid')).toBeFalse();
    expect(el.querySelector('#tp-spent-error')).toBeNull();
  }));

  // For the panel's "Descartar cambios": the draft never had the text, so only the field can give it up.
  it('empties the fields that hold a text, and says none does', fakeAsync(() => {
    create();
    give('notNumber', { estimatedMinutes: true, spentMinutes: false });
    told = [];

    fixture.componentInstance.emptyNotNumbers();
    render();
    expect(estimated().value).toBe('');
    expect(spent().value).toBe('15');
    expect(told).toEqual(['notNumber false false']);

    told = [];
    fixture.componentInstance.emptyNotNumbers();
    expect(told).toEqual([]);
  }));

  describe('the timer', () => {
    it('stopped: says how much time the case has, and asks to start it', fakeAsync(() => {
      create({ spentMinutes: 95 });
      expect(el.textContent).toContain('Acumulado: 1 h 35 min');

      click(button('Iniciar cronómetro'));
      expect(told).toEqual(['timer start']);
    }));

    it('cannot be started on a case stored as resolved', fakeAsync(() => {
      create({ status: 'RESOLVED' });

      expect(isDisabled(button('Iniciar cronómetro'))).toBeTrue();
    }));

    it('running: says since when, and asks to stop it', fakeAsync(() => {
      create(RUNNING);
      expect(el.textContent).toContain('En marcha desde');

      click(button('Detener cronómetro'));
      expect(told).toEqual(['timer stop']);
    }));

    it('cannot be stopped while "Real (minutos)" has an unsaved change, and says why', fakeAsync(() => {
      create(RUNNING);
      give('spentUnsaved', true);

      expect(isDisabled(button('Detener cronómetro'))).toBeTrue();
      expect(el.textContent).toContain('Actualiza o descarta el cambio en «Real (minutos)» para detenerlo.');
      expect(el.textContent).not.toContain('En marcha desde');
    }));
  });

  describe('the deadline', () => {
    const dates = (): string[] => Array.from(el.querySelectorAll('dl > *')).map((item) => item.textContent?.trim() ?? '');

    it('says there is none for a case without a priority', fakeAsync(() => {
      create();

      expect(dates()).toEqual(['Fecha límite (SLA)', 'Sin prioridad, sin fecha límite']);
    }));

    it('is drawn as a danger once it has passed, and the day the case was resolved follows it', fakeAsync(() => {
      create({ dueAt: '2026-11-06T09:00:00.000Z', overdue: true, resolvedAt: '2026-11-07T15:00:00.000Z' });
      const [due, resolved] = Array.from(el.querySelectorAll('dd'));

      expect(due.classList).toContain('text-danger');
      expect(dates()[2]).toBe('Resuelto');
      expect(resolved.textContent?.trim()).not.toBe('');
    }));
  });

  // The button pressed is replaced by the other one, and the browser put the focus nowhere.
  describe('the focus, as the timer starts and stops', () => {
    it('goes to the button that takes the place of the one pressed', fakeAsync(() => {
      create();
      button('Iniciar cronómetro').focus();
      click(button('Iniciar cronómetro'));
      expect(told).toEqual(['timer start']);

      // The case comes back with its timer running: "Detener" takes the place of "Iniciar".
      fixture.componentRef.setInput('ticket', ticket({ spentMinutes: 15, ...RUNNING }));
      render();
      expect(document.activeElement).toBe(button('Detener cronómetro'));

      click(button('Detener cronómetro'));
      fixture.componentRef.setInput('ticket', ticket({ spentMinutes: 20 }));
      render();
      expect(document.activeElement).toBe(button('Iniciar cronómetro'));
    }));

    it('leaves it where it is when the timer changes elsewhere', fakeAsync(() => {
      create();
      estimated().focus();
      fixture.componentRef.setInput('ticket', ticket({ spentMinutes: 15, ...RUNNING }));
      render();
      expect(document.activeElement).toBe(estimated());
    }));

    // Disabled, the button could not be reached to read why.
    it('reaches "Detener cronómetro" while it cannot be used, and says why', fakeAsync(() => {
      create(RUNNING);
      give('spentUnsaved', true);
      const stop = button('Detener cronómetro');

      expect(stop.disabled).toBeFalse();
      expect(isDisabled(stop)).toBeTrue();
      expect(find(`#${stop.getAttribute('aria-describedby')}`).textContent).toContain('Actualiza o descarta el cambio en «Real (minutos)» para detenerlo.');
    }));
  });
});
