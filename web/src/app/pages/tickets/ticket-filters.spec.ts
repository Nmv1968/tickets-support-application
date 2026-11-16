import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Role } from '../../core/api';
import { Auth } from '../../core/auth';
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
});
