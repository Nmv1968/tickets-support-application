import { Controller, Get, Module } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AuthController } from '../auth/auth.controller';
import { AuthService } from '../auth/auth.service';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma.service';
import { retryAfterSeconds } from './retry-after';
import { tokenPayload } from './session-token';
import { startedApp } from './testing';
import { RATE_WINDOW_MS, THROTTLE_ENV, clientAddress, failedLoginLimit, requestTracker, throttleEnvValue, throttlerOptions, trustedProxyHops } from './throttle';

@Controller('ping')
class PingController {
  @Get()
  ping(): string {
    return 'ok';
  }

  @Get('other')
  other(): string {
    return 'ok';
  }
}

const SECRET = 'secreto-de-las-pruebas-de-los-limites-de-32-caracteres';
const LOGIN_MESSAGE = 'Demasiados intentos de ingreso desde este equipo. Espera un minuto y vuelve a intentarlo.';
const LOCKED_MESSAGE = 'Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.';
const ADDRESS_MESSAGE = 'Demasiadas solicitudes desde este equipo. Espera un minuto y vuelve a intentarlo.';
const USER_MESSAGE = 'Demasiadas solicitudes con este usuario. Espera un minuto y vuelve a intentarlo.';

/** The two users of the fake database; a low bcrypt cost keeps the logins quick. */
const USERS = [
  { id: 1, username: 'ana', name: 'Ana', active: true, passwordHash: hashSync('clave-ana', 4), role: 'AGENT' as const, tokenVersion: 0 },
  { id: 2, username: 'luis', name: 'Luis', active: true, passwordHash: hashSync('clave-luis', 4), role: 'AGENT' as const, tokenVersion: 0 },
];

/** Signs the tokens of the app under test, as JwtModule does with JWT_SECRET. */
const jwt = new JwtService({ secret: SECRET, signOptions: { expiresIn: 3600 } });
const bearer = (user: (typeof USERS)[number]) => jwt.signAsync(tokenPayload(user)).then((token) => `Bearer ${token}`);

/**
 * The limits as the API sets them (`throttlerOptions`, `configureApp`, the counters of the login),
 * over the login route and two routes of a stand-in. LOGIN_RATE_LIMIT is read when the service of
 * the login is created, as in the API: from process.env, set for that moment.
 */
async function startApp(env: NodeJS.ProcessEnv): Promise<INestApplication<App>> {
  @Module({
    imports: [ThrottlerModule.forRoot(throttlerOptions(env, jwt))],
    controllers: [AuthController, PingController],
    providers: [
      { provide: PrismaService, useValue: { user: { findUnique: ({ where }: { where: { username: string } }) => Promise.resolve(USERS.find((user) => user.username === where.username) ?? null) } } },
      { provide: JwtService, useValue: jwt },
      AuthService,
      EventsService,
      { provide: APP_GUARD, useClass: ThrottlerGuard },
    ],
  })
  class TestModule {}

  const saved = process.env.LOGIN_RATE_LIMIT;
  if (env.LOGIN_RATE_LIMIT === undefined) delete process.env.LOGIN_RATE_LIMIT;
  else process.env.LOGIN_RATE_LIMIT = env.LOGIN_RATE_LIMIT;
  try {
    const moduleRef = await Test.createTestingModule({ imports: [TestModule] }).compile();
    return await startedApp(moduleRef, env);
  } finally {
    if (saved === undefined) delete process.env.LOGIN_RATE_LIMIT;
    else process.env.LOGIN_RATE_LIMIT = saved;
  }
}

describe('the limits', () => {
  let app: INestApplication<App> | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  let attempt = 0;
  /**
   * A login from the client that nginx saw at `ip` (it appends that address to X-Forwarded-For).
   * A failed one, unless a password is given, each with another username: the lock of a username
   * after five failures is not what these tests look at.
   */
  const login = (ip: string, forwardedFor = ip, as?: { username: string; password: string }) =>
    request(app!.getHttpServer())
      .post('/api/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send(as ?? { username: `nadie-${++attempt}`, password: 'x' });
  const loginAs = (ip: string, username: string, password: string) => login(ip, ip, { username, password });

  const ping = (ip: string, authorization?: string, path = '/api/ping') => {
    const sent = request(app!.getHttpServer()).get(path).set('X-Forwarded-For', ip);
    return authorization ? sent.set('Authorization', authorization) : sent;
  };

  describe('failed logins of an address', () => {
    it('answer 429 in Spanish past the failed logins of LOGIN_RATE_LIMIT, the right password too, with Retry-After', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '3' });

      for (let i = 0; i < 3; i++) expect((await login('10.0.0.5')).status).toBe(401);
      const refused = await loginAs('10.0.0.5', 'ana', 'clave-ana');

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ statusCode: 429, message: LOGIN_MESSAGE });
      expect(refused.headers['retry-after']).toBe('60');
      // The header of the throttler of logins this counter replaced, with a name of its own, is gone.
      expect(refused.headers['retry-after-login']).toBeUndefined();
    });

    // Every client of Docker Desktop reaches nginx from the address of the Docker gateway.
    it('do not count the logins that work: a whole team behind one address logs in', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '2' });

      for (let i = 0; i < 10; i++) expect((await loginAs('172.19.0.1', i % 2 ? 'ana' : 'luis', i % 2 ? 'clave-ana' : 'clave-luis')).status).toBe(200);
      expect((await login('172.19.0.1')).status).toBe(401);
      expect((await loginAs('172.19.0.1', 'ana', 'clave-ana')).status).toBe(200);
      expect((await login('172.19.0.1')).status).toBe(401);

      expect((await loginAs('172.19.0.1', 'ana', 'clave-ana')).status).toBe(429);
    });

    it('count each address apart: another computer still logs in', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '2' });
      await login('10.0.0.5');
      await login('10.0.0.5');
      expect((await login('10.0.0.5')).status).toBe(429);

      expect((await login('10.0.0.6')).status).toBe(401);
      expect((await loginAs('10.0.0.6', 'ana', 'clave-ana')).status).toBe(200);
    });

    it('refuse only the logins: the rest of the API answers that address', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '1' });
      await login('10.0.0.5');
      expect((await login('10.0.0.5')).status).toBe(429);

      for (let i = 0; i < 5; i++) expect((await ping('10.0.0.5')).status).toBe(200);
    });

    it('are 20 a minute from one address when the variable is not set', async () => {
      app = await startApp({});

      for (let i = 0; i < 20; i++) expect((await login('10.0.0.5')).status).toBe(401);
      expect((await login('10.0.0.5')).status).toBe(429);
    });
  });

  it('answers the 429 of a locked username with Retry-After, from any address', async () => {
    app = await startApp({});
    for (let i = 0; i < 5; i++) expect((await login(`10.0.1.${i}`, `10.0.1.${i}`, { username: 'ana', password: 'mal' })).status).toBe(401);

    const locked = await loginAs('10.0.2.1', 'ana', 'clave-ana');

    expect(locked.status).toBe(429);
    expect(locked.body).toEqual({ statusCode: 429, message: LOCKED_MESSAGE });
    expect(locked.headers['retry-after']).toBe('60');
  });

  describe('the general limit', () => {
    it('answers 429 in Spanish past the requests of API_RATE_LIMIT without a token, counted over every route, with Retry-After', async () => {
      app = await startApp({ API_RATE_LIMIT: '4' });

      expect((await ping('10.0.0.5')).status).toBe(200);
      expect((await ping('10.0.0.5', undefined, '/api/ping/other')).status).toBe(200);
      expect((await login('10.0.0.5')).status).toBe(401);
      expect((await ping('10.0.0.5', undefined, '/api/ping/other')).status).toBe(200);
      const refused = await ping('10.0.0.5');

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ statusCode: 429, message: ADDRESS_MESSAGE });
      expect(refused.headers['retry-after']).toBe('60');
      // The login counts for the general limit too.
      expect((await login('10.0.0.5')).status).toBe(429);
      expect((await ping('10.0.0.6')).status).toBe(200);
    });

    // Behind Docker Desktop the whole team comes from one address: each person has the limit.
    it('gives each user with a valid token a budget of their own, even from one address', async () => {
      app = await startApp({ API_RATE_LIMIT: '3' });
      const ana = await bearer(USERS[0]);
      const luis = await bearer(USERS[1]);

      for (let i = 0; i < 3; i++) expect((await ping('172.19.0.1', ana)).status).toBe(200);
      const refused = await ping('172.19.0.1', ana);

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ statusCode: 429, message: USER_MESSAGE });
      expect(refused.headers['retry-after']).toBe('60');
      for (let i = 0; i < 3; i++) expect((await ping('172.19.0.1', luis)).status).toBe(200);
      expect((await ping('172.19.0.1', luis)).status).toBe(429);
      // The address has its own, for the requests without a session.
      expect((await ping('172.19.0.1')).status).toBe(200);
    });

    // A token the API refuses since a change of password, but that has not expired: whoever kept
    // it could otherwise send requests with it until the user's own sessions were refused too.
    it('gives a token of an earlier version of the sessions a budget apart from the sessions that stand', async () => {
      app = await startApp({ API_RATE_LIMIT: '3' });
      const revoked = await bearer(USERS[0]);
      const current = await bearer({ ...USERS[0], tokenVersion: 1 });

      for (let i = 0; i < 3; i++) expect((await ping('172.19.0.1', revoked)).status).toBe(200);
      expect((await ping('172.19.0.1', revoked)).status).toBe(429);

      for (let i = 0; i < 3; i++) expect((await ping('172.19.0.1', current)).status).toBe(200);
      const refused = await ping('172.19.0.1', current);
      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ statusCode: 429, message: USER_MESSAGE });
    });

    it('counts a user as one wherever the requests come from', async () => {
      app = await startApp({ API_RATE_LIMIT: '2' });
      const ana = await bearer(USERS[0]);

      expect((await ping('10.0.0.5', ana)).status).toBe(200);
      expect((await ping('10.0.0.6', ana)).status).toBe(200);

      expect((await ping('10.0.0.7', ana)).status).toBe(429);
    });

    // Or anyone could make up a token for every request and never be counted.
    it('counts a request with a forged, expired or malformed token against its address', async () => {
      app = await startApp({ API_RATE_LIMIT: '4' });
      const forged = await new JwtService({ secret: 'otro-secreto-de-otra-instalacion-de-32-caracteres' }).signAsync(tokenPayload(USERS[0]));
      const expired = await new JwtService({ secret: SECRET }).signAsync({ ...tokenPayload(USERS[0]), exp: Math.floor(Date.now() / 1000) - 10 });
      // Signed by this API, but not a session token: no user, no version.
      const noUser = await new JwtService({ secret: SECRET }).signAsync({ role: 'ADMIN' });

      for (const authorization of [`Bearer ${forged}`, `Bearer ${expired}`, `Bearer ${noUser}`]) {
        expect((await ping('10.0.0.5', authorization)).status).toBe(200);
      }
      expect((await ping('10.0.0.5')).status).toBe(200);
      const refused = await ping('10.0.0.5', `Bearer ${forged}`);

      expect(refused.status).toBe(429);
      expect(refused.body).toEqual({ statusCode: 429, message: ADDRESS_MESSAGE });
      // The user of that token was never counted.
      expect((await ping('10.0.0.5', await bearer(USERS[0]))).status).toBe(200);
    });
  });

  describe('the address of the client', () => {
    // nginx sends "what the client wrote, the address nginx saw": only the last one is believed.
    it('is the one nginx appended to X-Forwarded-For, never one the client wrote before it', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '2' });
      await login('10.0.0.5');
      await login('10.0.0.5');

      expect((await login('10.0.0.5', '203.0.113.7, 10.0.0.5')).status).toBe(429);
      expect((await login('10.0.0.5', '203.0.113.8, 198.51.100.1, 10.0.0.5')).status).toBe(429);
    });

    it('is the second from the end with TRUST_PROXY_HOPS=2, for a proxy in front of nginx', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '1', TRUST_PROXY_HOPS: '2' });
      expect((await login('', '10.0.0.5, 172.18.0.2')).status).toBe(401);
      expect((await login('', '10.0.0.5, 172.18.0.2')).status).toBe(429);

      expect((await login('', '10.0.0.6, 172.18.0.2')).status).toBe(401);
    });

    it('is the one of the connection with TRUST_PROXY_HOPS=0: the header is not believed at all', async () => {
      app = await startApp({ LOGIN_RATE_LIMIT: '1', TRUST_PROXY_HOPS: '0' });
      expect((await login('10.0.0.5')).status).toBe(401);

      expect((await login('10.0.0.6')).status).toBe(429);
    });

    // As the throttler library groups them for its own key: one machine has a whole /64 of them.
    it('groups IPv6 addresses by their /64 network, and reads an IPv4 one written as IPv6', () => {
      expect(clientAddress('2001:db8:1:2:aaaa::1')).toBe(clientAddress('2001:db8:1:2:bbbb::2'));
      expect(clientAddress('2001:db8:1:2::1')).not.toBe(clientAddress('2001:db8:1:3::1'));
      expect(clientAddress('::ffff:10.0.0.5')).toBe('10.0.0.5');
      expect(clientAddress(undefined)).toBe('');
    });
  });
});

describe('whose budget a request spends', () => {
  const req = (authorization?: string, ip = '10.0.0.5') => ({ headers: { authorization }, ip }) as unknown as Parameters<typeof requestTracker>[0];

  // Only the signature and the expiry: whether the user is still active is for JwtGuard, after it.
  it('is its user and the version of the sessions of the token, with a valid session token, without reading any database', async () => {
    expect(await requestTracker(req(await bearer(USERS[1])), jwt)).toBe('user:2:0');
    expect(await requestTracker(req(await bearer({ ...USERS[1], tokenVersion: 4 })), jwt)).toBe('user:2:4');
  });

  it.each([
    ['no token', undefined],
    ['a token sent another way', 'Basic abc'],
    ['a token that is not one', 'Bearer basura'],
  ])('is its address with %s', async (_case, authorization) => {
    expect(await requestTracker(req(authorization), jwt)).toBe('ip:10.0.0.5');
  });
});

describe('the seconds of Retry-After', () => {
  it.each([
    [0, 1],
    [1, 1],
    [1000, 1],
    [1001, 2],
    [59_999, 60],
    [60_000, 60],
  ])('for %d ms left are %d', (ms, seconds) => {
    expect(retryAfterSeconds(ms)).toBe(seconds);
  });
});

describe('the variables of the limits', () => {
  it.each([
    ['LOGIN_RATE_LIMIT', 20],
    ['API_RATE_LIMIT', 1000],
    ['TRUST_PROXY_HOPS', 1],
  ] as const)('%s is %d when it is not set or empty', (name, fallback) => {
    expect(THROTTLE_ENV[name].fallback).toBe(fallback);
    for (const value of [undefined, '', '  ']) expect(throttleEnvValue({ [name]: value }, name)).toBe(fallback);
  });

  it('reads whole numbers, the spaces around them aside', () => {
    expect(throttleEnvValue({ LOGIN_RATE_LIMIT: ' 25 ' }, 'LOGIN_RATE_LIMIT')).toBe(25);
    expect(throttleEnvValue({ TRUST_PROXY_HOPS: '0' }, 'TRUST_PROXY_HOPS')).toBe(0);
    expect(failedLoginLimit({ LOGIN_RATE_LIMIT: '25' })).toBe(25);
    expect(failedLoginLimit({})).toBe(20);
    expect(throttlerOptions({ API_RATE_LIMIT: '5000' }, jwt)).toMatchObject({ throttlers: [{ limit: 5000 }] });
    expect(trustedProxyHops({ TRUST_PROXY_HOPS: '2' })).toBe(2);
    expect(trustedProxyHops({})).toBe(1);
  });

  // The logins have a counter of their own, of failures (AddressFailures): no throttler of the library counts them.
  it('give the throttler library one limit, the general one, of 1000 requests a minute when it is not set', () => {
    expect(throttlerOptions({}, jwt)).toMatchObject({ throttlers: [{ name: 'default', ttl: RATE_WINDOW_MS, limit: 1000 }] });
    expect((throttlerOptions({}, jwt) as { throttlers: unknown[] }).throttlers).toHaveLength(1);
    expect(RATE_WINDOW_MS).toBe(60_000);
  });

  it.each(['0', '-1', '1.5', 'diez', '1e3', '99999999999999999999'])('refuses %s as a limit', (value) => {
    expect(throttleEnvValue({ LOGIN_RATE_LIMIT: value }, 'LOGIN_RATE_LIMIT')).toBeNull();
    expect(throttleEnvValue({ API_RATE_LIMIT: value }, 'API_RATE_LIMIT')).toBeNull();
  });

  it.each(['-1', '1.5', 'true', 'loopback'])('refuses %s as a number of proxies', (value) => {
    expect(throttleEnvValue({ TRUST_PROXY_HOPS: value }, 'TRUST_PROXY_HOPS')).toBeNull();
  });
});
