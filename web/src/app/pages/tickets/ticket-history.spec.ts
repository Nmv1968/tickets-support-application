import { TestBed } from '@angular/core/testing';
import type { HistoryEntry } from '../../core/api';
import { formatDateTime } from '../../core/ui';
import { TicketHistory } from './ticket-history';

describe('TicketHistory', () => {
  function render(history: HistoryEntry[]): HTMLElement {
    const fixture = TestBed.createComponent(TicketHistory);
    fixture.componentRef.setInput('history', history);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  const lines = (el: HTMLElement): string[] => Array.from(el.querySelectorAll('li')).map((line) => line.textContent?.replace(/\s+/g, ' ').trim() ?? '');

  it('tells every change of the case, with who made it and from what to what, and is closed until it is opened', () => {
    const el = render([
      { id: 3, field: 'Prioridad', oldValue: 'Baja', newValue: null, userName: 'Luis', createdAt: '2026-11-07T10:00:00.000Z' },
      { id: 2, field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación, Falla del sistema', userName: 'Ana Torres', createdAt: '2026-11-06T09:00:00.000Z' },
      { id: 1, field: 'Descripción', oldValue: null, newValue: null, userName: null, createdAt: '2026-11-05T12:00:00.000Z' },
    ]);

    expect(el.querySelector('summary')?.textContent).toContain('Historial de cambios (3)');
    expect(el.querySelector('details')?.open).toBeFalse();
    expect(lines(el)[0]).toBe(`${formatDateTime('2026-11-07T10:00:00.000Z').replace(/\s+/g, ' ')} · Luis: Prioridad de «Baja» a «—»`);
    expect(lines(el)[1]).toContain('Ana Torres: Tipos de soporte de «—» a «Capacitación, Falla del sistema»');
    // A change of nobody of the team, whose values the history does not keep.
    expect(lines(el)[2]).toContain('Sistema: Descripción modificada');
  });

  it('says when the case has none', () => {
    const el = render([]);

    expect(el.querySelector('summary')?.textContent).toContain('Historial de cambios (0)');
    expect(lines(el)).toEqual(['Sin cambios registrados.']);
  });
});
