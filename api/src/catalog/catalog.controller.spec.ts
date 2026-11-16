import { BadRequestException, ConflictException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { searchKey } from '../common/labels';
import { uniqueViolation } from '../common/testing';
import type { PrismaService } from '../prisma.service';
import { CatalogController } from './catalog.controller';
import { ModuleInput, ModulesService } from './modules.service';
import { SlaService } from './sla.service';

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
    return { db, controller: new CatalogController(new ModulesService(db as unknown as PrismaService), new SlaService(db as unknown as PrismaService)) };
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

    // With the key of the name, which no other module in the same place can have.
    expect(db.systemModule.create).toHaveBeenCalledWith({ data: { name: 'Sin módulo asignado', nameKey: 'sin modulo asignado', parentId: null } });
    expect(db.systemModule.update).toHaveBeenCalledWith({ where: { id: 3 }, data: { name: 'Ventas', nameKey: 'ventas', parentId: undefined, active: undefined } });
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
    return { db, controller: new CatalogController(new ModulesService(db as unknown as PrismaService), new SlaService(db as unknown as PrismaService)) };
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

describe('modules with the same name', () => {
  interface ModuleRow {
    id: number;
    name: string;
    nameKey: string;
    parentId: number | null;
    active: boolean;
  }
  const row = (id: number, name: string, parentId: number | null, active = true): ModuleRow => ({ id, name, nameKey: searchKey(name), parentId, active });

  /**
   * The controller over a fake table of modules with the unique index of the database: no two
   * modules with the same key of the name in the same place, the main modules (no parent) being
   * one place too (NULLS NOT DISTINCT).
   */
  const setup = () => {
    const rows = [row(1, 'Ventas', null), row(2, 'Compras', null), row(3, 'Facturas', 1), row(4, 'Notas de crédito', 1, false), row(5, 'Facturas', 2), row(6, 'Nómina', null, false)];
    const place = (data: Partial<ModuleRow>, own?: ModuleRow): Pick<ModuleRow, 'parentId' | 'nameKey'> => ({
      parentId: data.parentId === undefined ? (own?.parentId ?? null) : data.parentId,
      nameKey: data.nameKey ?? own?.nameKey ?? '',
    });
    const refusal = (wanted: Pick<ModuleRow, 'parentId' | 'nameKey'>, selfId: number | null): Error | null =>
      rows.some((other) => other.id !== selfId && other.parentId === wanted.parentId && other.nameKey === wanted.nameKey)
        ? uniqueViolation('SystemModule', 'parentId', 'nameKey')
        : null;
    const withParent = (found: ModuleRow | undefined) => found && { ...found, parent: rows.find((other) => other.id === found.parentId) ?? null };
    const systemModule = {
      findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(rows.find((each) => each.id === where.id) ?? null)),
      findFirst: jest.fn(({ where }: { where: { parentId: number | null; nameKey: string; id?: { not: number } } }) =>
        Promise.resolve(withParent(rows.find((each) => each.parentId === where.parentId && each.nameKey === where.nameKey && each.id !== where.id?.not)) ?? null),
      ),
      count: jest.fn(({ where }: { where: { parentId: number } }) => Promise.resolve(rows.filter((each) => each.parentId === where.parentId).length)),
      create: jest.fn(({ data }: { data: ModuleRow }) => {
        const refused = refusal(place(data), null);
        if (refused) return Promise.reject(refused);
        const created = { ...data, id: rows.length + 1, active: true };
        rows.push(created);
        return Promise.resolve(created);
      }),
      update: jest.fn(({ where, data }: { where: { id: number }; data: Partial<ModuleRow> }) => {
        const own = rows.find((each) => each.id === where.id);
        const refused = own ? refusal(place(data, own), own.id) : null;
        if (refused) return Promise.reject(refused);
        Object.assign(own ?? {}, Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)));
        return Promise.resolve(own);
      }),
    };
    const db = { systemModule };
    return { rows, systemModule, controller: new CatalogController(new ModulesService(db as unknown as PrismaService), new SlaService(db as unknown as PrismaService)) };
  };
  const refused = (promise: Promise<unknown>): Promise<unknown> => promise.then(() => undefined).catch((error: unknown) => error);

  it('can repeat a name in another place: a submodule of another module', async () => {
    const { rows, controller } = setup();

    await controller.createModule({ name: 'Notas  de Crédito', parentId: 2 });

    expect(rows.filter((each) => each.nameKey === 'notas de credito').map((each) => [each.id, each.name, each.parentId])).toEqual([
      [4, 'Notas de crédito', 1],
      [7, 'Notas  de Crédito', 2],
    ]);
  });

  // The unique index refuses the module, and the answer says where the other one is.
  it.each([
    ['a submodule', { name: 'FACTURAS', parentId: 1 }, 'Ya existe un módulo con ese nombre en Ventas'],
    ['a main module', { name: ' ventas ' }, 'Ya existe un módulo principal con ese nombre'],
    ['a main module, with a null parent', { name: 'Compras', parentId: null }, 'Ya existe un módulo principal con ese nombre'],
    ['a deactivated submodule', { name: 'notas de credito', parentId: 1 }, 'Ya existe un módulo con ese nombre en Ventas, pero está inactivo. Actívalo en Configuración > Módulos.'],
    ['a deactivated main module', { name: 'NOMINA' }, 'Ya existe un módulo principal con ese nombre, pero está inactivo. Actívalo en Configuración > Módulos.'],
  ])('cannot be new in the place of %s with that name', async (_what, input, message) => {
    const { rows, controller } = setup();

    const failure = await refused(controller.createModule(input));

    expect(failure).toBeInstanceOf(ConflictException);
    expect(failure).toHaveProperty('message', message);
    expect(rows).toHaveLength(6);
  });

  it('cannot take, by a rename, the name of another module of its place', async () => {
    const { rows, controller } = setup();

    expect(await refused(controller.updateModule(3, { name: 'Notas de Credito' }))).toEqual(
      new ConflictException('Ya existe un módulo con ese nombre en Ventas, pero está inactivo. Actívalo en Configuración > Módulos.'),
    );
    expect(await refused(controller.updateModule(2, { name: 'ventas' }))).toEqual(new ConflictException('Ya existe un módulo principal con ese nombre'));
    expect(rows.map((each) => each.name)).toEqual(['Ventas', 'Compras', 'Facturas', 'Notas de crédito', 'Facturas', 'Nómina']);
  });

  // "Compras > Facturas" moved under Ventas would be a second "Ventas > Facturas".
  it('cannot be moved where a module has its name, renamed or not', async () => {
    const { rows, controller } = setup();

    expect(await refused(controller.updateModule(5, { parentId: 1 }))).toEqual(new ConflictException('Ya existe un módulo con ese nombre en Ventas'));
    expect(await refused(controller.updateModule(5, { parentId: 1, name: 'Notas de crédito' }))).toEqual(
      new ConflictException('Ya existe un módulo con ese nombre en Ventas, pero está inactivo. Actívalo en Configuración > Módulos.'),
    );
    expect(await refused(controller.updateModule(3, { parentId: null }))).toBeUndefined();
    expect(await refused(controller.updateModule(5, { parentId: null }))).toEqual(new ConflictException('Ya existe un módulo principal con ese nombre'));
    expect(rows.find((each) => each.id === 5)).toMatchObject({ name: 'Facturas', parentId: 2 });
  });

  it('keeps its place and its name when the only module with them is itself', async () => {
    const { rows, controller } = setup();

    await controller.updateModule(3, { name: 'FACTURAS', parentId: 1 });

    expect(rows.find((each) => each.id === 3)).toMatchObject({ name: 'FACTURAS', nameKey: 'facturas', parentId: 1 });
  });

  it('passes on what is not a module with the same name in the same place', async () => {
    const { systemModule, controller } = setup();
    const other = uniqueViolation('SystemModule', 'id');
    systemModule.create.mockRejectedValueOnce(other);

    expect(await refused(controller.createModule({ name: 'Bodega' }))).toBe(other);
    expect(systemModule.findFirst).not.toHaveBeenCalled();
  });
});
