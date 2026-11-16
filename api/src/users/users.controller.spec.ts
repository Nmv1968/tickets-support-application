import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { ClassConstructor } from 'class-transformer';
import { ADMIN_USER, sqlText } from '../common/testing';
import { EventsService } from '../events/events.service';
import type { PrismaService } from '../prisma.service';
import { WORKING_ADMIN } from './admins';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

type UserChanges = Parameters<UsersController['update']>[1];

/** The role each user has before the edit: 1 is the administrator of the session, 5 an agent. */
const STORED_ROLES: Record<number, 'ADMIN' | 'AGENT'> = { 1: 'ADMIN', 5: 'AGENT' };

/** The controller and its service over a fake database that holds user 5 and records what is written to it. */
const setup = () => {
  const db = {
    user: {
      findUnique: jest.fn().mockResolvedValue(null),
      findUniqueOrThrow: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve({ role: STORED_ROLES[where.id] })),
      create: jest.fn().mockResolvedValue({ id: 6, username: 'luis', name: 'Luis', active: true, passwordHash: 'x', role: 'AGENT' }),
      update: jest.fn().mockResolvedValue({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: null, role: 'AGENT' }),
      // The administrators who can log in, once the edit is written: the one of the session, at least.
      count: jest.fn().mockResolvedValue(1),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    // An interactive transaction over the same fake: what it writes is what the calls record.
    $transaction: jest.fn(<T>(work: (tx: unknown) => Promise<T>): Promise<T> => work(db)),
  };
  const events = new EventsService();
  /** The users whose open streams of events were told to end, in order. */
  const ended: number[] = [];
  events.sessionsEnded$.subscribe((userId) => ended.push(userId));
  return { db, events, ended, controller: new UsersController(new UsersService(db as unknown as PrismaService, events)) };
};

const me = ADMIN_USER;

describe('user edit', () => {
  // The checks of the request body let a null through, and the database does not take it in "active".
  it('reads a null as "not sent"', async () => {
    const { db, controller } = setup();

    await controller.update(5, { name: null, active: null, password: null, role: null } as unknown as UserChanges, me);

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { name: undefined, active: undefined, role: undefined, passwordHash: undefined } });
  });

  it('deactivates and reactivates a person', async () => {
    const { db, controller } = setup();

    await controller.update(5, { active: false }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { active: false, tokenVersion: { increment: 1 } } });

    await controller.update(5, { active: true }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { active: true } });
  });

  // A user is somebody who logs in. Who attends the cases is the catalog of responsibles, apart from this one.
  it('answers with the user alone and their role: nothing says which responsible they are', async () => {
    const { controller } = setup();

    expect(await controller.update(5, { name: 'Ana' }, me)).toEqual({ id: 5, username: 'ana', name: 'Ana', active: true, canLogin: false, role: 'AGENT' });
    expect(await controller.create({ username: 'luis', name: 'Luis', password: 'secreto1' })).toEqual({
      id: 6,
      username: 'luis',
      name: 'Luis',
      active: true,
      canLogin: true,
      role: 'AGENT',
    });
  });

  it('creates a user with the username in lowercase and the name without the spaces around it', async () => {
    const { db, controller } = setup();

    await controller.create({ username: 'Luis', name: ' Luis ', password: 'secreto1' });

    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { username: 'luis' } });
    expect(db.user.create.mock.calls).toMatchObject([[{ data: { username: 'luis', name: 'Luis' } }]]);
    // Only these columns are written: the password goes in hashed, never as it was typed.
    const [{ data }] = db.user.create.mock.calls[0] as [{ data: Record<string, string> }];
    expect(Object.keys(data).sort()).toEqual(['name', 'passwordHash', 'role', 'username']);
    expect(data.passwordHash).not.toContain('secreto1');
  });

  it('refuses a username that is already taken', async () => {
    const { db, controller } = setup();
    db.user.findUnique.mockResolvedValue({ id: 5, username: 'ana' });

    await expect(controller.create({ username: 'ANA', name: 'Ana', password: 'secreto1' })).rejects.toThrow('Ya existe un usuario con ese nombre de usuario');
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('does not let a person deactivate their own user', async () => {
    const { db, controller } = setup();

    await expect(controller.update(1, { active: false }, me)).rejects.toThrow('No puedes desactivar tu propio usuario');
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe('role of a user', () => {
  // Nobody loses or gains power by being created: an administrator says who else is one.
  it('is agent for a new user unless the administrator says otherwise', async () => {
    const { db, controller } = setup();

    await controller.create({ username: 'luis', name: 'Luis', password: 'secreto1' });
    await controller.create({ username: 'marta', name: 'Marta', password: 'secreto1', role: 'ADMIN' });

    expect(db.user.create.mock.calls.map(([{ data }]: [{ data: { role: string } }]) => data.role)).toEqual(['AGENT', 'ADMIN']);
  });

  it('is changed by an administrator, for someone else', async () => {
    const { db, controller } = setup();
    db.user.findUniqueOrThrow.mockResolvedValueOnce({ role: 'AGENT' }).mockResolvedValueOnce({ role: 'ADMIN' });

    await controller.update(5, { role: 'ADMIN' }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { role: 'ADMIN', tokenVersion: { increment: 1 } } });

    await controller.update(5, { role: 'AGENT' }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { role: 'AGENT', tokenVersion: { increment: 1 } } });
  });

  // Whoever does it would lose the screen to undo it, and may be the last administrator.
  it('is never changed by the person themselves', async () => {
    const { db, controller } = setup();

    const refused = await controller.update(1, { role: 'AGENT' }, me).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused).toHaveProperty('message', 'No puedes cambiar tu propio rol. Otro administrador puede hacerlo.');
    expect(db.user.update).not.toHaveBeenCalled();
    // Their own name, password or the role they already have are still theirs to send.
    await controller.update(1, { name: 'Admin', role: 'ADMIN' }, me);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 1 }, data: { name: 'Admin', role: 'ADMIN' } });
  });

  it('refuses a role that does not exist, in Spanish', async () => {
    const errors = async <T extends object>(type: ClassConstructor<T>, body: Record<string, unknown>): Promise<string[]> =>
      (await validate(plainToInstance(type, body))).flatMap((error) => Object.values(error.constraints ?? {}));
    const message = 'El rol debe ser ADMIN (administrador) o AGENT (agente)';
    // The classes of the two bodies, as Nest finds them to check a request.
    const bodyOf = (method: 'create' | 'update', index: number): ClassConstructor<object> =>
      (Reflect.getMetadata('design:paramtypes', UsersController.prototype, method) as ClassConstructor<object>[])[index];
    const [createDto, updateDto] = [bodyOf('create', 0), bodyOf('update', 1)];

    expect(await errors(createDto, { username: 'luis', name: 'Luis', password: 'secreto1', role: 'OWNER' })).toEqual([message]);
    expect(await errors(updateDto, { role: 'admin' })).toEqual([message]);
    expect(await errors(updateDto, { role: 'AGENT' })).toEqual([]);
  });
});

// The tokens signed before carry the old version of the user and are refused (JwtGuard): a session
// open with a password that is no longer the one, or by someone demoted or deactivated, ends there.
describe('the sessions a user has open', () => {
  const ENDS = { tokenVersion: { increment: 1 } };
  const written = (db: ReturnType<typeof setup>['db']): Record<string, unknown> => (db.user.update.mock.calls.at(-1) as [{ data: Record<string, unknown> }])[0].data;

  it.each([
    ['a password reset by an administrator', { password: 'secreto2' }],
    ['a deactivation', { active: false }],
    ['a promotion to administrator', { role: 'ADMIN' }],
  ] as [string, UserChanges][])('end with %s, in the same write', async (_case, changes) => {
    const { db, controller } = setup();

    await controller.update(5, changes, me);

    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(written(db)).toMatchObject(ENDS);
  });

  // Undone with the rest if it would leave no administrator: the sessions go on then.
  it('end with a demotion, inside the transaction that checks the last administrator', async () => {
    const { db, controller } = setup();
    db.user.findUniqueOrThrow.mockResolvedValue({ role: 'ADMIN' });

    await controller.update(5, { role: 'AGENT' }, me);

    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(written(db)).toEqual({ role: 'AGENT', ...ENDS });
  });

  it.each([
    ['a new name', { name: 'Ana María' }],
    ['the user active again', { active: true }],
    ['the role the user already has', { role: 'AGENT' }],
  ] as [string, UserChanges][])('go on with %s', async (_case, changes) => {
    const { db, controller } = setup();

    await controller.update(5, changes, me);

    expect(written(db)).not.toHaveProperty('tokenVersion');
  });

  it('go on when the administrator sends their own name and role', async () => {
    const { db, controller } = setup();

    await controller.update(1, { name: 'Admin', role: 'ADMIN' }, me);

    expect(written(db)).not.toHaveProperty('tokenVersion');
  });

  // Written here, it would end the very session that sent it. Mi cuenta asks for the current one
  // and answers the token this session goes on with.
  it('are not ended by an administrator resetting their own password here: that is done in Mi cuenta', async () => {
    const { db, controller } = setup();

    const refused = await controller.update(1, { password: 'secreto2' }, me).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused).toHaveProperty('message', 'Tu propia contraseña se cambia en Configuración > Mi cuenta, con la contraseña actual.');
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('are looked at on a user that exists: one that does not answers before anything is written', async () => {
    const { db, controller } = setup();
    const missing = new Error('El registro no existe');
    db.user.findUniqueOrThrow.mockRejectedValue(missing);

    await expect(controller.update(99, { role: 'ADMIN' }, me)).rejects.toBe(missing);
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

// JwtGuard looks at the token of a stream only when it opens: the stream has to hear that the
// session is over, from the write that ended it.
describe('the open streams of events of a user', () => {
  it.each([
    ['a password reset by an administrator', { password: 'secreto2' }],
    ['a deactivation', { active: false }],
    ['a promotion to administrator', { role: 'ADMIN' }],
    ['a demotion to agent', { role: 'AGENT' }],
  ] as [string, UserChanges][])('end with %s, once it is written', async (_case, changes) => {
    const { db, events, ended, controller } = setup();
    db.user.findUniqueOrThrow.mockResolvedValue({ role: changes.role === 'AGENT' ? 'ADMIN' : 'AGENT' });
    // The write, and the transaction that holds it when there is one, done a moment later, as a
    // database does. Committed: the write once done, or the transaction once done.
    const later = <T>(value: T): Promise<T> => new Promise((done) => setImmediate(() => done(value)));
    let committed = false;
    db.user.update.mockImplementationOnce(() =>
      later({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: null, role: 'AGENT' }).then((row) => {
        if (db.$transaction.mock.calls.length === 0) committed = true;
        return row;
      }),
    );
    db.$transaction.mockImplementationOnce(<T>(work: (tx: unknown) => Promise<T>) =>
      work(db)
        .then(later)
        .then((result) => {
          committed = true;
          return result;
        }),
    );
    let committedWhenAnnounced: boolean | undefined;
    events.sessionsEnded$.subscribe(() => (committedWhenAnnounced = committed));

    await controller.update(5, changes, me);

    expect(ended).toEqual([5]);
    expect(committedWhenAnnounced).toBe(true);
  });

  it.each([
    ['a new name', { name: 'Ana María' }],
    ['the user active again', { active: true }],
    ['the role the user already has', { role: 'AGENT' }],
  ] as [string, UserChanges][])('go on with %s', async (_case, changes) => {
    const { ended, controller } = setup();

    await controller.update(5, changes, me);

    expect(ended).toEqual([]);
  });

  // The transaction undid the edit: the sessions go on, and so do their streams.
  it('go on when the edit would leave no administrator', async () => {
    const { db, ended, controller } = setup();
    db.user.count.mockResolvedValue(0);

    await expect(controller.update(5, { active: false }, me)).rejects.toBeInstanceOf(BadRequestException);

    expect(db.user.update).toHaveBeenCalledTimes(1);
    expect(ended).toEqual([]);
  });

  it('go on when the edit is refused before anything is written', async () => {
    const { ended, controller } = setup();

    await controller.update(1, { password: 'secreto2' }, me).catch(() => undefined);
    await controller.update(1, { active: false }, me).catch(() => undefined);

    expect(ended).toEqual([]);
  });
});

// Without an administrator nobody can manage users or settings again, short of a restart (SeedService).
describe('the last administrator', () => {
  const lastOneMessage = 'Debe quedar al menos un administrador activo. Haz administrador a otra persona antes.';

  it.each([
    ['made an agent', { role: 'AGENT' }],
    ['deactivated', { active: false }],
  ] as [string, UserChanges][])('cannot be %s: the edit is undone and the person is told why', async (_case, changes) => {
    const { db, controller } = setup();
    // Written, there would be no administrator left.
    db.user.count.mockResolvedValue(0);

    const refused = await controller.update(5, changes, me).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(BadRequestException);
    expect(refused).toHaveProperty('message', lastOneMessage);
    // Asked inside the transaction that wrote the edit, after it: thrown there, it undoes the edit.
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.user.count).toHaveBeenCalledWith({ where: WORKING_ADMIN });
    expect(db.user.update.mock.invocationCallOrder[0]).toBeLessThan(db.user.count.mock.invocationCallOrder[0]);
  });

  // Two administrators who demote each other at once would each still see the other.
  it('is counted under a lock that every such edit takes, before it writes', async () => {
    const { db, controller } = setup();

    await controller.update(5, { role: 'AGENT' }, me);
    await controller.update(5, { active: false }, me);

    expect(db.$executeRaw).toHaveBeenCalledTimes(2);
    const [sql, key] = db.$executeRaw.mock.calls[0] as [TemplateStringsArray, number];
    expect(sqlText(sql)).toBe('SELECT pg_advisory_xact_lock(?::bigint)');
    expect(key).toEqual(expect.any(Number));
    expect(db.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(db.user.update.mock.invocationCallOrder[0]);
  });

  it('counts only the active administrators who can log in', () => {
    expect(WORKING_ADMIN).toEqual({ role: 'ADMIN', active: true, passwordHash: { not: null } });
  });

  // Nothing of these takes an administrator away: no lock, no count.
  it.each([
    ['a new name', { name: 'Ana María' }],
    ['a new password', { password: 'secreto2' }],
    ['the role of administrator', { role: 'ADMIN' }],
    ['the user active again', { active: true }],
  ] as [string, UserChanges][])('is not looked for to write %s', async (_case, changes) => {
    const { db, controller } = setup();

    await controller.update(5, changes, me);

    expect(db.$transaction).not.toHaveBeenCalled();
    expect(db.user.count).not.toHaveBeenCalled();
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });
});
