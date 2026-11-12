import { Controller, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { EventsService } from './events.service';

const HEARTBEAT_MS = 25_000;

@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  /**
   * Server-Sent Events stream of changes. The browser keeps it open and refreshes its lists
   * when something arrives, so a case registered from another screen or by an assistant
   * through MCP shows up without reloading. Needs the login token like every other route.
   * The periodic `ping` keeps proxies from closing an idle connection.
   */
  @Sse()
  stream(): Observable<MessageEvent> {
    return merge(
      this.events.changes$.pipe(map((event): MessageEvent => ({ type: 'change', data: event }))),
      interval(HEARTBEAT_MS).pipe(map((): MessageEvent => ({ type: 'ping', data: '' }))),
    );
  }
}
