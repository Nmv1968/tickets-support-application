import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';
import type { TicketDetail } from './api';

/** Something happened to cases that the screens showing them have to follow. */
export type TicketEvent =
  /**
   * This tab saved a case; `ticket` is how the server stored it. `created` is true for a new
   * case, and `archiving` for one that the save archived or brought back. Either way the case
   * joins the lists or leaves them, which no other edit does.
   */
  | { kind: 'saved'; ticket: TicketDetail; created: boolean; archiving: boolean }
  /** This tab deleted a case. */
  | { kind: 'removed'; id: number }
  /**
   * Cases changed and their new state is not known here: someone else changed them (live
   * updates) or this tab changed many at once (import). `id` is null when it can be any case.
   */
  | { kind: 'outdated'; id: number | null };

/**
 * The one place where changes to cases are announced. Api announces this tab's own writes when
 * the server answers them, and Live announces the changes made elsewhere. The list, the board,
 * an open case panel, the dashboard and the bell listen here instead of being wired to each
 * other, so a change reaches all of them even if the component that started it is gone.
 *
 * A stream and not a signal: a signal keeps only its last value, and two changes that arrive
 * in the same turn would reach the listeners as one.
 */
@Injectable({ providedIn: 'root' })
export class TicketEvents {
  private readonly subject = new Subject<TicketEvent>();
  readonly events = this.subject.asObservable();

  saved(ticket: TicketDetail, change: { created?: boolean; archiving?: boolean } = {}): void {
    this.subject.next({ kind: 'saved', ticket, created: change.created ?? false, archiving: change.archiving ?? false });
  }

  removed(id: number): void {
    this.subject.next({ kind: 'removed', id });
  }

  outdated(id: number | null): void {
    this.subject.next({ kind: 'outdated', id });
  }
}
