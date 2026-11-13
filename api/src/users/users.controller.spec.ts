import type { AuthUser } from '../common/auth';
import type { PrismaService } from '../prisma.service';
import { UsersController } from './users.controller';

// The controller imports the login decorators and, through them, @nestjs/jwt, which is published
// as ES modules only: Jest cannot load it here. Nothing in these tests uses it.
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));

describe('user edit', () => {
  type UserChanges = Parameters<UsersController['update']>[1];
  const me: AuthUser = { id: 1, username: 'admin', name: 'Admin' };

  /** The controller over a fake database that holds user 5 and records what is written to it. */
  const setup = () => {
    const db = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: 6, username: 'luis', name: 'Luis', active: true, passwordHash: 'x' }),
        update: jest.fn().mockResolvedValue({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: null }),
      },
    };
    return { db, controller: new UsersController(db as unknown as PrismaService) };
  };

  // The checks of the request body let a null through, and the database does not take it in "active".
  it('reads a null as "not sent"', async () => {
    const { db, controller } = setup();

    await controller.update(5, { name: null, active: null, password: null } as unknown as UserChanges, me);

    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 5 }, data: { name: undefined, active: undefined, passwordHash: undefined } });
  });

  it('deactivates and reactivates a person', async () => {
    const { db, controller } = setup();

    await controller.update(5, { active: false }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { active: false } });

    await controller.update(5, { active: true }, me);
    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { active: true } });
  });

  // A user is somebody who logs in. Who attends the cases is the catalog of responsibles, apart from this one.
  it('answers with the user alone: nothing says which responsible they are', async () => {
    const { controller } = setup();

    expect(await controller.update(5, { name: 'Ana' }, me)).toEqual({ id: 5, username: 'ana', name: 'Ana', active: true, canLogin: false });
    expect(await controller.create({ username: 'luis', name: 'Luis', password: 'secreto1' })).toEqual({
      id: 6,
      username: 'luis',
      name: 'Luis',
      active: true,
      canLogin: true,
    });
  });

  it('creates a user with the username in lowercase and the name without the spaces around it', async () => {
    const { db, controller } = setup();

    await controller.create({ username: 'Luis', name: ' Luis ', password: 'secreto1' });

    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { username: 'luis' } });
    expect(db.user.create.mock.calls).toMatchObject([[{ data: { username: 'luis', name: 'Luis' } }]]);
    // Only these three columns are written: the password goes in hashed, never as it was typed.
    const [{ data }] = db.user.create.mock.calls[0] as [{ data: Record<string, string> }];
    expect(Object.keys(data).sort()).toEqual(['name', 'passwordHash', 'username']);
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
