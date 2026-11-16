import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, UnauthorizedException } from '@nestjs/common';
import type { MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { PrismaService } from '../prisma.service';
import { EventsController, HEARTBEAT_MS } from './events.controller';
import { EventsService } from './events.service';
import type { ChangeEvent } from './events.service';

const SECRET = 'secreto-de-las-pruebas-de-los-eventos-de-32-caracteres';
const DAY_MS = 86_400_000;

/** The users as stored: what a heartbeat reads. 5 and 6 are logged in, with the version of their tokens. */
interface Stored {
  active: boolean;
  tokenVersion: number;
}

describe('the stream of events', () => {
  const jwt = new JwtService({ secret: SECRET });
  let stored: Map<number, Stored>;
  let db: { user: { findUnique: jest.Mock } };
  let events: EventsService;
  let controller: EventsController;

  beforeEach(() => {
    // On a whole second: the expiry of a token is in whole seconds. The signature of the tokens
    // runs on the queues of Node, which stay real; the clock and the timers are the test's.
    jest.useFakeTimers({ now: new Date('2026-11-13T12:00:00Z'), doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    stored = new Map([
      [5, { active: true, tokenVersion: 2 }],
      [6, { active: true, tokenVersion: 0 }],
    ]);
    db = {
      user: {
        findUnique: jest.fn(({ where }: { where: { id: number } }) => {
          const user = stored.get(where.id);
          return Promise.resolve(user ? { ...user } : null);
        }),
      },
    };
    events = new EventsService();
    controller = new EventsController(events, jwt, db as unknown as PrismaService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** A token of a session of user `sub`, signed now with the version of the sessions `ver`, lasting `expiresIn` seconds. */
  const tokenOf = (sub: number, ver: number, expiresIn = 12 * 3600) => jwt.signAsync({ sub, role: 'AGENT', ver }, { expiresIn });

  /** The stream as Nest sends it: what it gives, and whether it has ended. */
  async function open(token: string) {
    const seen: MessageEvent[] = [];
    let ended = false;
    const subscription = (await controller.stream(`Bearer ${token}`)).subscribe({
      next: (message) => seen.push(message),
      complete: () => (ended = true),
    });
    return { seen, ended: () => ended, close: () => subscription.unsubscribe() };
  }

  const change: ChangeEvent = { scope: 'tickets', ticketId: 7, created: null, clientId: null };
  const PING: MessageEvent = { type: 'ping', data: '' };

  /** Lets the clock run, and the reads of the database it starts answer. */
  const pass = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  it('passes on each change, and a ping at each heartbeat while the session stands', async () => {
    const stream = await open(await tokenOf(5, 2));

    events.emit(change);
    await pass(HEARTBEAT_MS);
    await pass(HEARTBEAT_MS);

    expect(stream.seen).toEqual([{ type: 'change', data: change }, PING, PING]);
    expect(stream.ended()).toBe(false);
    stream.close();
  });

  // One read by the primary key per heartbeat: the stream asks nothing else of the database.
  it('reads the state and the version of the sessions of its user at each heartbeat, and nothing more', async () => {
    const stream = await open(await tokenOf(5, 2));
    expect(db.user.findUnique).not.toHaveBeenCalled();

    await pass(HEARTBEAT_MS);

    expect(db.user.findUnique.mock.calls).toEqual([[{ where: { id: 5 }, select: { active: true, tokenVersion: true } }]]);
    stream.close();
  });

  // A slow database must not pile up reads: each stream has at most one waiting.
  it('skips the heartbeats that come while its read of the user is still waiting', async () => {
    let answer: (user: Stored) => void = () => undefined;
    db.user.findUnique.mockImplementationOnce(() => new Promise<Stored>((resolve) => (answer = resolve)));
    const stream = await open(await tokenOf(5, 2));

    await pass(3 * HEARTBEAT_MS);
    expect(db.user.findUnique).toHaveBeenCalledTimes(1);
    expect(stream.seen).toEqual([]);

    answer({ active: true, tokenVersion: 2 });
    await pass(0);
    expect(stream.seen).toEqual([PING]);
    await pass(HEARTBEAT_MS);
    expect(db.user.findUnique).toHaveBeenCalledTimes(2);
    expect(stream.seen).toEqual([PING, PING]);
    stream.close();
  });

  it('ends at once when the API ends the sessions of its user, and the streams of other users go on', async () => {
    const ana = await open(await tokenOf(5, 2));
    const otherAna = await open(await tokenOf(5, 2));
    const luis = await open(await tokenOf(6, 0));

    events.sessionsEnded(5);
    events.emit(change);

    expect(ana.ended()).toBe(true);
    expect(otherAna.ended()).toBe(true);
    expect(ana.seen).toEqual([]);
    expect(luis.ended()).toBe(false);
    expect(luis.seen).toEqual([{ type: 'change', data: change }]);
    luis.close();
  });

  it('ends when the token it was opened with expires, not before', async () => {
    const stream = await open(await tokenOf(5, 2, 3600));

    await pass(3600 * 1000 - 1);
    expect(stream.ended()).toBe(false);
    expect(stream.seen.length).toBe(Math.floor((3600 * 1000 - 1) / HEARTBEAT_MS));

    await pass(1);
    expect(stream.ended()).toBe(true);
  });

  // Node fires at once a timer of more than about 24.8 days: the stream would end as it opens.
  it('lasts a token whose lifetime is longer than a timer of Node can wait, and ends at its expiry', async () => {
    const stream = await open(await tokenOf(5, 2, 30 * 86_400));

    await pass(1_000);
    expect(stream.ended()).toBe(false);

    // In one jump: a heartbeat still reading skips the next ones, so there is one read, not a hundred thousand.
    jest.advanceTimersByTime(30 * DAY_MS - 1_000 - 1);
    await pass(0);
    expect(stream.ended()).toBe(false);

    jest.advanceTimersByTime(1);
    await pass(0);
    expect(stream.ended()).toBe(true);
  });

  // A change made straight in the database is announced to nobody: the heartbeat sees it.
  it.each([
    ['a newer version of the sessions', () => (stored.get(5)!.tokenVersion = 3)],
    ['the user inactive', () => (stored.get(5)!.active = false)],
    ['the user gone', () => stored.delete(5)],
  ])('ends at a heartbeat that finds %s, without a ping', async (_case, edit) => {
    const stream = await open(await tokenOf(5, 2));
    await pass(HEARTBEAT_MS);
    expect(stream.seen).toEqual([PING]);

    edit();
    await pass(HEARTBEAT_MS);

    expect(stream.ended()).toBe(true);
    expect(stream.seen).toEqual([PING]);
  });

  it('ends at a heartbeat that cannot read the user, and says why in the log', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const stream = await open(await tokenOf(5, 2));
    db.user.findUnique.mockRejectedValueOnce(new Error('la base de datos no responde'));

    await pass(HEARTBEAT_MS);

    expect(stream.ended()).toBe(true);
    expect(warn).toHaveBeenCalledWith('No se pudo comprobar la sesión de un flujo de eventos, que se cierra: la base de datos no responde');
  });

  // JwtGuard has accepted it a moment before; it can only fail here if it expired in between.
  it('answers 401 to a token it cannot read', async () => {
    await expect(controller.stream('Bearer basura')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.stream(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

// Read from the source folder, so that a new place that ends sessions is looked at too. Left out,
// the streams of those sessions would stay open until their next heartbeat.
describe('the places that end the sessions of a user', () => {
  const SRC = join(__dirname, '..');
  const sources = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => ({ file: file.replace(/\\/g, '/'), text: readFileSync(join(SRC, file), 'utf8') }));
  // The files that import END_SESSIONS, the write that ends the sessions of a user.
  const writers = sources.filter(({ text }) => /import \{[^}]*\bEND_SESSIONS\b[^}]*\} from/.test(text));

  it('tell the streams of events, every one of them', () => {
    // The ones of today, which the search must find: a search that finds none would check nothing.
    expect(writers.map(({ file }) => file)).toEqual(expect.arrayContaining(['auth/auth.controller.ts', 'seed.service.ts', 'users/users.controller.ts']));
    for (const { file, text } of writers) expect({ file, tells: /\.sessionsEnded\(/.test(text) }).toEqual({ file, tells: true });
  });
});
