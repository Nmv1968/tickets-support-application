import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Role, Ticket } from '../core/api';
import { Auth } from '../core/auth';
import { Reminders } from '../core/reminders';
import { textOf } from '../testing/text';
import { RemindersPanel } from './reminders-panel';

// The drawer of the bell. What goes into each group is in reminders.spec.ts; here, what it says
// while the forgotten cases are off. Configuración > Recordatorios is a tab of administrators.
describe('RemindersPanel', () => {
  const staleHours = signal(0);

  beforeEach(() => {
    staleHours.set(0);
    const reminders: Partial<Reminders> = { staleHours, promiseSoonDays: signal(0), promises: signal<Ticket[]>([]), stale: signal<Ticket[]>([]), overdue: signal<Ticket[]>([]) };
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Reminders, useValue: reminders }] });
  });

  /** What the drawer says, opened in a session of someone with `role`. */
  function openAs(role: Role): string {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role });
    const fixture = TestBed.createComponent(RemindersPanel);
    fixture.detectChanges();
    return textOf(fixture.nativeElement as HTMLElement);
  }

  it('tells an administrator where the forgotten cases are turned on', () => {
    expect(openAs('ADMIN')).toContain('Los recordatorios están apagados. Se activan en Configuración > Recordatorios.');
  });

  it('tells an agent that an administrator turns them on', () => {
    const text = openAs('AGENT');
    expect(text).toContain('Los recordatorios están apagados. Un administrador puede activarlos en Configuración > Recordatorios.');
    expect(text).not.toContain('Se activan en');
  });

  it('says nothing of turning them on while they are on', () => {
    staleHours.set(48);
    for (const role of ['ADMIN', 'AGENT'] as const) expect(openAs(role)).withContext(role).not.toContain('apagados');
  });
});
