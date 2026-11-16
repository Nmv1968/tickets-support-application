import type { NestExpressApplication } from '@nestjs/platform-express';
import { trustedProxyHops } from './common/throttle';
import { malformedJsonInSpanish, validationPipe } from './common/validation';

/** What main.ts sets on the application besides its module, apart so that tests set the same. */
export function configureApp(app: NestExpressApplication, env: NodeJS.ProcessEnv = process.env): void {
  // nginx appends the address it sees to X-Forwarded-For: req.ip is that one, the address the
  // limits per client count. The addresses a client writes in the header itself, to its left,
  // are never believed.
  app.set('trust proxy', trustedProxyHops(env));
  app.setGlobalPrefix('api');
  // Nest's own JSON parser, the same it would add when it starts (it adds none once there is
  // one), registered here so that its error handler can follow it.
  app.useBodyParser('json');
  app.use(malformedJsonInSpanish);
  app.useGlobalPipes(validationPipe());
}
