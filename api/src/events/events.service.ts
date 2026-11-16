import { Injectable } from '@nestjs/common';
import type { BeforeApplicationShutdown } from '@nestjs/common';
import { BehaviorSubject, Subject, filter, take } from 'rxjs';

/** Something changed on the server. Open browsers use it to refresh what they show. */
export interface ChangeEvent {
  /** What kind of data changed: cases, the catalogs behind the selects, or app settings. */
  scope: 'tickets' | 'catalogs' | 'settings';
  /** The case that changed, when the change was on a single case. */
  ticketId: number | null;
  /** Set only when a case was created, for the "X registró SOP-00012" notice. */
  created: { code: string; by: string } | null;
  /** Browser tab that made the change (header `X-Client-Id`). That tab already shows it and skips the event. */
  clientId: string | null;
}

/**
 * In-memory fan-out to the open streams of events (`EventsController`): the changes, for every
 * connected browser, the end of the sessions of a user, for the streams of that user, and the end
 * of the API, for all of them. One API instance, no broker.
 */
@Injectable()
export class EventsService implements BeforeApplicationShutdown {
  private readonly subject = new Subject<ChangeEvent>();
  readonly changes$ = this.subject.asObservable();

  private readonly ended = new Subject<number>();
  /** The ids of the users whose sessions the API has just ended. */
  readonly sessionsEnded$ = this.ended.asObservable();

  private readonly stopping = new BehaviorSubject(false);
  /**
   * Emits once, when the API starts to close, and at once to whoever subscribes after that: the
   * streams end, as the server waits for every answer in progress before it closes and a stream
   * never finishes by itself. The browsers open them again, on the API that starts next.
   */
  readonly closing$ = this.stopping.pipe(filter(Boolean), take(1));

  /** Nest calls it as the application closes (a stop signal, `app.close()`), before the server stops taking requests. */
  beforeApplicationShutdown(): void {
    this.stopping.next(true);
  }

  emit(event: ChangeEvent): void {
    this.subject.next(event);
  }

  /**
   * Called by every write of `END_SESSIONS`, once it is committed: the streams open with the
   * sessions of that user end at once, as each of their other requests is refused from then on.
   */
  sessionsEnded(userId: number): void {
    this.ended.next(userId);
  }
}
