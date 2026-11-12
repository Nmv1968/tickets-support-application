import { Injectable } from '@nestjs/common';
import { Subject } from 'rxjs';

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

/** In-memory fan-out of change events to every connected browser. One API instance, no broker. */
@Injectable()
export class EventsService {
  private readonly subject = new Subject<ChangeEvent>();
  readonly changes$ = this.subject.asObservable();

  emit(event: ChangeEvent): void {
    this.subject.next(event);
  }
}
