import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TicketStatus } from './api';
import { StatusBadge } from './status-badge';

@Component({
  imports: [StatusBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="mt-1" appStatusBadge [status]="status()"></span>`,
})
class Host {
  readonly status = signal<TicketStatus>('PENDING');
}

describe('StatusBadge', () => {
  it('is a badge with the name of the status, in its colour, and follows the case', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const badge = (fixture.nativeElement as HTMLElement).querySelector('span')!;

    expect(badge.textContent?.trim()).toBe('Pendiente');
    expect([...badge.classList].sort()).toEqual(['badge', 'mt-1', 'st-PENDING']);

    fixture.componentInstance.status.set('RESOLVED');
    fixture.detectChanges();
    expect(badge.textContent?.trim()).toBe('Resuelto');
    expect([...badge.classList].sort()).toEqual(['badge', 'mt-1', 'st-RESOLVED']);
  });
});
