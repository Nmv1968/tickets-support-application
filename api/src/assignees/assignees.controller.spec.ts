import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma.service';
import { AssigneeInput, AssigneesController, meansNobody } from './assignees.controller';

interface Row {
  id: number;
  name: string;
  active: boolean;
  _count: { tickets: number };
}

describe('responsibles catalog', () => {
  const ana: Row = { id: 1, name: 'Ana', active: true, _count: { tickets: 3 } };
  const jose: Row = { id: 2, name: 'José Pérez', active: true, _count: { tickets: 0 } };
  const zoe: Row = { id: 3, name: 'Zoe', active: false, _count: { tickets: 1 } };

  /** The controller over a fake database that holds `rows` and records what is written to it. */
  const setup = (rows: Row[] = [zoe, jose, ana]) => {
    const table = [...rows];
    // The lock of the catalog as the database gives it: to one transaction at a time, until it ends.
    let lockFree: Promise<void> = Promise.resolve();
    const db = {
      $transaction: jest.fn((work: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
        let release = (): void => undefined;
        const $executeRaw = jest.fn(async (): Promise<void> => {
          const held = lockFree;
          lockFree = new Promise((resolve) => (release = resolve));
          await held;
        });
        return work({ ...db, $executeRaw }).finally(() => release());
      }),
      assignee: {
        // The name check reads the others: every row but the one being edited.
        findMany: jest.fn(({ where }: { where?: { id?: { not: number } } } = {}) => Promise.resolve(table.filter((row) => row.id !== where?.id?.not))),
        findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(table.find((row) => row.id === where.id) ?? null)),
        create: jest.fn(({ data }: { data: { name: string } }) => {
          const row = { id: 9 + table.length - rows.length, name: data.name, active: true, _count: { tickets: 0 } };
          table.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where, data }: { where: { id: number }; data: Partial<Row> }) =>
          Promise.resolve({ ...table.find((row) => row.id === where.id), ...JSON.parse(JSON.stringify(data)) }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    return { db, controller: new AssigneesController(db as unknown as PrismaService) };
  };

  it('lists everyone with the cases they have: the active first, then by name', async () => {
    expect(await setup().controller.list()).toEqual([
      { id: 1, name: 'Ana', active: true, tickets: 3 },
      { id: 2, name: 'José Pérez', active: true, tickets: 0 },
      { id: 3, name: 'Zoe', active: false, tickets: 1 },
    ]);
  });

  // The import asks this of the cells of its sheet, so that it never looks for a person called so, or adds one.
  it('tells the words that on a case mean nobody, however they are written, from a name', () => {
    expect(['ninguno', 'NINGUNO', ' Sin  asignar ', 'sin asignar'].map(meansNobody)).toEqual([true, true, true, true]);
    expect(['Cliente', 'Ana', 'Ninguna', ''].map(meansNobody)).toEqual([false, false, false, false]);
  });

  describe('a new responsible', () => {
    it('is a name, stored without the spaces around it or repeated inside', async () => {
      const { db, controller } = setup();

      expect(await controller.create({ name: '  Luis   Ñáñez ' })).toEqual({ id: 9, name: 'Luis Ñáñez', active: true, tickets: 0 });
      expect(db.assignee.create).toHaveBeenCalledWith({ data: { name: 'Luis Ñáñez' }, include: { _count: { select: { tickets: true } } } });
    });

    it.each([undefined, null, '', '   '])('needs a name: %p is refused', async (name) => {
      const { db, controller } = setup();

      await expect(controller.create({ name } as unknown as AssigneeInput)).rejects.toThrow('El nombre es obligatorio');
      expect(db.assignee.create).not.toHaveBeenCalled();
    });

    // The import and the assistants find a responsible by name, whatever its case or accents.
    it.each(['Ana', 'ANA', ' ana ', 'jose perez', 'JOSÉ  PÉREZ'])('cannot repeat a name: "%s" is already there', async (name) => {
      const { db, controller } = setup();

      const failure = await controller.create({ name }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', 'Ya existe un responsable con ese nombre');
      expect(db.assignee.create).not.toHaveBeenCalled();
    });

    // A deactivated responsible is in none of the lists that offer one. "Ya existe" alone would send the person looking for them in vain.
    it.each(['Zoe', ' ZOE '])('cannot repeat the name of a deactivated responsible, and says where to activate them ("%s")', async (name) => {
      const { db, controller } = setup();

      const failure = await controller.create({ name }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', 'Ya existe un responsable con ese nombre, pero está inactivo. Actívalo en Configuración > Responsables.');
      expect(db.assignee.create).not.toHaveBeenCalled();
    });

    // Each request asks whether the name is free before the other has added it, unless only one
    // at a time may ask and add.
    it('is added once when two requests bring the same new name at the same moment', async () => {
      const { db, controller } = setup();

      const answers = await Promise.allSettled([controller.create({ name: 'Luis Ñáñez' }), controller.create({ name: 'LUIS  NANEZ' })]);

      expect(db.assignee.create).toHaveBeenCalledTimes(1);
      expect(answers[0]).toEqual({ status: 'fulfilled', value: { id: 9, name: 'Luis Ñáñez', active: true, tickets: 0 } });
      expect(answers[1]).toMatchObject({ status: 'rejected', reason: { message: 'Ya existe un responsable con ese nombre' } });
      expect((answers[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    });

    // Both are how an assistant says that nobody is responsible for a case.
    it.each(['ninguno', 'NINGUNO', 'Sin  asignar'])('cannot be called "%s"', async (name) => {
      const { db, controller } = setup();

      await expect(controller.create({ name })).rejects.toThrow('no puede ser el nombre de un responsable');
      expect(db.assignee.create).not.toHaveBeenCalled();
    });

    // "Cliente" used to be an option built into every case. Now a team that wants it adds it here.
    it('can be called "Cliente", a name like any other', async () => {
      const { db, controller } = setup();

      expect(await controller.create({ name: 'Cliente' })).toEqual({ id: 9, name: 'Cliente', active: true, tickets: 0 });
      expect(db.assignee.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('an edit', () => {
    it('renames, also to its own name written another way', async () => {
      const { db, controller } = setup();

      expect(await controller.update(2, { name: 'Jose Perez' })).toMatchObject({ id: 2, name: 'Jose Perez', tickets: 0 });
      expect(db.assignee.update.mock.calls[0][0]).toMatchObject({ where: { id: 2 }, data: { name: 'Jose Perez' } });
    });

    it('cannot take the name of another responsible', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'ana' })).rejects.toThrow('Ya existe un responsable con ese nombre');
      expect(db.assignee.update).not.toHaveBeenCalled();
    });

    it('cannot take the name of a deactivated responsible either, and says where that one is', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'zoe' })).rejects.toThrow(
        'Ya existe un responsable con ese nombre, pero está inactivo. Actívalo en Configuración > Responsables.',
      );
      expect(db.assignee.update).not.toHaveBeenCalled();
    });

    it('deactivates and reactivates without touching the name', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { active: false })).toMatchObject({ id: 1, name: 'Ana', active: false, tickets: 3 });
      expect(db.assignee.update.mock.calls[0][0].data).toEqual({ name: undefined, active: false });
      // Nothing to compare the name with: the other rows are not read.
      expect(db.assignee.findMany).not.toHaveBeenCalled();
    });

    // The checks of the request body let a null through, and the database takes it in neither column.
    it('reads a null as "not sent"', async () => {
      const { db, controller } = setup();

      await controller.update(1, { name: null, active: null } as unknown as AssigneeInput);

      expect(db.assignee.update.mock.calls[0][0].data).toEqual({ name: undefined, active: undefined });
    });
  });

  describe('a delete', () => {
    it('removes a responsible without cases', async () => {
      const { db, controller } = setup();

      await controller.remove(2);

      expect(db.assignee.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    });

    // Deleting them would leave their cases without a responsible, and the history without the name.
    it.each([
      [1, 'Ana tiene 3 casos asignados.'],
      [3, 'Zoe tiene 1 caso asignado.'],
    ])('refuses one with cases, and says what to do instead (%d)', async (id, start) => {
      const { db, controller } = setup();

      const failure = await controller.remove(id).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', `${start} Desactívalo para que no aparezca en los casos nuevos, o reasigna sus casos antes de eliminarlo.`);
      expect(db.assignee.delete).not.toHaveBeenCalled();
    });

    it('answers 404 for a responsible that is not there', async () => {
      const { db, controller } = setup();

      await expect(controller.remove(99)).rejects.toBeInstanceOf(NotFoundException);
      expect(db.assignee.delete).not.toHaveBeenCalled();
    });
  });

  describe('the request body', () => {
    const errors = async (input: Record<string, unknown>): Promise<string[]> =>
      (await validate(plainToInstance(AssigneeInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

    it('accepts a name of up to 80 characters and says in Spanish when it is longer', async () => {
      expect(await errors({ name: 'a'.repeat(80) })).toEqual([]);
      expect(await errors({ name: 'a'.repeat(81) })).toEqual(['El nombre no puede tener más de 80 caracteres']);
    });

    it('refuses a name or a state of the wrong kind', async () => {
      expect(await errors({ name: 7 })).not.toEqual([]);
      expect(await errors({ active: 'no' })).not.toEqual([]);
    });
  });
});
