import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, UnauthorizedException, UseFilters } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { RetryAfterFilter, TooManyAttemptsException } from '../common/retry-after';
import { END_SESSIONS, tokenPayload } from '../common/session-token';
import { clientAddress, failedLoginLimit } from '../common/throttle';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma.service';
import { AddressFailures } from './address-failures';
import { LoginFailures } from './login-failures';

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(60) username!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) current!: string;
  @IsString() @MinLength(6) @MaxLength(200) next!: string;
}

/**
 * Compared with the password typed when the username does not exist, is inactive or has no password
 * yet, so that answering takes the same bcrypt work for every username: a quicker "no" would tell
 * which usernames exist. Its cost (10) is the one every password is hashed with. Nobody knows the
 * password behind it, and a match is never accepted anyway.
 */
export const DUMMY_HASH = '$2b$10$yEXNO5tcyjmO3K0kXnq3z.4XHGRGQh5BnO5knHOuItQE3E50KS5oi';

/** What every login from an address answers while it is over its failed logins (`LOGIN_RATE_LIMIT`). */
export const ADDRESS_LIMIT_MESSAGE = 'Demasiados intentos de ingreso desde este equipo. Espera un minuto y vuelve a intentarlo.';

/** What a login, or a change of the own password, answers while the username is locked. */
export const LOCKED_MESSAGE = 'Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.';

/** A username as it is stored, and as `LoginFailures` counts it. */
const loginName = (username: string): string => username.trim().toLowerCase();

/** Each 429 of these routes says in `Retry-After` how long is left (`TooManyAttemptsException`). */
@UseFilters(RetryAfterFilter)
@Controller('auth')
export class AuthController {
  /** Shared by the login and the change of the own password: both lock the same username. */
  private readonly failures = new LoginFailures();
  // Read once ConfigModule has loaded the .env files, which it does before any controller is created.
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
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Ip() ip: string | undefined): Promise<{ token: string; user: AuthUser }> {
    const address = clientAddress(ip);
    const blocked = this.addresses.blockedFor(address);
    if (blocked) throw new TooManyAttemptsException(ADDRESS_LIMIT_MESSAGE, blocked);
    const username = loginName(dto.username);
    this.refuseLocked(username);

    // Counted as failed before anything is awaited: logins sent all at once cannot pass the checks
    // above together and compare more passwords than the limits allow. A right one takes it back.
    const takeBack = this.addresses.fail(address);
    this.failures.fail(username);

    const user = await this.prisma.user.findUnique({ where: { username } });
    const usable = user?.active && user.passwordHash ? user.passwordHash : null;
    const matches = await compare(dto.password, usable ?? DUMMY_HASH);
    if (!user || !usable || !matches) throw new UnauthorizedException('Usuario o contraseña incorrectos');

    takeBack();
    this.failures.clear(username);
    return {
      // The role goes in the token for whoever reads it; the API itself reads it from the database (JwtGuard).
      token: await this.jwt.signAsync(tokenPayload(user)),
      user: { id: user.id, username: user.username, name: user.name, role: user.role },
    };
  }

  /** The user of the session as stored now, role included: the web asks for it to know what to show. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
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
  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<{ token: string }> {
    const username = loginName(user.username);
    this.refuseLocked(username);
    this.failures.fail(username);

    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.passwordHash || !(await compare(dto.current, row.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }

    this.failures.clear(username);
    const updated = await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(dto.next, 10), ...END_SESSIONS } });
    this.events.sessionsEnded(user.id);
    return { token: await this.jwt.signAsync(tokenPayload(updated)) };
  }

  /** The 429 of a locked username, with the time left of its lock. */
  private refuseLocked(username: string): void {
    const locked = this.failures.lockedFor(username);
    if (locked) throw new TooManyAttemptsException(LOCKED_MESSAGE, locked);
  }
}
