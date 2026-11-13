import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma.service';
import { CatalogController, ModuleInput } from './catalog.controller';

describe('module input', () => {
  /** What the person would read for this request body: the messages of the 400, none when it is accepted. */
  const errors = async (input: Record<string, unknown>): Promise<string[]> =>
    (await validate(plainToInstance(ModuleInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

  // Beyond 2147483647 the database cannot even hold the number.
  it.each([0, -1, 2_147_483_648, 99_999_999_999])('refuses %d as parent, an id no module can have', async (parentId) => {
    expect(await errors({ parentId })).toEqual(['El módulo padre no existe']);
  });

  it('accepts the id of a module as parent, and null for a top-level module', async () => {
    expect(await errors({ parentId: 1 })).toEqual([]);
    expect(await errors({ parentId: 2_147_483_647 })).toEqual([]);
    expect(await errors({ parentId: null })).toEqual([]);
  });
});

describe('module name', () => {
  /** The controller over a fake database that records what is written to the modules. */
  const setup = () => {
    const db = { systemModule: { create: jest.fn().mockResolvedValue({ id: 9 }), update: jest.fn().mockResolvedValue({}) } };
    return { db, controller: new CatalogController(db as unknown as PrismaService) };
  };
  const refusal = (name: string): string => `"${name}" no puede ser el nombre de un módulo: en los reportes ya significa que el caso no tiene ninguno`;

  // The reports of the dashboard put the cases without a module in a row called "Sin módulo". A
  // module with that name would give them two rows with the same label and different counts.
  it.each(['Sin módulo', 'SIN MODULO', ' sin   módulo '])('cannot be "%s", new or renamed: that is how the reports name the cases without a module', async (name) => {
    const { db, controller } = setup();

    const created = await controller.createModule({ name }).catch((error: unknown) => error);
    const renamed = await controller.updateModule(3, { name }).catch((error: unknown) => error);

    for (const refused of [created, renamed]) {
      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', refusal(name.trim()));
    }
    expect(db.systemModule.create).not.toHaveBeenCalled();
    expect(db.systemModule.update).not.toHaveBeenCalled();
  });

  it('can be any other, also one that only starts like it, and is stored without the spaces around it', async () => {
    const { db, controller } = setup();

    expect(await controller.createModule({ name: '  Sin módulo asignado ' })).toEqual({ id: 9 });
    await controller.updateModule(3, { name: ' Ventas ' });

    expect(db.systemModule.create).toHaveBeenCalledWith({ data: { name: 'Sin módulo asignado', parentId: null } });
    expect(db.systemModule.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { name: 'Ventas', parentId: undefined, active: undefined } });
  });

  it('is required for a new module', async () => {
    const { db, controller } = setup();

    await expect(controller.createModule({ name: '   ' })).rejects.toThrow('El nombre es obligatorio');
    expect(db.systemModule.create).not.toHaveBeenCalled();
  });
});

describe('module edit', () => {
  /** The controller over a fake database that records what is written to module 3. */
  const setup = () => {
    const db = { systemModule: { update: jest.fn().mockResolvedValue({}) } };
    return { db, controller: new CatalogController(db as unknown as PrismaService) };
  };

  // The checks of the request body let a null through, and the database does not take it in "active".
  it('reads a null "active" or name as "not sent"', async () => {
    const { db, controller } = setup();

    await controller.updateModule(3, { name: null, active: null } as unknown as ModuleInput);

    expect(db.systemModule.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { name: undefined, parentId: undefined, active: undefined } });
  });

  it('deactivates a module, and makes it a top-level one when the parent is null', async () => {
    const { db, controller } = setup();

    await controller.updateModule(3, { active: false, parentId: null });

    expect(db.systemModule.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { parentId: null, active: false } });
  });
});
