import type { JwtService } from '@nestjs/jwt';
import { normalizeIp } from '@nestjs/throttler';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import { verifiedPayload } from './session-token';

/** The limits count in windows of this length: the requests of each user or address, the failed logins of each address. */
export const RATE_WINDOW_MS = 60_000;

/**
 * The variables of .env for the limits, with the value used when one is not set and the smallest
 * one accepted. `checkEnv` refuses any other value before the API starts.
 */
export const THROTTLE_ENV = {
  /**
   * Failed logins per minute from one client address (see `AddressFailures`), on top of the lock of
   * each username. A login that works does not count.
   */
  LOGIN_RATE_LIMIT: { fallback: 20, min: 1 },
  /**
   * Requests per minute to the whole API: of each user, for a request with a valid session token;
   * of each client address, for the others (the logins among them).
   */
  API_RATE_LIMIT: { fallback: 1000, min: 1 },
  /**
   * Proxies in front of the API whose `X-Forwarded-For` is believed: 1 is the nginx of the web
   * container. With 0, the address of the connection is the client's.
   */
  TRUST_PROXY_HOPS: { fallback: 1, min: 0 },
} as const;

export type ThrottleVariable = keyof typeof THROTTLE_ENV;

/** The value of one of `THROTTLE_ENV`: its default when it is not set, null when it is not a valid number. */
export function throttleEnvValue(env: NodeJS.ProcessEnv, name: ThrottleVariable): number | null {
  const { fallback, min } = THROTTLE_ENV[name];
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min ? value : null;
}

const read = (env: NodeJS.ProcessEnv, name: ThrottleVariable): number => throttleEnvValue(env, name) ?? THROTTLE_ENV[name].fallback;

/** Failed logins a minute from one client address before its logins are refused (`LOGIN_RATE_LIMIT`). */
export function failedLoginLimit(env: NodeJS.ProcessEnv): number {
  return read(env, 'LOGIN_RATE_LIMIT');
}

/**
 * The address a limit counts for the client of a request: the `req.ip` that `trust proxy` gives
 * (see `configureApp`), as the throttler library groups it (an IPv6 address by its /64 network).
 */
export function clientAddress(ip: string | undefined): string {
  return normalizeIp(ip ?? '');
}

/**
 * Whose budget of the general limit a request spends: `user:<id>:<version>` for one with a valid
 * session token, checked as `JwtGuard` checks it but without reading the database, so a team behind
 * one address (every client of Docker Desktop reaches nginx from the same one) does not share it.
 * The version of the sessions is the token's: a token the API has since revoked (a new password,
 * another role) but that has not expired spends a budget of its own, and whoever still has it
 * cannot use up the one of the user's sessions that stand. `ip:<address>` for any other request:
 * without a token, or with one forged or expired.
 */
export async function requestTracker(req: Request, jwt: JwtService): Promise<string> {
  const payload = await verifiedPayload(jwt, req.headers.authorization);
  return payload ? `user:${payload.sub}:${payload.ver}` : `ip:${clientAddress(req.ip)}`;
}

/**
 * The general limit: `API_RATE_LIMIT` requests a minute to the whole API, whatever the route, for
 * each user or each address (`requestTracker`). Past it, 429 until the minute of that counter is
 * over, with the seconds left in `Retry-After` (the library writes it; under the name "default" it
 * has no suffix). The failed logins of each address have a counter of their own (`AddressFailures`).
 */
export function throttlerOptions(env: NodeJS.ProcessEnv, jwt: JwtService): ThrottlerModuleOptions {
  return {
    throttlers: [{ name: 'default', ttl: RATE_WINDOW_MS, limit: read(env, 'API_RATE_LIMIT') }],
    getTracker: (req) => requestTracker(req as Request, jwt),
    // Without the route in it, unlike the key of the library: the limit is for the whole API.
    generateKey: (_context, tracker, throttler) => `${throttler}:${tracker}`,
    errorMessage: (_context, detail) =>
      detail.tracker.startsWith('user:')
        ? 'Demasiadas solicitudes con este usuario. Espera un minuto y vuelve a intentarlo.'
        : 'Demasiadas solicitudes desde este equipo. Espera un minuto y vuelve a intentarlo.',
  };
}

/** For Express's `trust proxy`: the hops of `TRUST_PROXY_HOPS`, never whatever address claims to be a proxy. */
export function trustedProxyHops(env: NodeJS.ProcessEnv): number {
  return read(env, 'TRUST_PROXY_HOPS');
}
