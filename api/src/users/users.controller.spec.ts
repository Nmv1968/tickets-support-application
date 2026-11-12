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
        create: jest.fn().mockResolvedValue({ id: 6, username: 'luis', name: 'Luis', active: true, passwordHash: 'x', assigneeId: 2 }),
        update: jest.fn().mockResolvedValue({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: null, assigneeId: 2 }),
      },
      // The catalog holds the responsible 2 and no other.
      assignee: { findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(where.id === 2 ? { id: 2 } : null)) },
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

  // Attending cases is apart from being a user: the link says which responsible a user is.
  it('links a user to the responsible they are, and says so in its answer', async () => {
    const { db, controller } = setup();

    expect(await controller.update(5, { assigneeId: 2 }, me)).toMatchObject({ id: 5, assigneeId: 2 });

    expect(db.user.update).toHaveBeenLastCalledWith({ where: { id: 5 }, data: { assigneeId: 2 } });
  });

  it('unlinks with null, and leaves the link alone when it is not sent', async () => {
    const { db, controller } = setup();

    await controller.update(5, { assigneeId: null }, me);
    expect((db.user.update.mock.calls[0] as [{ data: { assigneeId?: unknown } }])[0].data.assigneeId).toBeNull();

    await controller.update(5, { name: 'Ana María' }, me);
    expect((db.user.update.mock.calls[1] as [{ data: { assigneeId?: unknown } }])[0].data.assigneeId).toBeUndefined();
    expect(db.assignee.findUnique).not.toHaveBeenCalled();
  });

  it('refuses a link to a responsible that does not exist, on edit and on create', async () => {
    const { db, controller } = setup();

    await expect(controller.update(5, { assigneeId: 9 }, me)).rejects.toThrow('El responsable no existe');
    await expect(controller.create({ username: 'luis', name: 'Luis', password: 'secreto1', assigneeId: 9 })).rejects.toThrow('El responsable no existe');
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.user.create).not.toHaveBeenCalled();
  });

  it('creates a user linked to a responsible, or to none', async () => {
    const { db, controller } = setup();

    await controller.create({ username: 'Luis', name: ' Luis ', password: 'secreto1', assigneeId: 2 });
    await controller.create({ username: 'luis2', name: 'Luis', password: 'secreto1' });

    expect(db.user.create.mock.calls).toMatchObject([
      [{ data: { username: 'luis', name: 'Luis', assigneeId: 2 } }],
      [{ data: { username: 'luis2', name: 'Luis', assigneeId: null } }],
    ]);
  });

  it('does not let a person deactivate their own user', async () => {
    const { db, controller } = setup();

    await expect(controller.update(1, { active: false }, me)).rejects.toThrow('No puedes desactivar tu propio usuario');
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
