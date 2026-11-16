import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { trustedProxyHops } from './common/throttle';
import { bodyErrorsInSpanish, validationPipe } from './common/validation';

/** What main.ts sets on the application besides its module, apart so that tests set the same. */
export function configureApp(app: NestExpressApplication, env: NodeJS.ProcessEnv = process.env): void {
  // nginx appends the address it sees to X-Forwarded-For: req.ip is that one, the address the
  // limits per client count. The addresses a client writes in the header itself, to its left,
  // are never believed.
  app.set('trust proxy', trustedProxyHops(env));
  app.setGlobalPrefix('api');
  // Nest's own parsers of a JSON body and of a form, with the options it would give them when it
  // starts (it adds neither once there is one), registered here so that their error handler can
  // follow them.
  app.useBodyParser('json');
  app.useBodyParser('urlencoded', { extended: true });
  app.use(bodyErrorsInSpanish);
  app.useGlobalPipes(validationPipe());
}

/** The signals that stop the API: `docker stop` sends SIGTERM, Ctrl+C in a terminal SIGINT. */
export const STOP_SIGNALS = ['SIGTERM', 'SIGINT'];

/**
 * On a stop signal the application closes before the process ends: the streams of events end
 * (`EventsService.closing$`), the server stops taking requests and finishes the ones it is
 * answering, and the connections to the database close (`PrismaService`). Then the process exits
 * with 0 (`useProcessExit`). Without it, Nest would send the signal to the process again, which
 * Linux ignores for process 1, what the API is in its container: the process would stay until
 * nothing at all were left running in it, or `docker stop` ran out of time and killed it.
 */
export function closeOnStopSignals(app: INestApplication): void {
  app.enableShutdownHooks(STOP_SIGNALS, { useProcessExit: true });
}
