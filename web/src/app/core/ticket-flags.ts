import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Ticket } from './api';
import { PRIORITY_CLASS, PRIORITY_LABEL, PROMISE_CLASS, formatDateTime, formatDay, promiseText, timeAgo } from './ui';

interface Flag {
  icon: string;
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
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Wraps instead of overflowing where the list leaves little room (the code column, a phone).
  host: { class: 'flex flex-wrap items-center gap-1 text-sm leading-none' },
  template: `
    @for (flag of flags(); track flag.icon) {
      <i class="mdi" [class]="flag.icon + ' ' + flag.color" role="img" [title]="flag.label" [attr.aria-label]="flag.label"></i>
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
        icon: 'mdi-calendar-clock-outline',
        color: PROMISE_CLASS[t.promiseState],
        label: `Entrega prometida: ${formatDay(t.promisedDate)} · ${promiseText(t.promisedDate)}`,
      });
    }
    if (t.stale) flags.push({ icon: 'mdi-bell-ring-outline', color: 'text-warning', label: `Olvidado: sin movimiento ${timeAgo(t.lastActivityAt)}` });
    if (t.overdue) flags.push({ icon: 'mdi-clock-alert-outline', color: 'text-danger', label: `Vencido: ${formatDateTime(t.dueAt)}` });
    if (t.priority) flags.push({ icon: 'mdi-flag', color: PRIORITY_CLASS[t.priority], label: `Prioridad ${PRIORITY_LABEL[t.priority]}` });
    if (t.timerStartedAt) flags.push({ icon: 'mdi-timer-outline', color: 'text-primary', label: 'Cronómetro en marcha' });
    if (t.attachmentsCount) flags.push({ icon: 'mdi-paperclip', color: 'text-muted', label: `${t.attachmentsCount} adjunto(s)` });
    if (t.aiGenerated) flags.push({ icon: 'mdi-creation-outline', color: 'text-muted', label: 'Creado con IA' });
    return flags;
  });
}
