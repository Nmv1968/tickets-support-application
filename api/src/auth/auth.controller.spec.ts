import { BadRequestException, HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { compare, compareSync, getRounds, hashSync } from 'bcryptjs';
import type { JwtService } from '@nestjs/jwt';
import type { AuthUser } from '../common/auth';
import type { PrismaService } from '../prisma.service';
import { TooManyAttemptsException } from '../common/retry-after';
import { THROTTLE_ENV } from '../common/throttle';
import { EventsService } from '../events/events.service';
import { UsersController } from '../users/users.controller';
import { MAX_ADDRESSES } from './address-failures';
import { ADDRESS_LIMIT_MESSAGE, AuthController, DUMMY_HASH, LOCKED_MESSAGE } from './auth.controller';
import { LOCK_MS, MAX_FAILURES, MAX_TRACKED } from './login-failures';

// The real comparison, watched: which hash each login compares with is what these tests look at.
jest.mock('bcryptjs', () => {
  const actual = jest.requireActual<typeof import('bcryptjs')>('bcryptjs');
  return { ...actual, compare: jest.fn(actual.compare) };
});

const compareMock = compare as jest.MockedFunction<(password: string, hash: string) => Promise<boolean>>;

/** The address of the client of the logins, as `trust proxy` gives it. */
const IP = '10.0.0.1';
/** Failed logins a minute from one address when LOGIN_RATE_LIMIT is not set. */
const ADDRESS_LIMIT = THROTTLE_ENV.LOGIN_RATE_LIMIT.fallback;

describe('login', () => {
  // A low cost keeps the tests quick; the hash of a real user costs what DUMMY_HASH costs.
  const ANA_HASH = hashSync('secreto1', 4);
  type Row = { id: number; username: string; name: string; active: boolean; passwordHash: string | null; role: 'ADMIN' | 'AGENT'; tokenVersion: number };
  const users: Record<string, Row> = {
    ana: { id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: ANA_HASH, role: 'AGENT', tokenVersion: 0 },
    inactiva: { id: 6, username: 'inactiva', name: 'Inactiva', active: false, passwordHash: hashSync('secreto1', 4), role: 'ADMIN', tokenVersion: 1 },
    nueva: { id: 7, username: 'nueva', name: 'Nueva', active: true, passwordHash: null, role: 'AGENT', tokenVersion: 0 },
    // Her password was changed twice: the tokens of before carry 0 or 1.
    jefa: { id: 8, username: 'jefa', name: 'Jefa', active: true, passwordHash: ANA_HASH, role: 'ADMIN', tokenVersion: 2 },
  };

  const byId = (id: number): Row | undefined => Object.values(users).find((row) => row.id === id);

  // The change of the own password is answered too, without storing it: the password of each user stays.
  const setup = () => {
    const db = {
      user: {
        findUnique: jest.fn(({ where }: { where: { username: string } }) => Promise.resolve(users[where.username] ?? null)),
        findUniqueOrThrow: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(byId(where.id))),
        update: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve({ ...byId(where.id), tokenVersion: 9 })),
      },
    };
    const jwt = { signAsync: jest.fn().mockResolvedValue('token-firmado') };
    return { db, jwt, controller: new AuthController(db as unknown as PrismaService, jwt as unknown as JwtService, new EventsService()) };
  };

  // The limit of failed logins per address is read when the controller is created: the one of the
  // environment of whoever runs the tests must not count.
  const savedLimit = process.env.LOGIN_RATE_LIMIT;
  beforeAll(() => delete process.env.LOGIN_RATE_LIMIT);
  afterAll(() => {
    if (savedLimit !== undefined) process.env.LOGIN_RATE_LIMIT = savedLimit;
  });

  const refusal = async (attempt: Promise<unknown>): Promise<HttpException> => {
    const error = await attempt.then(
      () => null,
      (thrown: unknown) => thrown,
    );
    if (!(error instanceof HttpException)) throw new Error(`expected an HTTP error, got ${String(error)}`);
    return error;
  };

  let now = 1_000_000;
  beforeEach(() => {
    compareMock.mockClear();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => jest.restoreAllMocks());

  it('answers a token and the user for the right password, the username in any case', async () => {
    const { controller } = setup();

    expect(await controller.login({ username: ' ANA ', password: 'secreto1' }, IP)).toEqual({
      token: 'token-firmado',
      user: { id: 5, username: 'ana', name: 'Ana', role: 'AGENT' },
    });
  });

  // The web shows what the role allows from the answer; the token says it too, for whoever reads it.
  // And the version of the sessions of the user: once it goes up, the token is refused (JwtGuard).
  it('says the role of the user in the answer, and the role and the version of the sessions in the token', async () => {
    const { controller, jwt } = setup();

    expect((await controller.login({ username: 'jefa', password: 'secreto1' }, IP)).user.role).toBe('ADMIN');
    expect((await controller.login({ username: 'ana', password: 'secreto1' }, IP)).user.role).toBe('AGENT');

    expect(jwt.signAsync.mock.calls).toEqual([[{ sub: 8, role: 'ADMIN', ver: 2 }], [{ sub: 5, role: 'AGENT', ver: 0 }]]);
  });

  // The user of the session as the login check read it from the database for this request.
  it('answers /auth/me with the user of the session, role included', () => {
    const { controller } = setup();
    const me = { id: 8, username: 'jefa', name: 'Jefa', role: 'ADMIN' } as const;

    expect(controller.me(me)).toEqual({ id: 8, username: 'jefa', name: 'Jefa', role: 'ADMIN' });
  });

  describe('takes the same work for every username', () => {
    it('compares with the hash of the user when the user can log in', async () => {
      const { controller } = setup();

      await expect(controller.login({ username: 'ana', password: 'otra' }, IP)).rejects.toThrow(UnauthorizedException);

      expect(compareMock.mock.calls).toEqual([['otra', ANA_HASH]]);
    });

    it.each([
      ['does not exist', 'nadie'],
      ['is inactive', 'inactiva'],
      ['has no password yet', 'nueva'],
    ])('compares with the dummy hash when the username %s, and answers the same 401', async (_case, username) => {
      const { controller } = setup();

      const error = await refusal(controller.login({ username, password: 'secreto1' }, IP));

      expect(compareMock.mock.calls).toEqual([['secreto1', DUMMY_HASH]]);
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect(error.message).toBe('Usuario o contraseña incorrectos');
    });

    it('never lets the dummy hash in, whatever it is compared with', async () => {
      const { controller } = setup();
      compareMock.mockResolvedValueOnce(true);

      await expect(controller.login({ username: 'nadie', password: 'lo-que-sea' }, IP)).rejects.toThrow(UnauthorizedException);
    });

    // A cheaper dummy would answer an unknown username sooner than a real one.
    it('has a dummy hash as costly as the hash of every password the API stores', async () => {
      const stored: string[] = [];
      const db = {
        user: {
          findUnique: jest.fn().mockResolvedValue(null),
          findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 5, passwordHash: ANA_HASH }),
          create: jest.fn(({ data }: { data: { passwordHash: string } }) => {
            stored.push(data.passwordHash);
            return Promise.resolve({ id: 6, username: 'luis', name: 'Luis', active: true, passwordHash: data.passwordHash, role: 'AGENT' });
          }),
          update: jest.fn(({ data }: { data: { passwordHash?: string } }) => {
            if (data.passwordHash) stored.push(data.passwordHash);
            return Promise.resolve({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: data.passwordHash ?? null, role: 'AGENT' });
          }),
        },
      };
      const me: AuthUser = { id: 5, username: 'ana', name: 'Ana', role: 'ADMIN' };
      const prisma = db as unknown as PrismaService;

      const events = new EventsService();
      await new UsersController(prisma, events).create({ username: 'luis', name: 'Luis', password: 'secreto1' });
      // An administrator resets the password of someone else: their own is changed in Mi cuenta.
      await new UsersController(prisma, events).update(6, { password: 'secreto2' }, me);
      await new AuthController(prisma, { signAsync: jest.fn() } as unknown as JwtService, events).changePassword(me, { current: 'secreto1', next: 'secreto3' });

      expect(stored).toHaveLength(3);
      expect(stored.map((hash) => getRounds(hash))).toEqual([getRounds(DUMMY_HASH), getRounds(DUMMY_HASH), getRounds(DUMMY_HASH)]);
      expect(getRounds(DUMMY_HASH)).toBe(10);
      // A real bcrypt hash, which compare works through: a malformed one would answer at once.
      await expect(jest.requireActual<typeof import('bcryptjs')>('bcryptjs').compare('secreto1', DUMMY_HASH)).resolves.toBe(false);
    });
  });

  // Whoever knew the old password, or kept a token signed with it, is out; this session goes on.
  describe('change of the own password', () => {
    const ana: AuthUser = { id: 5, username: 'ana', name: 'Ana', role: 'AGENT' };

    const passwordSetup = () => {
      const db = {
        user: {
          findUniqueOrThrow: jest.fn().mockResolvedValue(users.ana),
          update: jest.fn(({ data }: { data: { passwordHash: string } }) => Promise.resolve({ ...users.ana, passwordHash: data.passwordHash, tokenVersion: 1 })),
        },
      };
      const jwt = { signAsync: jest.fn().mockResolvedValue('token-nuevo') };
      const events = new EventsService();
      const ended: number[] = [];
      events.sessionsEnded$.subscribe((userId) => ended.push(userId));
      return { db, jwt, events, ended, controller: new AuthController(db as unknown as PrismaService, jwt as unknown as JwtService, events) };
    };

    it('stores the new password and ends every session the user had, this one too', async () => {
      const { db, controller } = passwordSetup();

      await controller.changePassword(ana, { current: 'secreto1', next: 'secreto9' });

      expect(db.user.update).toHaveBeenCalledTimes(1);
      const [{ where, data }] = db.user.update.mock.calls[0] as [{ where: unknown; data: { passwordHash: string; tokenVersion: unknown } }];
      expect(where).toEqual({ id: 5 });
      expect(data).toEqual({ passwordHash: expect.any(String) as string, tokenVersion: { increment: 1 } });
      expect(compareSync('secreto9', data.passwordHash)).toBe(true);
    });

    // An open stream is not asked again for its token: it has to hear that the session is over.
    it('ends the open streams of events of the user once the new password is stored, not before', async () => {
      const { db, events, ended, controller } = passwordSetup();
      let stored = false;
      let storedWhenAnnounced: boolean | undefined;
      db.user.update.mockImplementationOnce(
        ({ data }) =>
          new Promise((done) =>
            setImmediate(() => {
              stored = true;
              done({ ...users.ana, passwordHash: data.passwordHash, tokenVersion: 1 });
            }),
          ),
      );
      events.sessionsEnded$.subscribe(() => (storedWhenAnnounced = stored));

      await controller.changePassword(ana, { current: 'secreto1', next: 'secreto9' });

      expect(ended).toEqual([5]);
      expect(storedWhenAnnounced).toBe(true);
    });

    it('ends no stream when nothing was stored', async () => {
      const { db, ended, controller } = passwordSetup();
      db.user.update.mockRejectedValueOnce(new Error('la base de datos no responde'));

      await refusal(controller.changePassword(ana, { current: 'otra', next: 'secreto9' }));
      await expect(controller.changePassword(ana, { current: 'secreto1', next: 'secreto9' })).rejects.toThrow('la base de datos no responde');

      expect(ended).toEqual([]);
    });

    // The web keeps it in place of the one it sent, which is refused from now on.
    it('answers a token for this session, signed with the version the user has now', async () => {
      const { jwt, controller } = passwordSetup();

      expect(await controller.changePassword(ana, { current: 'secreto1', next: 'secreto9' })).toEqual({ token: 'token-nuevo' });
      expect(jwt.signAsync.mock.calls).toEqual([[{ sub: 5, role: 'AGENT', ver: 1 }]]);
    });

    // With 204 the body, and the new token in it, would never reach the browser.
    it('answers 200, with the token in the body', () => {
      expect(Reflect.getMetadata(HTTP_CODE_METADATA, AuthController.prototype.changePassword)).toBe(HttpStatus.OK);
    });

    it('changes nothing and ends no session when the current password is wrong', async () => {
      const { db, jwt, controller } = passwordSetup();

      const refused = await refusal(controller.changePassword(ana, { current: 'otra', next: 'secreto9' }));

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused.message).toBe('La contraseña actual no es correcta');
      expect(db.user.update).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    // A user an administrator created without a password: there is no current one to compare.
    it('changes nothing for a user without a password yet', async () => {
      const { db, jwt, controller } = passwordSetup();
      db.user.findUniqueOrThrow.mockResolvedValue(users.nueva);

      const refused = await refusal(controller.changePassword({ id: 7, username: 'nueva', name: 'Nueva', role: 'AGENT' }, { current: '', next: 'secreto9' }));

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused.message).toBe('La contraseña actual no es correcta');
      expect(db.user.update).not.toHaveBeenCalled();
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('lock of a username', () => {
    const wrong = (controller: AuthController, username = 'ana', ip = IP) => controller.login({ username, password: 'mal' }, ip).catch((error: unknown) => error);
    /** An address of its own for the i-th of many logins. */
    const addressNumber = (i: number): string => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

    it('answers 429 from the fifth failure in a row, even with the right password, for a minute', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) expect(await wrong(controller)).toBeInstanceOf(UnauthorizedException);

      const locked = await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP));
      expect(locked.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(locked.message).toBe('Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.');
      // From another computer too.
      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, '10.0.0.9'))).message).toBe(LOCKED_MESSAGE);
      // While locked, the password is not even compared.
      compareMock.mockClear();
      await refusal(controller.login({ username: 'ANA', password: 'secreto1' }, IP));
      expect(compareMock).not.toHaveBeenCalled();

      now += LOCK_MS;
      expect((await controller.login({ username: 'ana', password: 'secreto1' }, IP)).user.id).toBe(5);
    });

    it('starts the count again after a login that works', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES - 1; i++) await wrong(controller);
      await controller.login({ username: 'ana', password: 'secreto1' }, IP);

      for (let i = 0; i < MAX_FAILURES - 1; i++) await wrong(controller);

      expect((await controller.login({ username: 'ana', password: 'secreto1' }, IP)).user.id).toBe(5);
    });

    // Or failing five times with someone else's username would lock everybody out.
    it('locks that username alone: the others log in as before', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) await wrong(controller);

      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect((await controller.login({ username: 'jefa', password: 'secreto1' }, IP)).user.id).toBe(8);
      expect(await wrong(controller, 'jefa')).toBeInstanceOf(UnauthorizedException);
    });

    // Each login counts from when it starts: sent all at once, from as many addresses, they cannot
    // all pass the check before the first of them has failed.
    it('compares no more passwords of a username than the lock allows when the logins arrive all at once', async () => {
      const { controller } = setup();
      compareMock.mockImplementation(() => new Promise((done) => setTimeout(() => done(false), 5)));

      const answers = await Promise.all(Array.from({ length: 30 }, (_, i) => wrong(controller, 'ana', addressNumber(i))));

      compareMock.mockImplementation(jest.requireActual<typeof import('bcryptjs')>('bcryptjs').compare);
      expect(compareMock).toHaveBeenCalledTimes(MAX_FAILURES);
      expect(answers.filter((answer) => answer instanceof UnauthorizedException)).toHaveLength(MAX_FAILURES);
      expect(answers.filter((answer) => answer instanceof TooManyAttemptsException)).toHaveLength(30 - MAX_FAILURES);
    });

    it('locks a username that does not exist as it locks a real one', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) await wrong(controller, 'nadie');

      expect((await refusal(controller.login({ username: 'nadie', password: 'x' }, IP))).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    });

    // Before, the whole map of failures was emptied past 5000 usernames: failures with made-up
    // ones unlocked a real user, and the guessing went on. Each from an address of its own, under
    // the limit of failed logins of each address.
    it('stays through more failed logins with made-up usernames than the map holds', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) await wrong(controller);
      // The comparison of so many logins, at once: what is tested here is the map.
      compareMock.mockResolvedValue(false);

      for (let i = 0; i <= MAX_TRACKED; i++) await wrong(controller, `inventado-${i}`, addressNumber(i));

      compareMock.mockImplementation(jest.requireActual<typeof import('bcryptjs')>('bcryptjs').compare);
      const locked = await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP));
      expect(locked.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(locked.message).toBe(LOCKED_MESSAGE);
      // The addresses were bounded too.
      expect(MAX_TRACKED + 1).toBeGreaterThan(MAX_ADDRESSES);
    });
  });

  describe('failed logins of an address', () => {
    let attempt = 0;
    /** A failed login from `ip`, each with a username of its own: the lock of a username is not what is tested here. */
    const failFrom = (controller: AuthController, ip = IP) => controller.login({ username: `nadie-${++attempt}`, password: 'mal' }, ip).catch((error: unknown) => error);

    it('refuses every login from the address past LOGIN_RATE_LIMIT failed ones, the right password too, before the database or bcrypt', async () => {
      const { controller, db } = setup();
      for (let i = 0; i < ADDRESS_LIMIT; i++) expect(await failFrom(controller)).toBeInstanceOf(UnauthorizedException);
      compareMock.mockClear();
      db.user.findUnique.mockClear();

      const refused = await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP));

      expect(ADDRESS_LIMIT).toBe(20);
      expect(refused).toBeInstanceOf(TooManyAttemptsException);
      expect(refused.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(refused.message).toBe(ADDRESS_LIMIT_MESSAGE);
      expect(ADDRESS_LIMIT_MESSAGE).toBe('Demasiados intentos de ingreso desde este equipo. Espera un minuto y vuelve a intentarlo.');
      expect(compareMock).not.toHaveBeenCalled();
      expect(db.user.findUnique).not.toHaveBeenCalled();
    });

    it('lets the address in again once the minute of its first failure is over', async () => {
      const { controller } = setup();
      const start = now;
      for (let i = 0; i < ADDRESS_LIMIT; i++) await failFrom(controller);

      now = start + 59_999;
      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).message).toBe(ADDRESS_LIMIT_MESSAGE);
      now = start + 60_000;
      expect((await controller.login({ username: 'ana', password: 'secreto1' }, IP)).user.id).toBe(5);
    });

    it('counts each address apart: another computer still logs in', async () => {
      const { controller } = setup();
      for (let i = 0; i < ADDRESS_LIMIT; i++) await failFrom(controller);

      expect((await controller.login({ username: 'ana', password: 'secreto1' }, '10.0.0.2')).user.id).toBe(5);
      expect(await failFrom(controller, '10.0.0.2')).toBeInstanceOf(UnauthorizedException);
    });

    // Behind Docker Desktop every client reaches the API from one address: the whole team logs in from it.
    it('does not count the logins that work: a team behind one address logs in as often as it wants', async () => {
      const { controller } = setup();
      for (let i = 0; i < ADDRESS_LIMIT - 1; i++) await failFrom(controller);

      for (let i = 0; i < ADDRESS_LIMIT * 5; i++) {
        expect((await controller.login({ username: i % 2 ? 'ana' : 'jefa', password: 'secreto1' }, IP)).token).toBe('token-firmado');
      }

      expect(await failFrom(controller)).toBeInstanceOf(UnauthorizedException);
      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).message).toBe(ADDRESS_LIMIT_MESSAGE);
    });

    // Each login counts from when it starts: sent all at once, they cannot all pass the check
    // before the first of them has failed.
    it('compares no more passwords than the limit when the logins arrive all at once', async () => {
      const { controller } = setup();
      compareMock.mockImplementation(() => new Promise((done) => setTimeout(() => done(false), 5)));

      const answers = await Promise.all(Array.from({ length: ADDRESS_LIMIT + 10 }, () => failFrom(controller)));

      compareMock.mockImplementation(jest.requireActual<typeof import('bcryptjs')>('bcryptjs').compare);
      expect(compareMock).toHaveBeenCalledTimes(ADDRESS_LIMIT);
      expect(answers.filter((answer) => answer instanceof UnauthorizedException)).toHaveLength(ADDRESS_LIMIT);
      expect(answers.filter((answer) => answer instanceof TooManyAttemptsException)).toHaveLength(10);
    });

    it('takes LOGIN_RATE_LIMIT from the environment', async () => {
      process.env.LOGIN_RATE_LIMIT = '2';
      let controller: AuthController;
      try {
        controller = setup().controller;
      } finally {
        delete process.env.LOGIN_RATE_LIMIT;
      }
      await failFrom(controller);
      await failFrom(controller);

      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).message).toBe(ADDRESS_LIMIT_MESSAGE);
    });

    // A wrong current password counts for the username only: this limit is for the logins.
    it('does not count the wrong current passwords of a change of the own password', async () => {
      const { controller } = setup();
      const ana: AuthUser = { id: 5, username: 'ana', name: 'Ana', role: 'AGENT' };
      for (let i = 0; i < ADDRESS_LIMIT - 1; i++) await failFrom(controller);
      for (let i = 0; i < MAX_FAILURES - 1; i++) await refusal(controller.changePassword(ana, { current: 'mal', next: 'secreto9' }));

      expect((await controller.login({ username: 'jefa', password: 'secreto1' }, IP)).user.id).toBe(8);
    });
  });

  // The whole seconds left, rounded up and at least 1: the client knows when trying again is worth it.
  describe('the time left of a 429', () => {
    const retryAfter = (refused: HttpException): number => {
      expect(refused).toBeInstanceOf(TooManyAttemptsException);
      return (refused as TooManyAttemptsException).retryAfter;
    };

    it('is the rest of the minute of the address, from its first failure', async () => {
      const { controller } = setup();
      const start = now;
      for (let i = 0; i < ADDRESS_LIMIT; i++) await controller.login({ username: `otro-${i}`, password: 'mal' }, IP).catch(() => undefined);

      const at = async (time: number) => {
        now = time;
        return retryAfter(await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP)));
      };

      expect(await at(start)).toBe(60);
      expect(await at(start + 20_500)).toBe(40);
      expect(await at(start + 59_999)).toBe(1);
    });

    it('is the rest of the lock of the username, in the login and in the change of the own password', async () => {
      const { controller } = setup();
      const start = now;
      for (let i = 0; i < MAX_FAILURES; i++) await controller.login({ username: 'ana', password: 'mal' }, IP).catch(() => undefined);

      now = start + 15_200;
      const login = await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP));
      const change = await refusal(controller.changePassword({ id: 5, username: 'ana', name: 'Ana', role: 'AGENT' }, { current: 'secreto1', next: 'secreto9' }));

      expect(retryAfter(login)).toBe(45);
      expect(retryAfter(change)).toBe(45);
      now = start + LOCK_MS - 1;
      expect(retryAfter(await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP)))).toBe(1);
    });
  });

  // Before, a session left open could try current passwords there with no end: each wrong one a 400.
  describe('guessing the current password in a change of the own password', () => {
    const ana: AuthUser = { id: 5, username: 'ana', name: 'Ana', role: 'AGENT' };
    const change = (controller: AuthController, current: string) => controller.changePassword(ana, { current, next: 'secreto9' });

    it('locks the username at the fifth wrong one in a row, as five failed logins do, for both routes', async () => {
      const { controller, db } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) {
        const wrong = await refusal(change(controller, 'mal'));
        expect(wrong).toBeInstanceOf(BadRequestException);
        expect(wrong.message).toBe('La contraseña actual no es correcta');
      }
      compareMock.mockClear();

      const locked = await refusal(change(controller, 'secreto1'));
      expect(locked).toBeInstanceOf(TooManyAttemptsException);
      expect(locked.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(locked.message).toBe(LOCKED_MESSAGE);
      expect(LOCKED_MESSAGE).toBe('Demasiados intentos fallidos con este usuario. Espera un minuto y vuelve a intentarlo.');
      expect((locked as TooManyAttemptsException).retryAfter).toBe(60);
      // The login of the username is locked too.
      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).message).toBe(LOCKED_MESSAGE);
      // Nothing compared, nothing stored.
      expect(compareMock).not.toHaveBeenCalled();
      expect(db.user.update).not.toHaveBeenCalled();

      now += LOCK_MS;
      expect(await change(controller, 'secreto1')).toEqual({ token: 'token-firmado' });
    });

    it('is locked by failed logins of the username, and counts with them', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES; i++) await controller.login({ username: 'ana', password: 'mal' }, IP).catch(() => undefined);
      expect((await refusal(change(controller, 'secreto1'))).message).toBe(LOCKED_MESSAGE);

      now += LOCK_MS;
      for (let i = 0; i < 3; i++) await controller.login({ username: 'ANA', password: 'mal' }, IP).catch(() => undefined);
      await refusal(change(controller, 'mal'));
      expect(await refusal(change(controller, 'mal'))).toBeInstanceOf(BadRequestException);

      expect((await refusal(controller.login({ username: 'ana', password: 'secreto1' }, IP))).message).toBe(LOCKED_MESSAGE);
    });

    it('starts the count again after a right one, as a login that works does', async () => {
      const { controller } = setup();
      for (let i = 0; i < MAX_FAILURES - 1; i++) await refusal(change(controller, 'mal'));
      await change(controller, 'secreto1');

      for (let i = 0; i < MAX_FAILURES - 1; i++) await refusal(change(controller, 'mal'));

      expect(await change(controller, 'secreto1')).toEqual({ token: 'token-firmado' });
      expect((await controller.login({ username: 'ana', password: 'secreto1' }, IP)).user.id).toBe(5);
    });

    // Sent all at once, the guesses cannot all pass the check before the first of them has failed.
    it('compares no more current passwords than the lock allows when they arrive all at once', async () => {
      const { controller } = setup();
      compareMock.mockImplementation(() => new Promise((done) => setTimeout(() => done(false), 5)));

      const answers = await Promise.all(Array.from({ length: 30 }, () => change(controller, 'mal').catch((error: unknown) => error)));

      compareMock.mockImplementation(jest.requireActual<typeof import('bcryptjs')>('bcryptjs').compare);
      expect(compareMock).toHaveBeenCalledTimes(MAX_FAILURES);
      expect(answers.filter((answer) => answer instanceof BadRequestException)).toHaveLength(MAX_FAILURES);
      expect(answers.filter((answer) => answer instanceof TooManyAttemptsException)).toHaveLength(30 - MAX_FAILURES);
    });
  });
});
