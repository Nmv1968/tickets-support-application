import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import { authUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { TooManyAttemptsException } from '../common/retry-after';
import { END_SESSIONS, tokenPayload } from '../common/session-token';
import { clientAddress, failedLoginLimit } from '../common/throttle';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma.service';
import { hashPassword, loginName } from '../users/credentials';
import { AddressFailures } from './address-failures';
import { LoginFailures } from './login-failures';

/**
 * Compared with the password typed when the username does not exist, is inactive or has no password
 * yet, so that answering takes the same bcrypt work for every username: a quicker "no" would tell
 * which usernames exist. Its cost is the one every password is hashed with (`PASSWORD_COST`).
 * Nobody knows the password behind it, and a match is never accepted anyway.
 */
export const DUMMY_HASH = '$2b$10$yEXNO5tcyjmO3K0kXnq3z.4XHGRGQh5BnO5knHOuItQE3E50KS5oi';

/** What every login from an address answers while it is over its failed logins (`LOGIN_RATE_LIMIT`). */
export const ADDRESS_LIMIT_MESSAGE = 'Demasiados intentos de ingreso desde este equipo. Espera un minuto y vuelve a intentarlo.';

/** What a login, or a change of the own password, answers while the username is locked. */
export const LOCKED_MESSAGE = 'Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.';

/** The login, and the change of the own password. Each 429 they throw says how long is left (`TooManyAttemptsException`). */
@Injectable()
export class AuthService {
  /** Shared by the login and the change of the own password: both lock the same username. */
  private readonly failures = new LoginFailures();
  // Read once ConfigModule has loaded the .env files, which it does before any provider is created.
  private readonly addresses = new AddressFailures(failedLoginLimit(process.env));

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly events: EventsService,
  ) {}

  /**
   * `ip` is the address of the client that `trust proxy` gives (see `configureApp`). Both limits
   * answer before the database or bcrypt is reached: the failed logins of the address, then the
   * lock of the username. The general limit of the API counts this route too (`throttle.ts`).
   */
  async login(sentUsername: string, password: string, ip: string | undefined): Promise<{ token: string; user: AuthUser }> {
    const address = clientAddress(ip);
    const blocked = this.addresses.blockedFor(address);
    if (blocked) throw new TooManyAttemptsException(ADDRESS_LIMIT_MESSAGE, blocked);
    // As it is stored, which is also how `LoginFailures` counts it.
    const username = loginName(sentUsername);
    this.refuseLocked(username);

    // Counted as failed before anything is awaited: logins sent all at once cannot pass the checks
    // above together and compare more passwords than the limits allow. A right one takes it back.
    const takeBack = this.addresses.fail(address);
    this.failures.fail(username);

    const user = await this.prisma.user.findUnique({ where: { username } });
    const usable = user?.active && user.passwordHash ? user.passwordHash : null;
    const matches = await compare(password, usable ?? DUMMY_HASH);
    if (!user || !usable || !matches) throw new UnauthorizedException('Usuario o contraseña incorrectos');

    takeBack();
    this.failures.clear(username);
    return {
      // The role goes in the token for whoever reads it; the API itself reads it from the database (JwtGuard).
      token: await this.jwt.signAsync(tokenPayload(user)),
      user: authUser(user),
    };
  }

  /**
   * Changes the password of the session's user. Every session they had open ends, this one too
   * (`END_SESSIONS`), and so do their open streams of events: whoever knew the old password is out.
   * The answer is a new token for this session, which the web keeps in place of the one it sent, so
   * the person stays logged in.
   *
   * A wrong current password counts as a failed login of the username, so that a session left open
   * cannot be used to guess it: five in a row, here or in the login, lock both routes for a minute.
   * Counted before the comparison, as in the login; a right one starts the count again.
   */
  async changePassword(user: AuthUser, current: string, next: string): Promise<{ token: string }> {
    const username = loginName(user.username);
    this.refuseLocked(username);
    this.failures.fail(username);

    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.passwordHash || !(await compare(current, row.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }

    this.failures.clear(username);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(next), ...END_SESSIONS } });
    this.events.sessionsEnded(user.id);
    return { token: await this.jwt.signAsync(tokenPayload(updated)) };
  }

  /** The 429 of a locked username, with the time left of its lock. */
  private refuseLocked(username: string): void {
    const locked = this.failures.lockedFor(username);
    if (locked) throw new TooManyAttemptsException(LOCKED_MESSAGE, locked);
  }
}
