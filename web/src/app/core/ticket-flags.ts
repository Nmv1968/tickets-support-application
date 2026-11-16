import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Ticket } from './api';
import { Icon } from './icon';
import type { IconName } from './icons';
import { PRIORITY_CLASS, PRIORITY_LABEL, PROMISE_CLASS, formatDateTime, formatDay, promiseText, timeAgo } from './ui';

interface Flag {
  icon: IconName;
  color: string;
  /** Tooltip and accessible name: the same text for who sees the icon and who hears it. */
  label: string;
}

/**
 * The small status icons of a case: delivery promise, forgotten, overdue, priority, running
 * timer, attachments and created with AI. Every list of cases shows them through this
 * component, so the icons, their order and their wording are the same everywhere.
 */
@Component({
  selector: 'app-ticket-flags',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Wraps instead of overflowing where the list leaves little room (the code column, a phone).
  host: { class: 'flex flex-wrap items-center gap-1 text-sm leading-none' },
  template: `
    @for (flag of flags(); track flag.icon) {
      <app-icon [name]="flag.icon" [class]="flag.color" [label]="flag.label" [title]="flag.label" />
    }
  `,
})
export class TicketFlags {
  readonly ticket = input.required<Ticket>();
  /** Off where the promise is already written out next to the case, as in the table. */
  readonly showPromise = input(true);

  protected readonly flags = computed(() => {
    const t = this.ticket();
    const flags: Flag[] = [];
    if (this.showPromise() && t.promiseState) {
      flags.push({
        icon: 'calendar-clock-outline',
        color: PROMISE_CLASS[t.promiseState],
        label: `Entrega prometida: ${formatDay(t.promisedDate)} · ${promiseText(t.promisedDate)}`,
      });
    }
    if (t.stale) flags.push({ icon: 'bell-ring-outline', color: 'text-warning', label: `Olvidado: sin movimiento ${timeAgo(t.lastActivityAt)}` });
    if (t.overdue) flags.push({ icon: 'clock-alert-outline', color: 'text-danger', label: `Vencido: ${formatDateTime(t.dueAt)}` });
    if (t.priority) flags.push({ icon: 'flag', color: PRIORITY_CLASS[t.priority], label: `Prioridad ${PRIORITY_LABEL[t.priority]}` });
    if (t.timerStartedAt) flags.push({ icon: 'timer-outline', color: 'text-primary', label: 'Cronómetro en marcha' });
    if (t.attachmentsCount) flags.push({ icon: 'paperclip', color: 'text-muted', label: `${t.attachmentsCount} adjunto(s)` });
    if (t.aiGenerated) flags.push({ icon: 'creation-outline', color: 'text-muted', label: 'Creado con IA' });
    return flags;
  });
}
