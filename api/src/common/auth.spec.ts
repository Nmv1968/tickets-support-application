import { Controller, ForbiddenException, Get, Module, RequestMethod, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext, INestApplication, Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma.service';
import { SettingsController } from '../settings/settings.controller';
import { SettingsService } from '../settings/settings.service';
import { apiControllers } from '../testing';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { ADMIN_ONLY_MESSAGE, AdminOnly, CurrentUser, JwtGuard, Public, RolesGuard, SESSION_OVER_MESSAGE, authUser } from './auth';
import type { AuthUser } from './auth';
import { ADMIN_USER, startedApp } from './testing';

// @nestjs/config is published as ES modules only, which Jest does not load here, and the real one
// would read the .env files of whoever runs the tests (see app.module.spec.ts). The tokens of these
// tests are names: the stand-in of JwtService says whose each one is.
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));

const admin = ADMIN_USER;
const agent: AuthUser = { id: 2, username: 'ana', name: 'Ana', role: 'AGENT' };

/** Every 401 of the guards: in Spanish, where Nest's own says `Unauthorized`. The web goes back to the login with it. */
const SESSION_OVER = new UnauthorizedException(SESSION_OVER_MESSAGE);

/** What `attempt` throws. */
function thrownBy(attempt: () => unknown): unknown {
  try {
    attempt();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** What a guard is asked about: one route of one controller, for a request of this user. */
function contextFor(controller: Type, method: string, user?: AuthUser, headers: Record<string, string> = {}): ExecutionContext & { request: { user?: AuthUser } } {
  const req = { user, headers };
  return {
    request: req,
    getHandler: () => (controller.prototype as Record<string, unknown>)[method],
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext & { request: { user?: AuthUser } };
}

/** What RolesGuard answers an agent for this route: let through, or refused. */
function agentMay(controller: Type, method: string): boolean {
  try {
    return new RolesGuard(new Reflector()).canActivate(contextFor(controller, method, agent));
  } catch (error) {
    if (error instanceof ForbiddenException) return false;
    throw error;
  }
}

describe('RolesGuard', () => {
  @Controller('demo')
  class DemoController {
    @Get('open')
    open(): void {}

    @AdminOnly()
    @Get('closed')
    closed(): void {}
  }

  @AdminOnly()
  @Controller('whole')
  class WholeController {
    @Get()
    any(): void {}
  }

  const guard = new RolesGuard(new Reflector());

  it('lets an administrator use a route marked @AdminOnly()', () => {
    expect(guard.canActivate(contextFor(DemoController, 'closed', admin))).toBe(true);
    expect(guard.canActivate(contextFor(WholeController, 'any', admin))).toBe(true);
  });

  it('answers 403 to an agent there, in Spanish, on the route or on its whole controller', () => {
    for (const [controller, method] of [
      [DemoController, 'closed'],
      [WholeController, 'any'],
    ] as const) {
      const attempt = (): boolean => guard.canActivate(contextFor(controller, method, agent));
      expect(attempt).toThrow(ForbiddenException);
      expect(attempt).toThrow(ADMIN_ONLY_MESSAGE);
    }
    expect(ADMIN_ONLY_MESSAGE).toBe('Solo un administrador puede hacer esto.');
  });

  it('lets anybody through a route that is not marked, and asks for a session on one that is', () => {
    expect(guard.canActivate(contextFor(DemoController, 'open', agent))).toBe(true);
    // A public route has no user, and is never marked.
    expect(guard.canActivate(contextFor(DemoController, 'open'))).toBe(true);
    expect(thrownBy(() => guard.canActivate(contextFor(DemoController, 'closed')))).toEqual(SESSION_OVER);
  });
});

// Every route of the API, as an agent finds it. Anything new for administrators only is added
// here on purpose; a route that loses its mark by mistake, or never got it, fails this test.
describe('the routes only an administrator may use', () => {
  const controllers = apiControllers();

  /** "METHOD /path" of every route of a controller, with its method name. */
  const routes = (controller: Type): { route: string; method: string }[] => {
    const base = String(Reflect.getMetadata(PATH_METADATA, controller) ?? '').replace(/^\/|\/$/g, '');
    return Object.getOwnPropertyNames(controller.prototype)
      .filter((method) => Reflect.hasMetadata(METHOD_METADATA, (controller.prototype as Record<string, object>)[method]))
      .map((method) => {
        const handler = (controller.prototype as Record<string, object>)[method];
        const verb = RequestMethod[Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod];
        const path = String(Reflect.getMetadata(PATH_METADATA, handler) ?? '').replace(/^\/|\/$/g, '');
        return { route: `${verb} /${[base, path].filter(Boolean).join('/')}`, method };
      });
  };

  const all = controllers.flatMap((controller) => routes(controller).map((entry) => ({ ...entry, controller })));
  const closed = all.filter((entry) => !agentMay(entry.controller, entry.method)).map((entry) => entry.route);

  it('are the users, the AI configuration and the settings of the whole team', () => {
    expect(closed.sort()).toEqual(
      [
        // Users: the list stays open, the case list names who registered each case.
        'POST /users',
        'PATCH /users/:id',
        // The AI provider: keys, addresses, models and the test of the connection. Drafting with it is for everyone.
        'GET /ai/config',
        'PUT /ai/config/:provider',
        'POST /ai/models',
        'POST /ai/test/:provider',
        // Writes of the team settings. Reading them stays open: the case forms and the bell use them.
        'PUT /sla',
        'PUT /branding/logo',
        'DELETE /branding/logo',
        'PUT /settings/reminders',
      ].sort(),
    );
  });

  // The case forms and the MCP server add entries to the catalogs as they go.
  it('leave the cases, the catalogs and what each user keeps to every agent', () => {
    const open = all.map((entry) => entry.route).filter((route) => !closed.includes(route));

    expect(open).toEqual(
      expect.arrayContaining([
        'GET /users',
        'GET /auth/me',
        'POST /auth/password',
        'GET /ai/status',
        'POST /ai/analyze',
        'POST /ai/reply/:ticketId',
        'POST /tickets',
        'PATCH /tickets/:id',
        'POST /companies',
        'PATCH /companies/:id',
        'POST /assignees',
        'POST /support-types',
        'POST /modules',
        'PATCH /modules/:id',
        'GET /sla',
        'GET /settings/reminders',
        'PUT /preferences/:key',
        'POST /import',
      ]),
    );
    // The search above is only as good as the routes it found.
    expect(all.length).toBeGreaterThan(50);
  });
});

describe('JwtGuard and @Public()', () => {
  @Controller('demo')
  class DemoController {
    @Public()
    @Get('open')
    open(): void {}

    @Get('closed')
    closed(): void {}
  }

  @Public()
  @Controller('whole')
  class WholeController {
    @Get()
    any(): void {}
  }

  /** The guard over a database where `ana` is an active agent, with what it was asked about. */
  const guarded = () => {
    const verifyAsync = jest.fn((token: string) => (token === 'de-ana' ? Promise.resolve({ sub: 2, ver: 0 }) : Promise.reject(new Error('firma'))));
    const findUnique = jest.fn().mockResolvedValue({ ...agent, active: true, tokenVersion: 0 });
    const guard = new JwtGuard({ verifyAsync } as unknown as JwtService, new Reflector(), { user: { findUnique } } as unknown as PrismaService);
    return { guard, verifyAsync, findUnique };
  };

  // The login and the logo of the login page: nobody has a token yet.
  it('lets a request through a route marked @Public(), or of a controller marked so, without a token and without reading anything', async () => {
    const { guard, verifyAsync, findUnique } = guarded();

    await expect(guard.canActivate(contextFor(DemoController, 'open'))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor(WholeController, 'any'))).resolves.toBe(true);

    expect(verifyAsync).not.toHaveBeenCalled();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('answers 401 without a token on the route next to it, which is not marked', async () => {
    const { guard } = guarded();

    await expect(guard.canActivate(contextFor(DemoController, 'closed'))).rejects.toEqual(SESSION_OVER);
    await expect(guard.canActivate(contextFor(DemoController, 'closed', undefined, { authorization: 'Bearer de-ana' }))).resolves.toBe(true);
  });

  // Whatever else the header holds is never taken for a token, nor checked as one.
  it('checks only the token after "Bearer "', async () => {
    const { guard, verifyAsync } = guarded();

    for (const authorization of ['de-ana', 'Basic de-ana', 'Token: de-ana', 'Bearerde-ana', '']) {
      await expect(guard.canActivate(contextFor(DemoController, 'closed', undefined, { authorization }))).rejects.toEqual(SESSION_OVER);
    }
    expect(verifyAsync).not.toHaveBeenCalled();

    await guard.canActivate(contextFor(DemoController, 'closed', undefined, { authorization: 'Bearer de-ana' }));
    expect(verifyAsync.mock.calls).toEqual([['de-ana']]);
  });
});

// The login answers it, and JwtGuard puts it on each request: the hash, the state and the version stay in the database.
describe('the user of a session', () => {
  it('is who the stored user is and nothing else', () => {
    const stored = { id: 5, username: 'ana', name: 'Ana', role: 'AGENT' as const, active: true, passwordHash: 'hash', tokenVersion: 3 };

    expect(authUser(stored)).toEqual({ id: 5, username: 'ana', name: 'Ana', role: 'AGENT' });
  });
});

describe('@CurrentUser()', () => {
  /** What the decorator gives a route for a request that carries `user`. */
  const currentUserOf = (user?: AuthUser): AuthUser => {
    class Demo {
      route(@CurrentUser() user: AuthUser): AuthUser {
        return user;
      }
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Demo, 'route') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => AuthUser }>;
    const [{ factory }] = Object.values(args);
    return factory(undefined, contextFor(Demo, 'route', user));
  };

  it('gives the route the user JwtGuard loaded for the request', () => {
    expect(currentUserOf(agent)).toBe(agent);
  });

  // On a public route by mistake, it must not act for nobody.
  it('answers 401 when the request has no user', () => {
    expect(thrownBy(() => currentUserOf())).toEqual(SESSION_OVER);
  });
});

describe('JwtGuard and the role', () => {
  // The token still says ADMIN: it was signed before an administrator made this person an agent.
  it('takes the role from the database, never from the token', async () => {
    const jwt = { verifyAsync: jest.fn().mockResolvedValue({ sub: 2, role: 'ADMIN', ver: 0 }) };
    const findUnique = jest.fn().mockResolvedValue({ ...agent, active: true, tokenVersion: 0 });
    const guard = new JwtGuard(jwt as unknown as JwtService, new Reflector(), { user: { findUnique } } as unknown as PrismaService);
    const context = contextFor(UsersController, 'create', undefined, { authorization: 'Bearer viejo' });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 2 }, select: expect.objectContaining({ role: true }) as object }));
    expect(context.request.user).toEqual(agent);
    expect(agentMay(UsersController, 'create')).toBe(false);
  });
});

// A password changed or reset, a role changed, a user deactivated: one more in the version of the
// user, and every token signed before is refused, wherever it is kept.
describe('JwtGuard and the version of the sessions', () => {
  /** The guard over a user stored with this version and state, asked about a token that says `payload`. */
  const check = (payload: object, stored: { tokenVersion: number; active?: boolean } | null) => {
    const findUnique = jest.fn().mockResolvedValue(stored && { ...agent, active: true, ...stored });
    const guard = new JwtGuard({ verifyAsync: jest.fn().mockResolvedValue(payload) } as unknown as JwtService, new Reflector(), {
      user: { findUnique },
    } as unknown as PrismaService);
    const context = contextFor(UsersController, 'list', undefined, { authorization: 'Bearer token' });
    return { findUnique, context, result: guard.canActivate(context) };
  };

  it('lets through the token that carries the version the user has now', async () => {
    const { result, findUnique, context } = check({ sub: 2, role: 'AGENT', ver: 3 }, { tokenVersion: 3 });

    await expect(result).resolves.toBe(true);
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ select: expect.objectContaining({ tokenVersion: true }) as object }));
    expect(context.request.user).toEqual(agent);
  });

  it('answers 401 to a token signed before the last change, and to one of a version not reached yet', async () => {
    await expect(check({ sub: 2, role: 'AGENT', ver: 2 }, { tokenVersion: 3 }).result).rejects.toEqual(SESSION_OVER);
    await expect(check({ sub: 2, role: 'AGENT', ver: 4 }, { tokenVersion: 3 }).result).rejects.toEqual(SESSION_OVER);
  });

  // Signed for seven days by the version before this one, and nothing could end them.
  it('answers 401 to a token without a version, even for a user who never changed anything', async () => {
    const { result, findUnique } = check({ sub: 2, role: 'AGENT' }, { tokenVersion: 0 });

    await expect(result).rejects.toEqual(SESSION_OVER);
    // Refused on what the token says, before the database is asked.
    expect(findUnique).not.toHaveBeenCalled();
    await expect(check({ sub: 2, ver: '0' }, { tokenVersion: 0 }).result).rejects.toEqual(SESSION_OVER);
    await expect(check({ sub: '2', ver: 0 }, { tokenVersion: 0 }).result).rejects.toEqual(SESSION_OVER);
  });

  it('answers 401 to an inactive user and to one that no longer exists, whatever the version', async () => {
    await expect(check({ sub: 2, role: 'AGENT', ver: 0 }, { tokenVersion: 0, active: false }).result).rejects.toEqual(SESSION_OVER);
    await expect(check({ sub: 2, role: 'AGENT', ver: 0 }, null).result).rejects.toEqual(SESSION_OVER);
  });

  it('answers 401 to a token whose signature or date does not hold, and to a request without one', async () => {
    const guard = new JwtGuard({ verifyAsync: jest.fn().mockRejectedValue(new Error('jwt expired')) } as unknown as JwtService, new Reflector(), {
      user: { findUnique: jest.fn() },
    } as unknown as PrismaService);

    await expect(guard.canActivate(contextFor(UsersController, 'list', undefined, { authorization: 'Bearer vencido' }))).rejects.toEqual(SESSION_OVER);
    await expect(guard.canActivate(contextFor(UsersController, 'list', undefined, {}))).rejects.toEqual(SESSION_OVER);
  });
});

// The two guards as the API registers them, over real controllers: what a client gets back.
describe('an agent and an administrator, through HTTP', () => {
  let app: INestApplication<App>;
  const people: Record<string, AuthUser> = { admin, agent };
  const updated = { id: 2, username: 'ana', name: 'Ana', active: true, passwordHash: 'x', role: 'AGENT' };

  beforeAll(async () => {
    @Module({
      controllers: [UsersController, SettingsController],
      providers: [
        // The token is the name of whose session it is.
        {
          provide: JwtService,
          useValue: { verifyAsync: (token: string) => (people[token] ? Promise.resolve({ sub: people[token].id, ver: 0 }) : Promise.reject(new Error('firma'))) },
        },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findUnique: ({ where }: { where: { id: number } }) =>
                Promise.resolve({ ...Object.values(people).find((person) => person.id === where.id), active: true, tokenVersion: 0 }),
              findMany: () => Promise.resolve([updated]),
              update: () => Promise.resolve(updated),
            },
          },
        },
        { provide: SettingsService, useValue: { setStaleHours: () => Promise.resolve(), setPromiseSoonDays: () => Promise.resolve() } },
        UsersService,
        EventsService,
        { provide: APP_GUARD, useClass: JwtGuard },
        { provide: APP_GUARD, useClass: RolesGuard },
      ],
    })
    class TestModule {}

    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    app = await startedApp(moduleRef);
  });

  afterAll(() => app.close());

  const as = (who: string) => ({
    get: (path: string) => request(app.getHttpServer()).get(`/api/${path}`).set('Authorization', `Bearer ${who}`),
    patch: (path: string, body: object) => request(app.getHttpServer()).patch(`/api/${path}`).set('Authorization', `Bearer ${who}`).send(body),
    put: (path: string, body: object) => request(app.getHttpServer()).put(`/api/${path}`).set('Authorization', `Bearer ${who}`).send(body),
  });

  it('answers 403 to the agent, with the message in Spanish, and does nothing', async () => {
    for (const response of [await as('agent').patch('users/2', { password: 'secreto2' }), await as('agent').put('settings/reminders', { staleHours: 1 })]) {
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ statusCode: 403, error: 'Forbidden', message: 'Solo un administrador puede hacer esto.' });
    }
  });

  it('lets the agent read the users, and the administrator change them', async () => {
    expect((await as('agent').get('users')).status).toBe(200);
    expect((await as('admin').patch('users/2', { name: 'Ana María' })).status).toBe(200);
    expect((await as('admin').put('settings/reminders', { staleHours: 1 })).status).toBe(204);
  });

  // The login check runs first: without a session the answer is 401, not 403.
  it('answers 401 without a valid session, to an administrator route too, in Spanish', async () => {
    const answer = await as('nadie').put('settings/reminders', { staleHours: 1 });

    expect(answer.status).toBe(401);
    expect(answer.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'La sesión terminó o no es válida. Vuelve a ingresar.' });
  });
});
