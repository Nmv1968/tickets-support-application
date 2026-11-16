import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Role } from '@prisma/client';
import type { Request } from 'express';
import { PrismaService } from '../prisma.service';
import { sessionStands, verifiedPayload } from './session-token';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  role: Role;
}

/** The user of a session, from the user as stored: what the routes know of who is logged in. */
export function authUser(user: AuthUser): AuthUser {
  return { id: user.id, username: user.username, name: user.name, role: user.role };
}

type AuthedRequest = Request & { user?: AuthUser };

const IS_PUBLIC = 'isPublic';
const ADMIN_ONLY = 'adminOnly';

/** What an agent reads when a route is only for administrators. */
export const ADMIN_ONLY_MESSAGE = 'Solo un administrador puede hacer esto.';

/**
 * The 401 of a request without a session that stands: no token, one this API did not sign, one
 * expired, or one of sessions the API has ended. The web goes back to the login screen with it.
 */
export const SESSION_OVER_MESSAGE = 'La sesión terminó o no es válida. Vuelve a ingresar.';

/** The 401 of `SESSION_OVER_MESSAGE`. Nest's own says `Unauthorized`. */
export const sessionOver = (): UnauthorizedException => new UnauthorizedException(SESSION_OVER_MESSAGE);

/** Marks a route that does not need a login token. */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);

/** Marks a route only an administrator may use (see `RolesGuard`). Every other route is open to agents too. */
export const AdminOnly = (): MethodDecorator & ClassDecorator => SetMetadata(ADMIN_ONLY, true);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw sessionOver();
  return user;
});

/**
 * Global guard: every route needs a valid token from an active user, except @Public() ones. The
 * token must also carry the `tokenVersion` the user has now: one signed before the last change of
 * their password, role or active state is refused, and so is one signed before there were versions.
 */
@Injectable()
export class JwtGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const payload = await verifiedPayload(this.jwt, req.headers.authorization);
    if (!payload) throw sessionOver();

    // The role is read here, with the rest of the user, and never taken from the token: a token
    // signed before an administrator changed it would still say the old one.
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, username: true, name: true, active: true, role: true, tokenVersion: true },
    });
    if (!sessionStands(user, payload)) throw sessionOver();

    req.user = authUser(user);
    return true;
  }
}

/**
 * Global guard after `JwtGuard`: an `@AdminOnly()` route answers 403 to an agent. It reads the
 * user `JwtGuard` loaded from the database for this request, so the role is the one stored now.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (!this.reflector.getAllAndOverride<boolean>(ADMIN_ONLY, [ctx.getHandler(), ctx.getClass()])) return true;
    const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
    if (!user) throw sessionOver();
    if (user.role !== Role.ADMIN) throw new ForbiddenException(ADMIN_ONLY_MESSAGE);
    return true;
  }
}
