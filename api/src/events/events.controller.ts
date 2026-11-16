import { Controller, Headers, Logger, Sse } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { NEVER, defer, exhaustMap, filter, interval, map, merge, switchMap, takeUntil, takeWhile, timer } from 'rxjs';
import type { Observable } from 'rxjs';
import { sessionOver } from '../common/auth';
import { sessionStands, verifiedPayload } from '../common/session-token';
import type { TokenPayload } from '../common/session-token';
import { PrismaService } from '../prisma.service';
import { EventsService } from './events.service';

export const HEARTBEAT_MS = 25_000;

/** The longest a timer of Node waits: given more, it fires at once (about 24.8 days). */
const LONGEST_TIMER_MS = 2 ** 31 - 1;

const PING: MessageEvent = { type: 'ping', data: '' };

/** Emits once, when the clock reaches `time` (milliseconds since 1970), however far ahead it is. */
function at(time: number): Observable<unknown> {
  return defer(() => {
    const left = time - Date.now();
    return left > LONGEST_TIMER_MS ? timer(LONGEST_TIMER_MS).pipe(switchMap(() => at(time))) : timer(Math.max(left, 0));
  });
}

@Controller('events')
export class EventsController {
  private readonly logger = new Logger(EventsController.name);

  constructor(
    private readonly events: EventsService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Server-Sent Events stream of changes. The browser keeps it open and refreshes its lists
   * when something arrives, so a case registered from another screen or by an assistant
   * through MCP shows up without reloading. Needs the login token like every other route.
   * The periodic `ping` keeps proxies from closing an idle connection.
   *
   * JwtGuard looks at the token only when the stream opens, so the stream itself ends with its
   * session: when the API ends the sessions of the user (`EventsService.sessionsEnded`), when the
   * token expires, and at a heartbeat that finds the user inactive or with another version of the
   * sessions than the token's, as after a change made straight in the database. The browser opens
   * it again, and JwtGuard answers 401 to a session that is over. Every stream ends too when the API
   * closes (`EventsService.closing$`): the server could not close while one is open.
   */
  @Sse()
  async stream(@Headers('authorization') authorization: string | undefined): Promise<Observable<MessageEvent>> {
    // JwtGuard has just accepted it; read again for the version and the expiry it does not keep.
    const token = await verifiedPayload(this.jwt, authorization);
    if (!token) throw sessionOver();

    const ended = merge(
      this.events.sessionsEnded$.pipe(filter((userId) => userId === token.sub)),
      token.exp === undefined ? NEVER : at(token.exp * 1000),
      this.events.closing$,
    );
    const heartbeat = interval(HEARTBEAT_MS).pipe(
      // A check still waiting for the database when the next one is due: that one is skipped.
      exhaustMap(() => this.stands(token)),
      map((stands) => (stands ? PING : null)),
    );
    return merge(this.events.changes$.pipe(map((event): MessageEvent => ({ type: 'change', data: event }))), heartbeat).pipe(
      takeWhile((message): message is MessageEvent => message !== null),
      takeUntil(ended),
    );
  }

  /** Whether the session of the token still stands as the user is stored now: one read by primary key. */
  private async stands(token: TokenPayload): Promise<boolean> {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: token.sub }, select: { active: true, tokenVersion: true } });
      return sessionStands(user, token);
    } catch (error) {
      // Unknown is not standing: the stream ends, and opening it again goes through JwtGuard.
      this.logger.warn(`No se pudo comprobar la sesión de un flujo de eventos, que se cierra: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
}
