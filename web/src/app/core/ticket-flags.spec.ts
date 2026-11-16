import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ticket } from '../testing/fixtures';
import type { Ticket } from './api';
import { TicketFlags } from './ticket-flags';

@Component({
  imports: [TicketFlags],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-ticket-flags [ticket]="ticket()" [showPromise]="showPromise()" />`,
})
class Host {
  readonly ticket = signal<Ticket>(ticket());
  readonly showPromise = signal(true);
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
      'calendar-clock-outline',
      'bell-ring-outline',
      'clock-alert-outline',
      'flag',
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

  it('leaves the promise out where the case already writes it', () => {
    fixture.componentInstance.ticket.set(FLAGGED);
    fixture.componentInstance.showPromise.set(false);
    fixture.detectChanges();

    expect(flags()[0].getAttribute('data-icon')).toBe('bell-ring-outline');
    expect(flags().length).toBe(6);
  });
});
