import type { JwtService } from '@nestjs/jwt';
import type { Role } from '@prisma/client';

/** What a login token says. */
export interface TokenPayload {
  sub: number;
  /** For whoever reads the token; the API reads the role from the database (`JwtGuard`). */
  role: Role;
  /** `User.tokenVersion` when the token was signed: a token with any other is refused. */
  ver: number;
  /**
   * When the token stops being accepted, in seconds since 1970. The signature adds it, from the
   * lifetime of `jwtOptions`: it is in every token this API reads, and never in one it signs.
   */
  exp?: number;
}

/**
 * What the login token of an `Authorization: Bearer ...` header says, when this API signed it, it
 * has not expired and it names a user and a version of the sessions; null for anything else. It
 * reads no database: whether that user is still active and that version still theirs is for
 * `JwtGuard`. The limit per user of the API (`throttle.ts`) reads it the same way.
 */
export async function verifiedPayload(jwt: JwtService, authorization: string | undefined): Promise<TokenPayload | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  let payload: Partial<TokenPayload>;
  try {
    payload = await jwt.verifyAsync<Partial<TokenPayload>>(authorization.slice(7));
  } catch {
    return null;
  }
  return Number.isInteger(payload.sub) && Number.isInteger(payload.ver) ? (payload as TokenPayload) : null;
}

/** What the token of a session of this user says, as the user is stored now. */
export function tokenPayload(user: { id: number; role: Role; tokenVersion: number }): TokenPayload {
  return { sub: user.id, role: user.role, ver: user.tokenVersion };
}

/**
 * Written with a change of the password, the role or the active state of a user: every token of
 * that user signed before is refused from then on, so the sessions open anywhere end (`JwtGuard`).
 */
export const END_SESSIONS = { tokenVersion: { increment: 1 } };

/** How long a login token lasts when JWT_EXPIRES_IN is not set: a working day, then a new login. */
export const DEFAULT_TOKEN_LIFETIME = '12h';

const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86_400 };

/** A whole number and its unit, as in `30m`, `12h` or `7d`, in seconds; null for anything else. */
function seconds(text: string): number | null {
  const match = /^(\d+)([smhd])$/.exec(text);
  if (!match) return null;
  const value = Number(match[1]) * UNIT_SECONDS[match[2]];
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The seconds a login token lasts, from JWT_EXPIRES_IN: its default when it is not set, null when
 * it cannot be read (`checkEnv` refuses such a value before the API starts). A number without a
 * unit is refused on purpose: the library that signs the tokens would read the text "3600" as
 * milliseconds.
 */
export function tokenLifetimeSeconds(env: NodeJS.ProcessEnv): number | null {
  return seconds(env.JWT_EXPIRES_IN?.trim() || DEFAULT_TOKEN_LIFETIME);
}

/** What JwtModule signs and checks the login tokens with. */
export function jwtOptions(env: NodeJS.ProcessEnv): { secret: string; signOptions: { expiresIn: number } } {
  const secret = env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  // checkEnv stops the API before this with a lifetime it cannot read: the default is only a fallback.
  return { secret, signOptions: { expiresIn: tokenLifetimeSeconds(env) ?? (seconds(DEFAULT_TOKEN_LIFETIME) as number) } };
}
