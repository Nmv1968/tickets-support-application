import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import type { Ticket } from '../core/api';
import { Icon } from '../core/icon';
import { Reminders } from '../core/reminders';
import { PROMISE_CLASS, formatDateTime, formatDay, formatHours, promiseText, timeAgo } from '../core/ui';
import { ReminderCard } from './reminder-card';

/** Drawer opened by the bell: delivery promises due, then forgotten cases, then cases past their SLA deadline. */
@Component({
  selector: 'app-reminders-panel',
  imports: [A11yModule, ReminderCard, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="panel-backdrop" (click)="closed.emit()" aria-hidden="true"></div>
    <aside
      class="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Avisos"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
    >
      <header class="flex items-center gap-2 border-b border-line px-4 py-3">
        <app-icon name="bell-outline" class="text-xl text-primary" />
        <h2 class="font-semibold">Avisos</h2>
        <button type="button" class="btn btn-ghost ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar" cdkFocusInitial>
          <app-icon name="close" class="text-lg" />
        </button>
      </header>

      <div class="min-h-0 flex-1 space-y-5 overflow-auto p-4">
        <section>
          <h3 class="section-title flex items-center gap-1.5">
            <app-icon name="calendar-clock-outline" class="text-base text-danger" />
            Promesas de entrega ({{ reminders.promises().length }})
          </h3>
          <p class="mt-1 text-2xs text-muted">
            Casos abiertos con fecha prometida vencida o para hoy{{ reminders.promiseSoonDays() ? ', y los que vencen en los próximos ' + reminders.promiseSoonDays() + ' día(s)' : '' }}.
            El aviso se quita al resolver el caso o cambiar la fecha prometida.
          </p>
          <ul class="mt-2 space-y-2">
            @for (t of reminders.promises(); track t.id) {
              <li>
                <button
                  type="button"
                  appReminderCard
                  [ticket]="t"
                  [reason]="promiseText(t.promisedDate)"
                  [reasonClass]="promiseClass[t.promiseState ?? 'later']"
                  [detail]="'Prometido: ' + formatDay(t.promisedDate)"
                  (click)="open(t)"
                ></button>
              </li>
            } @empty {
              <li class="rounded-control bg-elevated px-3 py-4 text-center text-xs text-muted">Ninguna promesa de entrega por atender.</li>
            }
          </ul>
        </section>

        <section>
          <h3 class="section-title flex items-center gap-1.5">
            <app-icon name="bell-ring-outline" class="text-base text-warning" />
            Casos olvidados ({{ reminders.stale().length }})
          </h3>
          @if (reminders.staleHours() === 0) {
            <p class="mt-2 text-xs text-muted">Los recordatorios están apagados. Se activan en Configuración &gt; Recordatorios.</p>
          } @else {
            <p class="mt-1 text-2xs text-muted">
              Abiertos y sin movimiento desde hace más de {{ formatHours(reminders.staleHours()) }}. Una observación o cualquier cambio en el caso quita el aviso.
            </p>
            <ul class="mt-2 space-y-2">
              @for (t of reminders.stale(); track t.id) {
                <li>
                  <button type="button" appReminderCard [ticket]="t" [reason]="timeAgo(t.lastActivityAt)" reasonClass="text-warning" (click)="open(t)"></button>
                </li>
              } @empty {
                <li class="rounded-control bg-elevated px-3 py-4 text-center text-xs text-muted">Ningún caso olvidado.</li>
              }
            </ul>
          }
        </section>

        @if (reminders.overdue().length) {
          <section>
            <h3 class="section-title flex items-center gap-1.5">
              <app-icon name="clock-alert-outline" class="text-base text-danger" />
              Vencidos por SLA ({{ reminders.overdue().length }})
            </h3>
            <ul class="mt-2 space-y-2">
              @for (t of reminders.overdue(); track t.id) {
                <li>
                  <button type="button" appReminderCard [ticket]="t" [reason]="'venció ' + formatDateTime(t.dueAt)" reasonClass="text-danger" (click)="open(t)"></button>
                </li>
              }
            </ul>
          </section>
        }
      </div>

      @if (reminders.promises().length || reminders.stale().length) {
        <footer class="flex flex-wrap gap-2 border-t border-line px-4 py-3">
          @if (reminders.promises().length) {
            <button type="button" class="btn btn-soft flex-1" (click)="openList({ promesa: 'due' })">
              <app-icon name="calendar-clock-outline" /> Ver promesas en la lista
            </button>
          }
          @if (reminders.stale().length) {
            <button type="button" class="btn btn-soft flex-1" (click)="openList({ olvidados: 1 })">
              <app-icon name="format-list-bulleted" /> Ver olvidados en la lista
            </button>
          }
        </footer>
      }
    </aside>
  `,
})
export class RemindersPanel {
  protected readonly reminders = inject(Reminders);
  private readonly router = inject(Router);

  readonly closed = output<void>();

  protected readonly promiseClass = PROMISE_CLASS;
  protected readonly promiseText = promiseText;
  protected readonly formatDay = formatDay;
  protected readonly timeAgo = timeAgo;
  protected readonly formatHours = formatHours;
  protected readonly formatDateTime = formatDateTime;

  /** Opens the case in the list screen, which shows its detail panel. */
  protected open(ticket: Ticket): void {
    this.closed.emit();
    void this.router.navigate(['/casos'], { queryParams: { caso: ticket.id } });
  }

  /** Opens the list of cases with one of its filters turned on. */
  protected openList(queryParams: { olvidados?: number; promesa?: string }): void {
    this.closed.emit();
    void this.router.navigate(['/casos'], { queryParams });
  }
}
