import { Logger } from '@nestjs/common';
import { compareSync, hashSync } from 'bcryptjs';
import { EventsService } from './events/events.service';
import type { PrismaService } from './prisma.service';
import { SeedService } from './seed.service';
import { WORKING_ADMIN } from './users/admins';

interface Row {
  id?: number;
  username: string;
  name?: string;
  passwordHash?: string | null;
  active?: boolean;
  role?: 'ADMIN' | 'AGENT';
  tokenVersion?: number;
}

/** What `update` or `upsert` writes on a row, with the `{ increment }` of a number done as the database does it. */
function written(row: Row, data: Record<string, unknown>): Row {
  const next: Record<string, unknown> = { ...row };
  for (const [key, value] of Object.entries(data)) {
    const increment = value && typeof value === 'object' && 'increment' in value ? (value as { increment: number }).increment : null;
    next[key] = increment === null ? value : (Number(next[key]) || 0) + increment;
  }
  return next as unknown as Row;
}

/**
 * The users table in memory, with what the seed asks of it. `count` only knows the question the
 * seed asks (an administrator who can log in), and says so if it is asked another one.
 */
function fakeDb(rows: Row[]) {
  let lastId = 0;
  const row = (values: Row): Row => ({ id: ++lastId, active: true, role: 'AGENT', passwordHash: null, tokenVersion: 0, ...values });
  const users = new Map<string, Row>(rows.map((values) => [values.username, row(values)]));
  const calls: string[] = [];
  const user = {
    count: jest.fn(({ where }: { where: unknown }) => {
      expect(where).toEqual(WORKING_ADMIN);
      calls.push('count');
      return Promise.resolve([...users.values()].filter((stored) => stored.role === 'ADMIN' && stored.active && stored.passwordHash).length);
    }),
    findUnique: jest.fn(({ where }: { where: { username: string } }) => Promise.resolve(users.get(where.username) ?? null)),
    upsert: jest.fn(({ where, create, update }: { where: { username: string }; create: Row; update: Partial<Row> }) => {
      calls.push(`upsert ${where.username}`);
      const existing = users.get(where.username);
      users.set(where.username, existing ? written(existing, update) : row(create));
      return Promise.resolve({ ...users.get(where.username) });
    }),
    update: jest.fn(({ where, data }: { where: { username: string }; data: Partial<Row> }) => {
      calls.push(`update ${where.username}`);
      users.set(where.username, written(users.get(where.username)!, data));
      return Promise.resolve({ ...users.get(where.username) });
    }),
  };
  // The other catalogs already have their rows: these tests are about the users.
  const db = { user, slaPolicy: { count: () => Promise.resolve(4) }, systemModule: { count: () => Promise.resolve(1) } };
  // Each user whose open streams of events were told to end, with the version of the sessions
  // stored at that moment: the one the write left.
  const events = new EventsService();
  const ended: string[] = [];
  events.sessionsEnded$.subscribe((id) => {
    const stored = [...users.values()].find((candidate) => candidate.id === id);
    ended.push(`${stored?.username} ${stored?.tokenVersion}`);
  });
  return { users, calls, ended, seed: new SeedService(db as unknown as PrismaService, events) };
}

describe('SeedService and the roles', () => {
  const saved = { ...process.env };
  let warn: jest.SpyInstance;
  beforeEach(() => {
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'clave-admin';
    process.env.ADMIN_NAME = 'Administrador';
    process.env.MCP_USERNAME = 'claude';
    process.env.MCP_PASSWORD = 'clave-asistente';
    delete process.env.MCP_NAME;
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });
  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('on the first start, makes the first user an administrator and the assistant an agent', async () => {
    const { users, seed } = fakeDb([]);

    await seed.onApplicationBootstrap();

    expect(users.get('admin')).toMatchObject({ name: 'Administrador', role: 'ADMIN', active: true });
    expect(compareSync('clave-admin', users.get('admin')!.passwordHash!)).toBe(true);
    expect(users.get('claude')).toMatchObject({ name: 'Claude', role: 'AGENT' });
  });

  // The migration made every user that existed an administrator, the assistant among them.
  it('makes the assistant an agent again on every start, whatever it was made in the app', async () => {
    const { users, seed } = fakeDb([
      { username: 'admin', passwordHash: 'x', role: 'ADMIN' },
      { username: 'claude', name: 'Asistente', passwordHash: 'x', role: 'ADMIN', active: false },
    ]);

    await seed.onApplicationBootstrap();

    // Name and active state stay as edited; the password follows MCP_PASSWORD.
    expect(users.get('claude')).toMatchObject({ name: 'Asistente', active: false, role: 'AGENT' });
    expect(compareSync('clave-asistente', users.get('claude')!.passwordHash!)).toBe(true);
    expect(users.get('admin')).toMatchObject({ passwordHash: 'x', role: 'ADMIN' });
  });

  it('leaves the users alone while an administrator can log in', async () => {
    const { users, calls, seed } = fakeDb([
      { username: 'jefa', passwordHash: 'x', role: 'ADMIN' },
      { username: 'admin', passwordHash: 'y', role: 'AGENT' },
    ]);

    await seed.onApplicationBootstrap();

    expect(calls).toEqual(['upsert claude', 'count']);
    expect(users.get('admin')).toMatchObject({ passwordHash: 'y', role: 'AGENT' });
  });

  // The assistant was the only administrator: once it is an agent, the first user takes over.
  it('makes the first user an administrator again when nobody else can administer, with the password it has', async () => {
    const { users, calls, seed } = fakeDb([
      { username: 'claude', passwordHash: 'x', role: 'ADMIN' },
      { username: 'jefa', passwordHash: 'x', role: 'ADMIN', active: false },
      { username: 'admin', passwordHash: 'la-suya', role: 'AGENT', active: false },
    ]);

    await seed.onApplicationBootstrap();

    // The assistant first: it is the step that may leave nobody.
    expect(calls).toEqual(['upsert claude', 'count', 'update admin']);
    expect(users.get('admin')).toMatchObject({ passwordHash: 'la-suya', role: 'ADMIN', active: true });
    expect(users.get('jefa')).toMatchObject({ role: 'ADMIN', active: false });
  });

  // A password or a role put back is a change like any other: the sessions open with the user end.
  describe('the sessions of the assistant', () => {
    it('end when its password had to follow MCP_PASSWORD again, or its role had to be put back', async () => {
      const { users, seed } = fakeDb([
        { username: 'admin', passwordHash: 'x', role: 'ADMIN' },
        { username: 'claude', passwordHash: hashSync('la-de-antes', 4), role: 'AGENT', tokenVersion: 3 },
      ]);

      await seed.onApplicationBootstrap();
      expect(users.get('claude')).toMatchObject({ role: 'AGENT', tokenVersion: 4 });
      expect(compareSync('clave-asistente', users.get('claude')!.passwordHash!)).toBe(true);

      users.set('claude', { ...users.get('claude')!, role: 'ADMIN' });
      await seed.onApplicationBootstrap();
      expect(users.get('claude')).toMatchObject({ role: 'AGENT', tokenVersion: 5 });
    });

    // The MCP server would log in again after every restart of the API, for nothing.
    it('go on, and nothing is written, when its password and its role are already the ones', async () => {
      const passwordHash = hashSync('clave-asistente', 4);
      const { users, calls, seed } = fakeDb([
        { username: 'admin', passwordHash: 'x', role: 'ADMIN' },
        { username: 'claude', passwordHash, role: 'AGENT', tokenVersion: 3 },
      ]);

      await seed.onApplicationBootstrap();

      expect(calls).toEqual(['count']);
      expect(users.get('claude')).toMatchObject({ passwordHash, role: 'AGENT', tokenVersion: 3 });
    });

    it('start at the first version for an assistant made now', async () => {
      const { users, seed } = fakeDb([{ username: 'admin', passwordHash: 'x', role: 'ADMIN' }]);

      await seed.onApplicationBootstrap();

      expect(users.get('claude')).toMatchObject({ role: 'AGENT', tokenVersion: 0 });
    });
  });

  // Whatever the first user was before (an agent, inactive, someone whose password ADMIN_PASSWORD replaces), a session they had open ends.
  it('ends the sessions of the first user when it becomes an administrator again', async () => {
    const { users, seed } = fakeDb([
      { username: 'admin', passwordHash: 'la-suya', role: 'AGENT', tokenVersion: 2 },
      { username: 'jefa', passwordHash: null, role: 'ADMIN', tokenVersion: 0 },
    ]);
    process.env.ADMIN_USERNAME = 'admin';

    await seed.onApplicationBootstrap();
    expect(users.get('admin')).toMatchObject({ role: 'ADMIN', active: true, tokenVersion: 3 });

    // Without a password of its own, it gets the one of ADMIN_PASSWORD.
    const other = fakeDb([{ username: 'admin', passwordHash: null, role: 'AGENT', active: false, tokenVersion: 1 }]);
    await other.seed.onApplicationBootstrap();
    expect(other.users.get('admin')).toMatchObject({ role: 'ADMIN', active: true, tokenVersion: 2 });
    expect(compareSync('clave-admin', other.users.get('admin')!.passwordHash!)).toBe(true);
  });

  // Every write that ends the sessions of a user is announced, here too, once it is done.
  it('tells the streams of events of each user whose sessions it ends, after the write', async () => {
    const { ended, seed } = fakeDb([
      { username: 'claude', passwordHash: hashSync('la-de-antes', 4), role: 'ADMIN', tokenVersion: 3 },
      { username: 'admin', passwordHash: 'la-suya', role: 'AGENT', tokenVersion: 2 },
    ]);

    await seed.onApplicationBootstrap();
    expect(ended).toEqual(['claude 4', 'admin 3']);

    // Without a password of its own, the first user gets the one of ADMIN_PASSWORD.
    const other = fakeDb([{ username: 'admin', passwordHash: null, role: 'AGENT', active: false, tokenVersion: 1 }]);
    await other.seed.onApplicationBootstrap();
    // The assistant made now had no session to end.
    expect(other.ended).toEqual(['admin 2']);
  });

  it('tells no stream when it writes nothing', async () => {
    const { ended, seed } = fakeDb([
      { username: 'admin', passwordHash: 'x', role: 'ADMIN' },
      { username: 'claude', passwordHash: hashSync('clave-asistente', 4), role: 'AGENT', tokenVersion: 3 },
    ]);

    await seed.onApplicationBootstrap();

    expect(ended).toEqual([]);
  });

  it('only warns when nobody can administer and ADMIN_PASSWORD is not set', async () => {
    delete process.env.ADMIN_PASSWORD;
    const { users, seed } = fakeDb([{ username: 'claude', passwordHash: 'x', role: 'ADMIN' }]);

    await seed.onApplicationBootstrap();

    expect(users.has('admin')).toBe(false);
    expect(warn).toHaveBeenCalledWith(
      'No hay ningún administrador que pueda iniciar sesión y ADMIN_PASSWORD no está definido: nadie puede administrar el sistema.',
    );
  });
});
