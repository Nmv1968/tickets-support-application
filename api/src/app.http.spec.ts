import { mkdtempSync, rmSync } from 'node:fs';
import { get } from 'node:http';
import type { IncomingMessage, Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type { Role } from '@prisma/client';
import { hashSync } from 'bcryptjs';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from './app.module';
import { closeOnStopSignals } from './app.setup';
import { ADMIN_ONLY_MESSAGE, SESSION_OVER_MESSAGE } from './common/auth';
import { BAD_PATH_MESSAGE, NO_ROUTE_MESSAGE } from './common/route-errors.filter';
import { tokenPayload } from './common/session-token';
import { startedApp } from './common/testing';
import { DATABASE_DOWN_MESSAGE } from './health/health.service';
import { PrismaService } from './prisma.service';
import { SeedService } from './seed.service';

// @nestjs/config is published as ES modules only, which Jest does not load here (jest.esm-transform.cjs
// turns @nestjs/jwt alone into CommonJS), and the real one would read the .env files of whoever
// runs the tests. What the API reads from them, these tests set on process.env (see `start`).
jest.mock('@nestjs/config', () => ({ ConfigModule: { forRoot: () => ({ module: class ConfigModule {} }) } }));

const SECRET = 'secreto-de-las-pruebas-de-la-api-con-32-caracteres';
const TWELVE_HOURS = 12 * 3600;

interface StoredUser {
  id: number;
  username: string;
  name: string;
  active: boolean;
  passwordHash: string | null;
  role: Role;
  tokenVersion: number;
}

/**
 * The tables these requests reach, in memory. Users are kept as stored; the writes of the routes
 * that must refuse are watched. `$transaction` fails as Prisma does for a record that does not exist.
 */
function fakeDatabase() {
  const users: StoredUser[] = [
    // A low bcrypt cost keeps the logins quick.
    { id: 1, username: 'admin', name: 'Admin', active: true, passwordHash: hashSync('clave-admin', 4), role: 'ADMIN', tokenVersion: 0 },
    { id: 2, username: 'ana', name: 'Ana', active: true, passwordHash: hashSync('clave-ana', 4), role: 'AGENT', tokenVersion: 0 },
  ];
  const find = (where: { id?: number; username?: string }): StoredUser | undefined =>
    users.find((user) => (where.id !== undefined ? user.id === where.id : user.username === where.username));
  const notFound = () => new Prisma.PrismaClientKnownRequestError('Record not found', { code: 'P2025', clientVersion: Prisma.prismaVersion.client });

  return {
    users,
    user: {
      findUnique: jest.fn(({ where }: { where: { id?: number; username?: string } }) => {
        const user = find(where);
        return Promise.resolve(user ? { ...user } : null);
      }),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id?: number } }) => {
        const user = find(where);
        return user ? Promise.resolve({ ...user }) : Promise.reject(notFound());
      }),
      // Each field as sent, `{ increment }` as Prisma applies it.
      update: jest.fn(({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        const user = find(where);
        if (!user) return Promise.reject(notFound());
        for (const [field, value] of Object.entries(data)) {
          if (value === undefined) continue;
          const stored = user as unknown as Record<string, unknown>;
          stored[field] = value && typeof value === 'object' && 'increment' in value ? (stored[field] as number) + (value.increment as number) : value;
        }
        return Promise.resolve({ ...user });
      }),
    },
    setting: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    company: { findMany: jest.fn().mockResolvedValue([]), create: jest.fn(), update: jest.fn().mockReturnValue({}) },
    ticket: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn(() => Promise.reject(notFound())),
    // The query of the health check, which reads no table.
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
  };
}

type FakeDatabase = ReturnType<typeof fakeDatabase>;

/** What the API reads from the environment while it starts (the factories of AppModule, the folder of uploads). */
const VARIABLES = ['JWT_SECRET', 'JWT_EXPIRES_IN', 'LOGIN_RATE_LIMIT', 'API_RATE_LIMIT', 'TRUST_PROXY_HOPS', 'UPLOAD_DIR'] as const;
type Variables = Partial<Record<(typeof VARIABLES)[number], string>>;

/**
 * AppModule as main.ts starts it, with `configureApp`, over the fake database: its guards, pipe,
 * filter and interceptor, the real JwtModule and ThrottlerModule. Only the seed is left out (it has
 * tests of its own), and the uploads go to a folder of the test: starting, the API empties the
 * folder of uploads in progress.
 */
async function start(db: FakeDatabase, variables: Variables = {}): Promise<INestApplication<App>> {
  const uploads = mkdtempSync(join(tmpdir(), 'soporte-api-'));
  const env: Variables = { JWT_SECRET: SECRET, UPLOAD_DIR: uploads, ...variables };
  const saved = VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of VARIABLES) {
    if (env[name] === undefined) delete process.env[name];
    else process.env[name] = env[name];
  }
  try {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(db)
      .overrideProvider(SeedService)
      .useValue({})
      .compile();
    return await startedApp(moduleRef, env);
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(uploads, { recursive: true, force: true });
  }
}

describe('the API as main.ts builds it, through HTTP', () => {
  let db: FakeDatabase;
  let app: INestApplication<App>;
  let jwt: JwtService;

  beforeAll(async () => {
    db = fakeDatabase();
    app = await start(db);
    jwt = app.get(JwtService);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });
  /** A token of a session of this user as stored now, signed by the API. */
  const tokenOf = (username: string) => jwt.signAsync(tokenPayload(db.users.find((user) => user.username === username)!));
  const login = (username: string, password: string) => http().post('/api/auth/login').send({ username, password });

  describe('a route marked @Public()', () => {
    it('answers without a token: the logo of the login page, and the login', async () => {
      const branding = await http().get('/api/branding');
      expect(branding.status).toBe(200);
      expect(branding.body).toEqual({ logoVersion: null });

      const answer = await login('admin', 'clave-admin');
      expect(answer.status).toBe(200);
      expect((answer.body as { user: unknown }).user).toEqual({ id: 1, username: 'admin', name: 'Admin', role: 'ADMIN' });
    });
  });

  describe('every other route', () => {
    it('answers 401 without a token, in Spanish, and does nothing', async () => {
      for (const answer of [await http().get('/api/tickets'), await http().get('/api/auth/me'), await http().put('/api/settings/reminders').send({ staleHours: 1 })]) {
        expect(answer.status).toBe(401);
        expect(answer.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: SESSION_OVER_MESSAGE });
      }
      expect(SESSION_OVER_MESSAGE).toBe('La sesión terminó o no es válida. Vuelve a ingresar.');
      expect(db.ticket.findMany).not.toHaveBeenCalled();
      expect(db.setting.upsert).not.toHaveBeenCalled();
    });

    it('answers 401 to a token this API did not sign, to one out of date, and to one sent another way', async () => {
      const forged = await new JwtService({ secret: 'otro-secreto-de-otra-instalacion-de-32-caracteres' }).signAsync(tokenPayload(db.users[0]));
      // Signed a moment more than its lifetime ago.
      const clock = jest.spyOn(Date, 'now').mockReturnValue(Date.now() - (TWELVE_HOURS + 5) * 1000);
      const expired = await tokenOf('admin');
      clock.mockRestore();
      const valid = await tokenOf('admin');

      for (const headers of [bearer(forged), bearer(expired), bearer('basura'), { Authorization: valid }, { Authorization: `Basic ${valid}` }]) {
        const answer = await http().get('/api/auth/me').set(headers);
        expect(answer.status).toBe(401);
        expect((answer.body as { message: unknown }).message).toBe(SESSION_OVER_MESSAGE);
      }
      expect((await http().get('/api/auth/me').set(bearer(valid))).status).toBe(200);
    });

    it('answers with the token of a login, which lasts 12 hours by default and says the version of the sessions', async () => {
      const { token } = (await login('ana', 'clave-ana')).body as { token: string };

      const me = await http().get('/api/auth/me').set(bearer(token));
      expect(me.status).toBe(200);
      expect(me.body).toEqual({ id: 2, username: 'ana', name: 'Ana', role: 'AGENT' });
      const payload = jwt.decode<{ sub: number; role: string; ver: number; iat: number; exp: number }>(token);
      expect(payload).toMatchObject({ sub: 2, role: 'AGENT', ver: 0 });
      expect(payload.exp - payload.iat).toBe(TWELVE_HOURS);
    });

    it('refuses the token of a user deactivated since it was signed', async () => {
      const token = await tokenOf('ana');
      db.users[1].active = false;
      try {
        const refused = await http().get('/api/auth/me').set(bearer(token));
        expect(refused.status).toBe(401);
        expect(refused.body).toEqual({ statusCode: 401, error: 'Unauthorized', message: SESSION_OVER_MESSAGE });
      } finally {
        db.users[1].active = true;
      }
      expect((await http().get('/api/auth/me').set(bearer(token))).status).toBe(200);
    });
  });

  // One more in the version of the user, and every token signed before is refused (JwtGuard).
  describe('the sessions of a user', () => {
    afterEach(() => {
      db.users[1].passwordHash = hashSync('clave-ana', 4);
    });

    it('end when the user changes the password, except the one the change answers', async () => {
      const before = await tokenOf('ana');

      const changed = await http().post('/api/auth/password').set(bearer(before)).send({ current: 'clave-ana', next: 'clave-nueva' });

      expect(changed.status).toBe(200);
      const { token } = changed.body as { token: string };
      expect((await http().get('/api/auth/me').set(bearer(before))).status).toBe(401);
      expect((await http().get('/api/auth/me').set(bearer(token))).status).toBe(200);
      expect((await login('ana', 'clave-ana')).status).toBe(401);
      expect((await login('ana', 'clave-nueva')).status).toBe(200);
    });

    it('end when an administrator gives the user a new password', async () => {
      const hers = await tokenOf('ana');

      const reset = await http().patch('/api/users/2').set(bearer(await tokenOf('admin'))).send({ password: 'clave-dada' });

      expect(reset.status).toBe(200);
      expect((await http().get('/api/auth/me').set(bearer(hers))).status).toBe(401);
      expect((await http().get('/api/auth/me').set(bearer(await tokenOf('ana')))).status).toBe(200);
    });
  });

  describe('a route only for administrators', () => {
    it('answers 403 in Spanish to an agent, and writes nothing', async () => {
      const agent = bearer(await tokenOf('ana'));
      db.user.update.mockClear();
      db.setting.upsert.mockClear();

      for (const answer of [
        await http().patch('/api/users/1').set(agent).send({ password: 'clave-robada' }),
        await http().put('/api/settings/reminders').set(agent).send({ staleHours: 1 }),
        await http().get('/api/ai/config').set(agent),
      ]) {
        expect(answer.status).toBe(403);
        expect(answer.body).toEqual({ statusCode: 403, error: 'Forbidden', message: ADMIN_ONLY_MESSAGE });
      }
      expect(ADMIN_ONLY_MESSAGE).toBe('Solo un administrador puede hacer esto.');
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.setting.upsert).not.toHaveBeenCalled();
    });

    it('lets an administrator through', async () => {
      const answer = await http().put('/api/settings/reminders').set(bearer(await tokenOf('admin'))).send({ staleHours: 1 });

      expect(answer.status).toBe(204);
      expect(db.setting.upsert).toHaveBeenCalledTimes(1);
    });
  });

  describe('a body the route does not accept', () => {
    it('gets a 400 with the Spanish message of the field, before the route reads anything', async () => {
      const agent = bearer(await tokenOf('ana'));
      db.$transaction.mockClear();

      const company = await http().post('/api/companies').set(agent).send({ name: 'x'.repeat(201) });
      const note = await http().post('/api/tickets/1/notes').set(agent).send({ text: '' });

      expect(company.status).toBe(400);
      expect(company.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['El nombre no puede tener más de 200 caracteres'] });
      expect(note.status).toBe(400);
      expect(note.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['La observación está vacía'] });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    // Without it, a client could set what no screen offers, such as its own role.
    it('gets a 400 for a field the route does not take', async () => {
      db.$transaction.mockClear();

      const answer = await http().post('/api/companies').set(bearer(await tokenOf('ana'))).send({ name: 'Empresa Demo', role: 'ADMIN' });

      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['El campo «role» no se admite'] });
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('gets a 400 for a new password shorter than six characters, and the password and the sessions stay', async () => {
      const token = await tokenOf('ana');
      db.user.update.mockClear();

      const answer = await http().post('/api/auth/password').set(bearer(token)).send({ current: 'clave-ana', next: 'corta' });

      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['El campo «next» debe tener al menos 6 caracteres'] });
      expect(db.user.update).not.toHaveBeenCalled();
      expect((await http().get('/api/auth/me').set(bearer(token))).status).toBe(200);
    });

    // The rules without a message of their own used to answer class-validator's English.
    it('gets the 400 in Spanish for every rule, naming the field', async () => {
      const answer = await login(12345 as never, '');

      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['El campo «username» debe ser un texto', 'El campo «password» no puede estar vacío'] });
    });

    it('gets a 400 in Spanish when it is not JSON, or not an object', async () => {
      const agent = bearer(await tokenOf('ana'));

      const broken = await http().post('/api/auth/login').set('Content-Type', 'application/json').send('{"username": "ana", ');
      const list = await http().patch('/api/companies/1').set(agent).send([]);

      expect(broken.status).toBe(400);
      expect(broken.body).toEqual({ statusCode: 400, error: 'Bad Request', message: 'Los datos enviados no son un JSON válido' });
      expect(list.status).toBe(400);
      expect(list.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['Los datos enviados deben ser un objeto JSON'] });
      expect(db.company.update).not.toHaveBeenCalled();
    });
  });

  describe('an id in the URL that is not a number', () => {
    it('gets a 400 in Spanish', async () => {
      const answer = await http().get('/api/tickets/abc').set(bearer(await tokenOf('ana')));

      expect(answer.status).toBe(400);
      expect(answer.body).toEqual({ statusCode: 400, error: 'Bad Request', message: 'El identificador «id» debe ser un número entero' });
    });

    // `Number` reads these as 16, 1000, 7 and 0: converted by the global pipe before IdPipe, they
    // would reach other records.
    it('gets the same 400 for a number written in another way, before the route reads anything', async () => {
      const token = await tokenOf('ana');
      for (const id of ['0x10', '1e3', '+7', '%20']) {
        const answer = await http().get(`/api/tickets/${id}`).set(bearer(token));

        expect({ id, status: answer.status, message: (answer.body as { message?: unknown }).message }).toEqual({
          id,
          status: 400,
          message: 'El identificador «id» debe ser un número entero',
        });
      }
    });
  });

  describe('a failure of the database the request caused', () => {
    it('answers what went wrong, in Spanish, instead of a 500', async () => {
      const answer = await http().patch('/api/companies/999').set(bearer(await tokenOf('ana'))).send({ active: false });

      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'El registro no existe' });
    });
  });
});

// Nest, Express and body-parser answer these before any route of the API runs, in English.
describe('a request no route of the API takes', () => {
  let db: FakeDatabase;
  let app: INestApplication<App>;

  beforeAll(async () => {
    db = fakeDatabase();
    app = await start(db);
  });

  afterAll(() => app.close());

  const http = () => request(app.getHttpServer());
  const agent = async () => ({ Authorization: `Bearer ${await app.get(JwtService).signAsync(tokenPayload(db.users[1]))}` });

  it('gets a 404 in Spanish for a path without a route, and for a method the route does not have', async () => {
    const headers = await agent();
    for (const answer of [
      await http().get('/api/nada-por-aqui').set(headers),
      await http().get('/api/'),
      await http().put('/api/tickets').set(headers).send({}),
      await http().delete('/api/companies').set(headers),
      await http().get('/api/nada/%FF').set(headers),
    ]) {
      expect(answer.status).toBe(404);
      expect(answer.body).toEqual({ statusCode: 404, error: 'Not Found', message: NO_ROUTE_MESSAGE });
    }
    expect(NO_ROUTE_MESSAGE).toBe('La ruta no existe.');
  });

  it('keeps the 404 of a route that did not find its record as the route wrote it', async () => {
    const answer = await http().patch('/api/companies/999').set(await agent()).send({ active: false });

    expect(answer.body).toEqual({ statusCode: 404, error: 'Not Found', message: 'El registro no existe' });
  });

  // An escape with hexadecimal digits that is not UTF-8 text: nginx lets it through.
  it('gets a 400 in Spanish for a parameter of the path that cannot be read as text', async () => {
    const headers = await agent();
    for (const path of ['/api/tickets/%FF', '/api/preferences/a%C0%80']) {
      const answer = await http().get(path).set(headers);

      expect({ path, status: answer.status, body: answer.body as unknown }).toEqual({ path, status: 400, body: { statusCode: 400, error: 'Bad Request', message: BAD_PATH_MESSAGE } });
    }
  });

  it('gets a 413 in Spanish for a JSON body or a form over the 100 KB of the parser, before the route reads anything', async () => {
    const headers = await agent();
    const json = await http().post('/api/companies').set(headers).send({ name: 'Grande', relleno: 'x'.repeat(200 * 1024) });
    const form = await http().post('/api/companies').set(headers).type('form').send(`name=Grande&relleno=${'x'.repeat(200 * 1024)}`);

    for (const answer of [json, form]) {
      expect(answer.status).toBe(413);
      expect(answer.body).toEqual({ statusCode: 413, error: 'Payload Too Large', message: 'Los datos enviados pesan más de 100 KB, lo máximo que el sistema recibe en una solicitud.' });
    }
    expect(db.company.create).not.toHaveBeenCalled();
  });

  it('gets a 415 in Spanish for a body in a charset other than UTF-8, or compressed in a way the parser does not read', async () => {
    const headers = await agent();
    const charset = await http().post('/api/companies').set(headers).set('Content-Type', 'application/json; charset=ebcdic').send('{"name":"Charset"}');
    const compressed = await http().post('/api/companies').set(headers).set('Content-Type', 'application/json').set('Content-Encoding', 'compress').send('{"name":"Comprimido"}');

    expect(charset.status).toBe(415);
    expect(charset.body).toEqual({
      statusCode: 415,
      error: 'Unsupported Media Type',
      message: 'Los datos enviados están en una codificación de caracteres que el sistema no lee. Envíalos en UTF-8.',
    });
    expect(compressed.status).toBe(415);
    expect(compressed.body).toEqual({ statusCode: 415, error: 'Unsupported Media Type', message: 'Los datos enviados están comprimidos de una forma que el sistema no lee.' });
    expect(db.company.create).not.toHaveBeenCalled();
  });

  // The form is read as before: the same parser, with the options Nest gave it.
  it('still reads a form body, nested fields included', async () => {
    const answer = await http().post('/api/companies').set(await agent()).type('form').send('name[a]=1');

    expect(answer.status).toBe(400);
    expect(answer.body).toEqual({ statusCode: 400, error: 'Bad Request', message: ['El campo «name» debe ser un texto'] });
  });
});

describe('the health check', () => {
  let db: FakeDatabase;
  let app: INestApplication<App>;

  beforeAll(async () => {
    db = fakeDatabase();
    app = await start(db);
  });

  afterAll(() => app.close());

  it('answers without a session that the API is up and reaches its database, with nothing else', async () => {
    const answer = await request(app.getHttpServer()).get('/api/health');

    expect(answer.status).toBe(200);
    expect(answer.body).toEqual({ status: 'ok', database: 'ok' });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('answers 503 in Spanish while the database does not answer', async () => {
    db.$queryRaw.mockRejectedValueOnce(new Error('la base de datos no responde'));

    const answer = await request(app.getHttpServer()).get('/api/health');

    expect(answer.status).toBe(503);
    expect(answer.body).toEqual({ statusCode: 503, error: 'Service Unavailable', message: DATABASE_DOWN_MESSAGE });
    expect(DATABASE_DOWN_MESSAGE).toBe('La base de datos no responde.');
  });
});

describe('the limits, as AppModule registers them', () => {
  let app: INestApplication<App> | undefined;
  afterEach(() => app?.close());

  const bearer = async (db: FakeDatabase, username: string) =>
    `Bearer ${await app!.get(JwtService).signAsync(tokenPayload(db.users.find((user) => user.username === username)!))}`;

  // The login check reads the database for every request with a token. Counted before it, a flood
  // of requests is cut whatever they carry.
  it('cuts a flood of requests before the login check looks at them', async () => {
    const db = fakeDatabase();
    app = await start(db, { API_RATE_LIMIT: '3' });

    for (let i = 0; i < 3; i++) expect((await request(app.getHttpServer()).get('/api/tickets')).status).toBe(401);
    db.user.findUnique.mockClear();
    const cut = await request(app.getHttpServer()).get('/api/tickets').set('Authorization', 'Bearer basura');

    expect(cut.status).toBe(429);
    expect((cut.body as { message: string }).message).toBe('Demasiadas solicitudes desde este equipo. Espera un minuto y vuelve a intentarlo.');
    expect(cut.headers['retry-after']).toBe('60');
    expect(db.user.findUnique).not.toHaveBeenCalled();
  });

  // The throttler reads the token with the JwtService of JwtModule, the one the login check uses:
  // every request of these tests comes from one address, as behind Docker Desktop.
  it('gives each user with a session a budget of their own, apart from the requests without one', async () => {
    const db = fakeDatabase();
    app = await start(db, { API_RATE_LIMIT: '2' });
    const http = () => request(app!.getHttpServer());
    const admin = await bearer(db, 'admin');

    for (let i = 0; i < 2; i++) expect((await http().get('/api/auth/me').set('Authorization', admin)).status).toBe(200);
    const cut = await http().get('/api/auth/me').set('Authorization', admin);
    expect(cut.status).toBe(429);
    expect((cut.body as { message: string }).message).toBe('Demasiadas solicitudes con este usuario. Espera un minuto y vuelve a intentarlo.');

    const ana = await bearer(db, 'ana');
    for (let i = 0; i < 2; i++) expect((await http().get('/api/auth/me').set('Authorization', ana)).status).toBe(200);
    // Without a token, the address: its own budget too, which a forged token spends.
    expect((await http().get('/api/tickets').set('Authorization', 'Bearer basura')).status).toBe(401);
    expect((await http().get('/api/tickets')).status).toBe(401);
    expect((await http().get('/api/tickets')).status).toBe(429);
  });

  // Before, a session left open could try current passwords with no end, each wrong one a 400.
  it('locks the username after five wrong current passwords in a row, for the change and for the login, with Retry-After', async () => {
    const db = fakeDatabase();
    app = await start(db);
    const http = () => request(app!.getHttpServer());
    const ana = await bearer(db, 'ana');
    const change = (current: string) => http().post('/api/auth/password').set('Authorization', ana).send({ current, next: 'clave-nueva' });

    for (let i = 0; i < 5; i++) {
      const wrong = await change('clave-mala');
      expect(wrong.status).toBe(400);
      expect((wrong.body as { message: string }).message).toBe('La contraseña actual no es correcta');
    }
    const locked = await change('clave-ana');
    const login = await http().post('/api/auth/login').send({ username: 'ana', password: 'clave-ana' });

    for (const answer of [locked, login]) {
      expect(answer.status).toBe(429);
      expect(answer.body).toEqual({ statusCode: 429, message: 'Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.' });
      expect(Number(answer.headers['retry-after'])).toBeGreaterThanOrEqual(59);
      expect(Number(answer.headers['retry-after'])).toBeLessThanOrEqual(60);
    }
    expect(db.user.update).not.toHaveBeenCalled();
    // Another user logs in from the same address as before.
    expect((await http().post('/api/auth/login').send({ username: 'admin', password: 'clave-admin' })).status).toBe(200);
  });
});

// JwtGuard looks at the token of a stream when it opens. The write that ends the sessions of a user
// reaches the open streams through the EventsService that AppModule gives every controller.
describe('a stream of events, as AppModule wires it', () => {
  let app: INestApplication<App> | undefined;
  /** Every stream a test opened, ended here if the API did not end it. */
  const responses: IncomingMessage[] = [];
  afterEach(async () => {
    responses.splice(0).forEach((response) => response.destroy());
    await app?.close();
  });

  /** The stream with this token, as the browser opens it, once its headers arrive; `ended` settles when the API ends it. */
  const open = (port: number, token: string): Promise<{ response: IncomingMessage; ended: Promise<void>; isOpen: () => boolean }> =>
    new Promise((resolve, reject) => {
      const headers = { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' };
      get({ host: '127.0.0.1', port, path: '/api/events', headers, agent: false }, (response) => {
        responses.push(response);
        let open = true;
        const ended = new Promise<void>((done) =>
          response.once('end', () => {
            open = false;
            done();
          }),
        );
        response.resume();
        resolve({ response, ended, isOpen: () => open });
      }).once('error', reject);
    });

  it('ends when the sessions of its user end, and the streams of other users stay open', async () => {
    const db = fakeDatabase();
    app = await start(db);
    await app.listen(0, '127.0.0.1');
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    const jwt = app.get(JwtService);
    const tokenOf = (username: string) => jwt.signAsync(tokenPayload(db.users.find((user) => user.username === username)!));
    const http = () => request(app!.getHttpServer());
    const adminToken = await tokenOf('admin');
    const admin = await open(port, adminToken);

    // Ana changes her own password: her stream ends, and opens again with the token the change answers.
    const before = await tokenOf('ana');
    const first = await open(port, before);
    expect(first.response.statusCode).toBe(200);
    expect(first.response.headers['content-type']).toContain('text/event-stream');
    const changed = await http().post('/api/auth/password').set('Authorization', `Bearer ${before}`).send({ current: 'clave-ana', next: 'clave-nueva' });
    expect(changed.status).toBe(200);
    await first.ended;
    expect((await open(port, before)).response.statusCode).toBe(401);
    const renewed = (changed.body as { token: string }).token;
    const second = await open(port, renewed);
    expect(second.response.statusCode).toBe(200);

    // An administrator gives her another one: the stream of that token ends too, and opens no more.
    const reset = await http().patch('/api/users/2').set('Authorization', `Bearer ${adminToken}`).send({ password: 'clave-dada' });
    expect(reset.status).toBe(200);
    await second.ended;
    expect((await open(port, renewed)).response.statusCode).toBe(401);

    expect(admin.isOpen()).toBe(true);
  });

  /** The application, listening on a free port, and an open stream of Ana's. */
  async function listeningWithAStream() {
    const db = fakeDatabase();
    app = await start(db);
    await app.listen(0, '127.0.0.1');
    const server = app.getHttpServer() as Server;
    const stream = await open((server.address() as AddressInfo).port, await app.get(JwtService).signAsync(tokenPayload(db.users[1])));
    expect(stream.response.statusCode).toBe(200);
    return { server, stream };
  }

  // The server waits for every answer in progress before it closes, and a stream never ends by
  // itself: before, closing the application waited for the browsers to go.
  it('ends when the application closes, which does not wait for it', async () => {
    const { server, stream } = await listeningWithAStream();

    await app!.close();
    app = undefined;

    await stream.ended;
    expect(server.listening).toBe(false);
  });

  // What `docker stop` sends. Nest would send the signal again to the process, which Linux ignores
  // for process 1, the API in its container: the process ends by itself instead.
  it('closes the application on SIGTERM, and then ends the process', async () => {
    const { server, stream } = await listeningWithAStream();
    const exited = new Promise<unknown>((done) => jest.spyOn(process, 'exit').mockImplementation((code) => done(code) as never));
    const kill = jest.spyOn(process, 'kill').mockImplementation(() => true);
    const before = { term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') };
    try {
      closeOnStopSignals(app!);
      expect({ term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') }).toEqual({ term: before.term + 1, int: before.int + 1 });

      process.emit('SIGTERM', 'SIGTERM');

      expect(await exited).toBe(0);
      await stream.ended;
      expect(server.listening).toBe(false);
      expect(kill).not.toHaveBeenCalled();
      expect({ term: process.listenerCount('SIGTERM'), int: process.listenerCount('SIGINT') }).toEqual(before);
    } finally {
      jest.restoreAllMocks();
      app = undefined;
    }
  });
});
