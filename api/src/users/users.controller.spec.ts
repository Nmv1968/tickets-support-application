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
    const db = { user: { update: jest.fn().mockResolvedValue({ id: 5, username: 'ana', name: 'Ana', active: true, passwordHash: null }) } };
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

  it('does not let a person deactivate their own user', async () => {
    const { db, controller } = setup();

    await expect(controller.update(1, { active: false }, me)).rejects.toThrow('No puedes desactivar tu propio usuario');
    expect(db.user.update).not.toHaveBeenCalled();
  });
});
