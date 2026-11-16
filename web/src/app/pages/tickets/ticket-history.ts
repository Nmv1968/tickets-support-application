import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { HistoryEntry } from '../../core/api';
import { formatDateTime } from '../../core/ui';

/** The "Historial de cambios" of the case panel: every change of the case, with who made it. Closed until it is opened. */
@Component({
  selector: 'app-ticket-history',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <details class="rounded-card border border-line px-3 py-2">
      <summary class="section-title cursor-pointer">Historial de cambios ({{ history().length }})</summary>
      <ul class="mt-2 space-y-1 text-xs">
        @for (h of history(); track h.id) {
          <li>
            <span class="text-muted">{{ formatDateTime(h.createdAt) }} · {{ h.userName ?? 'Sistema' }}:</span>
            {{ h.field }}
            @if (h.oldValue || h.newValue) {
              <span>de «{{ h.oldValue ?? '—' }}» a «{{ h.newValue ?? '—' }}»</span>
            } @else {
              <span>modificada</span>
            }
          </li>
        } @empty {
          <li class="text-muted">Sin cambios registrados.</li>
        }
      </ul>
    </details>
  `,
})
export class TicketHistory {
  readonly history = input.required<HistoryEntry[]>();

  protected readonly formatDateTime = formatDateTime;
}
