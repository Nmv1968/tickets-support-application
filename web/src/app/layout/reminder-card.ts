import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Ticket } from '../core/api';
import { Icon } from '../core/icon';
import { StatusBadge } from '../core/status-badge';

let cards = 0;

/**
 * One case in the drawer of the bell. Each group of reminders says in `reason` why the case
 * is there, and can add a `detail` under it.
 * It goes on a button, which stays the element that takes the click and the focus:
 * `<button type="button" appReminderCard [ticket]="t" reason="…" reasonClass="text-danger" (click)="…">`.
 *
 * The button is named by the code and the company of the case; the reason and the rest are its
 * description. Named by all its text, it was read out whole every time the focus reached it.
 */
@Component({
  selector: 'button[appReminderCard]',
  imports: [StatusBadge, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'card w-full p-3 text-left hover:bg-elevated',
    '[attr.aria-labelledby]': "id + '-code ' + id + '-company'",
    '[attr.aria-describedby]': "id + '-reason ' + id + '-status ' + id + '-details'",
  },
  template: `
    <div class="flex items-center gap-2 text-xs">
      <span class="font-mono text-primary" [id]="id + '-code'">{{ ticket().code }}</span>
      <span appStatusBadge [status]="ticket().status" [id]="id + '-status'"></span>
      <span class="ml-auto font-medium" [class]="reasonClass()" [id]="id + '-reason'">{{ reason() }}</span>
    </div>
    <div class="mt-1 font-medium" [id]="id + '-company'">{{ ticket().company }}</div>
    <div [id]="id + '-details'">
      <div class="line-clamp-2 text-muted">{{ ticket().description }}</div>
      <div class="mt-1 flex items-center gap-2 text-xs text-muted">
        <span class="min-w-0"><app-icon name="account-outline" /> {{ ticket().assigneeName ?? 'Sin asignar' }}</span>
        @if (detail()) {
          <span class="ml-auto">{{ detail() }}</span>
        }
      </div>
    </div>
  `,
})
export class ReminderCard {
  readonly ticket = input.required<Ticket>();
  /** Why the case needs attention, at the top right: "vence hoy", "hace 3 días"… */
  readonly reason = input.required<string>();
  /** Text colour class of the reason. */
  readonly reasonClass = input.required<string>();
  /** Optional line at the bottom right. */
  readonly detail = input('');

  /** The same case can be in two groups of the bell: the ids are of this card. */
  protected readonly id = `reminder-card-${++cards}`;
}
