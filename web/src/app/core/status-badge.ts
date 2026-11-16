import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TicketStatus } from './api';
import { STATUS_LABEL } from './ui';

/**
 * The status of a case as a badge in the colour of the status (`.st-*` in styles.css), the same
 * in every list and in the form of the case: `<span appStatusBadge [status]="t.status"></span>`.
 */
@Component({
  selector: 'span[appStatusBadge]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'badge', '[class]': "'st-' + status()" },
  template: `{{ label() }}`,
})
export class StatusBadge {
  readonly status = input.required<TicketStatus>();

  protected readonly label = computed(() => STATUS_LABEL[this.status()]);
}
