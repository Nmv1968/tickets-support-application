import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ticket } from '../testing/fixtures';
import type { Ticket } from './api';
import { textOf } from '../testing/text';
import { FLAGS_LEGEND, TicketFlags, TicketFlagsLegend } from './ticket-flags';
import { PRIORITIES, PRIORITY_ICON, PROMISE_ICON } from './ui';

@Component({
  imports: [TicketFlags],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-ticket-flags [ticket]="ticket()" [showPromise]="showPromise()" [labelled]="labelled()" />`,
})
class Host {
  readonly ticket = signal<Ticket>(ticket());
  readonly showPromise = signal(true);
  readonly labelled = signal(false);
}

/** A case with every flag up. */
const FLAGGED = ticket({
  promisedDate: '2026-11-20',
  promiseState: 'today',
  stale: true,
  overdue: true,
  dueAt: '2026-11-06T15:00:00.000Z',
  priority: 'HIGH',
  timerStartedAt: '2026-11-05T11:00:00.000Z',
  attachmentsCount: 2,
  aiGenerated: true,
});

describe('TicketFlags', () => {
  let fixture: ComponentFixture<Host>;
  const flags = (): HTMLElement[] => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('app-icon'));

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  it('shows nothing for a case with nothing to flag', () => {
    expect(flags()).toEqual([]);
  });

  it('shows each flag of a case as an image with its name, said and in its tooltip, always in the same order', () => {
    fixture.componentInstance.ticket.set(FLAGGED);
    fixture.detectChanges();

    expect(flags().map((flag) => flag.getAttribute('data-icon'))).toEqual([
      'calendar-today-outline',
      'bell-ring-outline',
      'clock-alert-outline',
      'alert',
      'timer-outline',
      'paperclip',
      'creation-outline',
    ]);
    for (const flag of flags()) {
      expect(flag.getAttribute('role')).toBe('img');
      expect(flag.getAttribute('aria-hidden')).toBeNull();
      expect(flag.getAttribute('title')).toBe(flag.getAttribute('aria-label'));
    }
    const names = flags().map((flag) => flag.getAttribute('aria-label') ?? '');
    expect(names[0]).toMatch(/^Entrega prometida: 20\/11\/2026 · /);
    expect(names[1]).toMatch(/^Olvidado: sin movimiento /);
    expect(names[2]).toMatch(/^Vencido: /);
    expect(names.slice(3)).toEqual(['Prioridad Alta', 'Cronómetro en marcha', '2 adjunto(s)', 'Creado con IA']);
    expect(flags().map((flag) => flag.className)).toEqual(['text-warning', 'text-warning', 'text-danger', 'text-warning', 'text-primary', 'text-muted', 'text-muted']);
  });

  // All the priorities had the same flag, and all the states of a promise the same calendar, each in
  // a colour: told apart by the colour alone, which not everyone tells apart (WCAG 1.4.1).
  it('draws each priority and each state of a promise with an icon of its own, not only in a colour of its own', () => {
    const iconOf = (changes: Partial<Ticket>): string[] => {
      fixture.componentInstance.ticket.set(ticket({ ...changes }));
      fixture.detectChanges();
      return flags().map((flag) => flag.getAttribute('data-icon') ?? '');
    };

    const priorities = PRIORITIES.map((priority) => iconOf({ priority })[0]);
    expect(priorities).toEqual(['flag-outline', 'flag', 'alert', 'alert-octagon']);
    expect(new Set(priorities).size).toBe(PRIORITIES.length);

    const promises = (['overdue', 'today', 'soon'] as const).map((promiseState) => iconOf({ promiseState, promisedDate: '2026-11-20' })[0]);
    expect(promises).toEqual(['calendar-alert-outline', 'calendar-today-outline', 'calendar-clock-outline']);
  });

  it('leaves the promise out where the case already writes it', () => {
    fixture.componentInstance.ticket.set(FLAGGED);
    fixture.componentInstance.showPromise.set(false);
    fixture.detectChanges();

    expect(flags()[0].getAttribute('data-icon')).toBe('bell-ring-outline');
    expect(flags().length).toBe(6);
  });
});

// What each icon meant was only in its title, under a mouse that stays on it: never on a phone, never to the keyboard (WCAG 1.1.1, 1.3.3).
describe('TicketFlags, in words', () => {
  let fixture: ComponentFixture<Host>;
  const el = (): HTMLElement => fixture.nativeElement as HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.componentInstance.ticket.set(FLAGGED);
    fixture.detectChanges();
  });

  it('writes its words beside each icon where the case has room for them, for the eye only', () => {
    expect(textOf(el())).toBe('');
    fixture.componentInstance.labelled.set(true);
    fixture.detectChanges();

    const words = Array.from(el().querySelectorAll<HTMLElement>('app-icon + span'));
    expect(textOf(words[0])).toMatch(/^Promesa: (vence|venció) /);
    expect(words.slice(1).map((word) => textOf(word))).toEqual(['Olvidado', 'Vencido', 'Alta', 'Cronómetro', '2 adjuntos', 'IA']);
    for (const word of words) expect(word.getAttribute('aria-hidden')).toBe('true');
    // Who hears the case hears each icon by its name, as before.
    expect(Array.from(el().querySelectorAll('app-icon'), (icon) => icon.getAttribute('role'))).toEqual(Array(7).fill('img'));
    expect(el().querySelectorAll('app-icon')[3].getAttribute('aria-label')).toBe('Prioridad Alta');
  });

  it('says one attachment in the singular', () => {
    fixture.componentInstance.ticket.set(ticket({ attachmentsCount: 1 }));
    fixture.componentInstance.labelled.set(true);
    fixture.detectChanges();
    expect(textOf(el())).toBe('1 adjunto');
  });
});

describe('TicketFlagsLegend', () => {
  @Component({
    imports: [TicketFlagsLegend],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<app-ticket-flags-legend textId="list-flags-legend" />`,
  })
  class Legend {}

  let el: HTMLElement;

  beforeEach(() => {
    const fixture = TestBed.createComponent(Legend);
    fixture.detectChanges();
    el = fixture.nativeElement as HTMLElement;
  });

  it('is a "?" named for the flags, described by its text', () => {
    const button = el.querySelector('button')!;
    expect(button.getAttribute('aria-label')).toBe('Ayuda sobre Indicadores');
    expect(button.getAttribute('aria-describedby')).toBe('list-flags-legend');
    expect(textOf(el.querySelector('#list-flags-legend'))).toMatch(/^Indicadores del caso\. Entrega prometida al cliente: vencida, para hoy o por venir\. Olvidado: .+\. Creado con IA\.$/);
  });

  it('shows every icon a case can be flagged with, each beside its meaning', () => {
    const shown = Array.from(el.querySelectorAll('#list-flags-legend app-icon'), (icon) => icon.getAttribute('data-icon'));
    const used = [
      ...(['overdue', 'today', 'soon'] as const).map((state) => PROMISE_ICON[state]),
      'bell-ring-outline',
      'clock-alert-outline',
      ...PRIORITIES.map((priority) => PRIORITY_ICON[priority]),
      'timer-outline',
      'paperclip',
      'creation-outline',
    ];
    expect(shown).toEqual(used);
    expect(FLAGS_LEGEND.map((line) => line.text.split(':')[0].replace(/\.$/, ''))).toEqual([
      'Entrega prometida al cliente',
      'Olvidado',
      'Vencido',
      'Prioridad',
      'Cronómetro en marcha',
      'Tiene adjuntos',
      'Creado con IA',
    ]);
    // The icons are drawn, not said: the words beside them are what the "?" is described by.
    for (const icon of Array.from(el.querySelectorAll('#list-flags-legend app-icon'))) expect(icon.getAttribute('aria-hidden')).toBe('true');
  });
});
