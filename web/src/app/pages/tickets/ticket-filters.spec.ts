import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Role } from '../../core/api';
import { Auth } from '../../core/auth';
import { textOf } from '../../testing/text';
import { NO_FILTERS, TicketFiltersPanel } from './ticket-filters';

// What each filter does to the list is in tickets.spec.ts. Here, what "Olvidados" tells of itself:
// its time is set in Configuración > Recordatorios, a tab of administrators.
describe('TicketFiltersPanel', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }));

  /** The hint of "Olvidados", in a session of someone with `role`. */
  function staleHint(role: Role): string {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role });
    const fixture = TestBed.createComponent(TicketFiltersPanel);
    fixture.componentRef.setInput('filters', NO_FILTERS);
    fixture.detectChanges();
    const label = [...(fixture.nativeElement as HTMLElement).querySelectorAll('label')].find((candidate) => candidate.textContent?.trim() === 'Olvidados');
    return label!.title;
  }

  it('tells an administrator where the time of a forgotten case is set', () => {
    expect(staleHint('ADMIN')).toBe('Abiertos y sin movimiento desde hace más del tiempo configurado en Configuración > Recordatorios');
  });

  it('tells an agent that an administrator sets it', () => {
    expect(staleHint('AGENT')).toBe('Abiertos y sin movimiento desde hace más del tiempo que un administrador fija en Configuración > Recordatorios');
  });

  // What a filter means was only in its title: shown under a mouse that stays on it, never to a keyboard or a finger.
  it('shows what each filter of a hint means with its "?", which the filter is described by', async () => {
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    const fixture = TestBed.createComponent(TicketFiltersPanel);
    fixture.componentRef.setInput('filters', NO_FILTERS);
    fixture.detectChanges();
    await fixture.whenStable();
    const el = fixture.nativeElement as HTMLElement;
    const helps = [...el.querySelectorAll<HTMLButtonElement>('button[aria-expanded]')];

    expect(helps.map((help) => help.getAttribute('aria-label'))).toEqual([
      'Ayuda sobre Registrado por',
      'Ayuda sobre Desde',
      'Ayuda sobre Hasta',
      'Ayuda sobre Promesa de entrega',
      'Ayuda sobre Vencidos',
      'Ayuda sobre Olvidados',
    ]);
    // Each is the description of its filter too.
    const described = (selector: string): string => textOf(el.querySelector(`#${el.querySelector(selector)!.getAttribute('aria-describedby')}`));
    expect(described('#tf-created-by')).toBe('El usuario que registró el caso');
    expect(described('#tf-from')).toBe('Fecha del caso desde');
    expect(described('#tf-to')).toBe('Fecha del caso hasta');
    expect(described('#tf-promise')).toBe('Promesa de entrega al cliente');
    expect(described('input.accent-danger')).toBe('Abiertos y con la fecha límite de su prioridad ya pasada');
    expect(described('input.accent-warning')).toBe('Abiertos y sin movimiento desde hace más del tiempo configurado en Configuración > Recordatorios');

    const overdue = helps[4];
    const text = el.querySelector<HTMLElement>(`#${overdue.getAttribute('aria-describedby')}`)!;
    expect(text.hidden).toBeTrue();
    overdue.click();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(text.hidden).toBeFalse();
  });
});
