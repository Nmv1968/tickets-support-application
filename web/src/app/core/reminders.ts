import { Injectable, computed, inject, signal } from '@angular/core';
import type { Subscription } from 'rxjs';
import { Api } from './api';
import type { ReminderList, Ticket } from './api';
import { Auth } from './auth';
import { Catalogs } from './catalogs';
import { TicketEvents } from './ticket-events';

const MINE_KEY = 'st.reminders.mine';
const REFRESH_MS = 120_000;

/**
 * Cases that need attention, for the bell: delivery promises due, forgotten cases (no activity
 * for the time set in Configuración > Recordatorios) and cases past their SLA deadline.
 * A reminder goes away by itself when the case is attended or resolved; there is nothing to dismiss.
 */
@Injectable({ providedIn: 'root' })
export class Reminders {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);
  private readonly catalogs = inject(Catalogs);
  private readonly ticketEvents = inject(TicketEvents);

  private readonly data = signal<ReminderList | null>(null);
  /** Show only cases assigned to the logged-in user. Remembered per browser. */
  readonly onlyMine = signal(localStorage.getItem(MINE_KEY) === '1');
  /** False for a user who is not a responsible: no case is theirs, so there is nothing to narrow to. */
  readonly canShowMine = computed(() => this.catalogs.ownAssigneeId() !== null);

  readonly staleHours = computed(() => this.data()?.staleHours ?? 0);
  readonly promiseSoonDays = computed(() => this.data()?.promiseSoonDays ?? 0);
  /** Delivery promises that passed, are due today or, with advance notice on, are coming up. */
  readonly promises = computed(() => this.visible(this.data()?.promises ?? []));
  readonly stale = computed(() => this.visible(this.data()?.stale ?? []));
  readonly overdue = computed(() => this.visible(this.data()?.overdue ?? []));
  /** A case that appears in more than one group counts once. */
  readonly count = computed(() => new Set([...this.promises(), ...this.stale(), ...this.overdue()].map((t) => t.id)).size);

  private interval: ReturnType<typeof setInterval> | undefined;
  private soon: ReturnType<typeof setTimeout> | undefined;
  private changes: Subscription | undefined;
  private readonly onFocus = (): void => void this.refresh();

  /** Called by the shell while a user is logged in. */
  start(): void {
    void this.refresh();
    this.interval = setInterval(() => void this.refresh(), REFRESH_MS);
    window.addEventListener('focus', this.onFocus);
    // Any change to a case, made here or elsewhere, can add or remove a reminder.
    this.changes = this.ticketEvents.events.subscribe(() => this.refreshSoon());
  }

  stop(): void {
    clearInterval(this.interval);
    clearTimeout(this.soon);
    window.removeEventListener('focus', this.onFocus);
    this.changes?.unsubscribe();
  }

  async refresh(): Promise<void> {
    if (!this.auth.user()) return;
    try {
      this.data.set(await this.api.reminders());
    } catch {
      // Keeps the last list; the next refresh tries again.
    }
  }

  /** After changes to cases or to the reminder settings: one refresh shortly after the last one. */
  refreshSoon(): void {
    clearTimeout(this.soon);
    this.soon = setTimeout(() => void this.refresh(), 800);
  }

  setOnlyMine(value: boolean): void {
    this.onlyMine.set(value);
    localStorage.setItem(MINE_KEY, value ? '1' : '0');
  }

  private visible(tickets: Ticket[]): Ticket[] {
    const mine = this.catalogs.ownAssigneeId();
    return this.onlyMine() && mine !== null ? tickets.filter((t) => t.assigneeId === mine) : tickets;
  }
}
