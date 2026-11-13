import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma.service';
import { SupportTypeInput, SupportTypesController } from './support-types.controller';

interface Row {
  id: number;
  name: string;
  color: string;
  active: boolean;
  _count: { tickets: number };
}

describe('support types catalog', () => {
  const training: Row = { id: 1, name: 'Capacitación', color: '#0c7beb', active: true, _count: { tickets: 3 } };
  const failure: Row = { id: 2, name: 'Falla del sistema', color: '#e5484d', active: true, _count: { tickets: 0 } };
  const other: Row = { id: 3, name: 'Otro', color: '#64748b', active: false, _count: { tickets: 1 } };
  const COLOR_REFUSED = 'El color debe ser un código hexadecimal como #1a2b3c';

  /** The controller over a fake database that holds `rows` and records what is written to it. */
  const setup = (rows: Row[] = [other, failure, training]) => {
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
      supportType: {
        // The name check reads the others: every row but the one being edited.
        findMany: jest.fn(({ where }: { where?: { id?: { not: number } } } = {}) => Promise.resolve(table.filter((row) => row.id !== where?.id?.not))),
        findUnique: jest.fn(({ where }: { where: { id: number } }) => Promise.resolve(table.find((row) => row.id === where.id) ?? null)),
        create: jest.fn(({ data }: { data: { name: string; color: string } }) => {
          const row = { id: 9 + table.length - rows.length, ...data, active: true, _count: { tickets: 0 } };
          table.push(row);
          return Promise.resolve(row);
        }),
        update: jest.fn(({ where, data }: { where: { id: number }; data: Partial<Row> }) =>
          Promise.resolve({ ...table.find((row) => row.id === where.id), ...JSON.parse(JSON.stringify(data)) }),
        ),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    return { db, controller: new SupportTypesController(db as unknown as PrismaService) };
  };

  it('lists every type with its colour and the cases that carry it: the active first, then by name', async () => {
    expect(await setup().controller.list()).toEqual([
      { id: 1, name: 'Capacitación', color: '#0c7beb', active: true, tickets: 3 },
      { id: 2, name: 'Falla del sistema', color: '#e5484d', active: true, tickets: 0 },
      { id: 3, name: 'Otro', color: '#64748b', active: false, tickets: 1 },
    ]);
  });

  describe('a new type', () => {
    it('is a name and a colour: the name without spare spaces, the colour in lowercase', async () => {
      const { db, controller } = setup();

      expect(await controller.create({ name: '  Error  de usuario ', color: '#1A2B3C' })).toEqual({
        id: 9,
        name: 'Error de usuario',
        color: '#1a2b3c',
        active: true,
        tickets: 0,
      });
      expect(db.supportType.create).toHaveBeenCalledWith({
        data: { name: 'Error de usuario', color: '#1a2b3c' },
        include: { _count: { select: { tickets: true } } },
      });
    });

    it.each([undefined, null, '', '   '])('needs a name: %p is refused', async (name) => {
      const { db, controller } = setup();

      await expect(controller.create({ name, color: '#1a2b3c' } as unknown as SupportTypeInput)).rejects.toThrow('El nombre es obligatorio');
      expect(db.supportType.create).not.toHaveBeenCalled();
    });

    // The label of a type is drawn in its colour, and there is no default one to fall back on.
    it.each([undefined, null, ''])('needs a colour: %p is refused', async (color) => {
      const { db, controller } = setup();

      const refused = await controller.create({ name: 'Error de usuario', color } as unknown as SupportTypeInput).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', COLOR_REFUSED);
      expect(db.supportType.create).not.toHaveBeenCalled();
    });

    // The import and the assistants find a type by name, whatever its case or accents.
    it.each(['Capacitación', 'CAPACITACION', ' capacitación ', 'falla  del sistema'])('cannot repeat a name: "%s" is already there', async (name) => {
      const { db, controller } = setup();

      const refused = await controller.create({ name, color: '#1a2b3c' }).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(ConflictException);
      expect(refused).toHaveProperty('message', 'Ya existe un tipo de soporte con ese nombre');
      expect(db.supportType.create).not.toHaveBeenCalled();
    });

    // A deactivated type is in none of the lists that offer one. "Ya existe" alone would send the person looking for it in vain.
    it.each(['Otro', ' OTRO '])('cannot repeat the name of a deactivated type, and says where to activate it ("%s")', async (name) => {
      const { db, controller } = setup();

      const refused = await controller.create({ name, color: '#1a2b3c' }).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(ConflictException);
      expect(refused).toHaveProperty('message', 'Ya existe un tipo de soporte con ese nombre, pero está inactivo. Actívalo en Configuración > Tipos de soporte.');
      expect(db.supportType.create).not.toHaveBeenCalled();
    });

    // Each request asks whether the name is free before the other has added it, unless only one
    // at a time may ask and add.
    it('is added once when two requests bring the same new name at the same moment', async () => {
      const { db, controller } = setup();

      const answers = await Promise.allSettled([controller.create({ name: 'Consulta', color: '#1a2b3c' }), controller.create({ name: 'CONSULTA', color: '#445566' })]);

      expect(db.supportType.create).toHaveBeenCalledTimes(1);
      expect(answers[0]).toEqual({ status: 'fulfilled', value: { id: 9, name: 'Consulta', color: '#1a2b3c', active: true, tickets: 0 } });
      expect(answers[1]).toMatchObject({ status: 'rejected', reason: { message: 'Ya existe un tipo de soporte con ese nombre' } });
      expect((answers[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
    });

    // The dashboard and its reports put the cases without a type in a row called "Sin tipo". A type
    // with that name would give them two rows with the same label and different counts.
    it.each(['Sin tipo', 'SIN TIPO', ' sin   tipo '])('cannot be called "%s": that is how the reports name the cases without a type', async (name) => {
      const { db, controller } = setup();

      const refused = await controller.create({ name, color: '#1a2b3c' }).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', `"${name.replace(/\s+/g, ' ').trim()}" no puede ser el nombre de un tipo de soporte: en los reportes ya significa que el caso no tiene ninguno`);
      expect(db.supportType.create).not.toHaveBeenCalled();
      expect(db.$transaction).not.toHaveBeenCalled();
    });

    it('can have a name that only starts or ends like it', async () => {
      const { db, controller } = setup();

      await controller.create({ name: 'Sin tipo definido', color: '#1a2b3c' });

      expect(db.supportType.create).toHaveBeenCalledTimes(1);
    });

    // Only the name tells two types apart: the colour is not checked against the others.
    it('can repeat the colour of another type', async () => {
      const { db, controller } = setup();

      await controller.create({ name: 'Error de usuario', color: '#0c7beb' });

      expect(db.supportType.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('an edit', () => {
    it('renames, also to its own name written another way', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { name: 'Capacitacion' })).toMatchObject({ id: 1, name: 'Capacitacion', color: '#0c7beb', tickets: 3 });
      expect(db.supportType.update.mock.calls[0][0]).toMatchObject({ where: { id: 1 }, data: { name: 'Capacitacion' } });
    });

    it('cannot take the name of another type', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'capacitacion' })).rejects.toThrow('Ya existe un tipo de soporte con ese nombre');
      expect(db.supportType.update).not.toHaveBeenCalled();
    });

    it('cannot take the name of a deactivated type either, and says where that one is', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'otro' })).rejects.toThrow(
        'Ya existe un tipo de soporte con ese nombre, pero está inactivo. Actívalo en Configuración > Tipos de soporte.',
      );
      expect(db.supportType.update).not.toHaveBeenCalled();
    });

    it('cannot be renamed "Sin tipo"', async () => {
      const { db, controller } = setup();

      const refused = await controller.update(2, { name: 'sin tipo' }).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', '"sin tipo" no puede ser el nombre de un tipo de soporte: en los reportes ya significa que el caso no tiene ninguno');
      expect(db.supportType.update).not.toHaveBeenCalled();
    });

    it('changes the colour, stored in lowercase, without touching the name', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { color: '#AABBCC' })).toMatchObject({ id: 1, name: 'Capacitación', color: '#aabbcc' });
      expect(db.supportType.update.mock.calls[0][0].data).toEqual({ name: undefined, color: '#aabbcc', active: undefined });
      // Nothing to compare the name with: the other rows are not read.
      expect(db.supportType.findMany).not.toHaveBeenCalled();
    });

    it('deactivates and reactivates without touching the name or the colour', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { active: false })).toMatchObject({ id: 1, name: 'Capacitación', color: '#0c7beb', active: false, tickets: 3 });
      expect(db.supportType.update.mock.calls[0][0].data).toEqual({ name: undefined, color: undefined, active: false });
    });

    // The checks of the request body let a null through, and the database takes it in none of the columns.
    it('reads a null as "not sent"', async () => {
      const { db, controller } = setup();

      await controller.update(1, { name: null, color: null, active: null } as unknown as SupportTypeInput);

      expect(db.supportType.update.mock.calls[0][0].data).toEqual({ name: undefined, color: undefined, active: undefined });
    });
  });

  describe('a delete', () => {
    it('removes a type no case carries', async () => {
      const { db, controller } = setup();

      await controller.remove(2);

      expect(db.supportType.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    });

    // Deleting it would take the label off those cases without anyone deciding so.
    it.each([
      [1, 'Capacitación está en 3 casos.'],
      [3, 'Otro está en 1 caso.'],
    ])('refuses one that cases carry, and says what to do instead (%d)', async (id, start) => {
      const { db, controller } = setup();

      const refused = await controller.remove(id).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(ConflictException);
      expect(refused).toHaveProperty(
        'message',
        `${start} Desactívalo para que no se ofrezca en los casos nuevos, o quítalo de esos casos antes de eliminarlo.`,
      );
      expect(db.supportType.delete).not.toHaveBeenCalled();
    });

    it('answers 404 for a type that is not there', async () => {
      const { db, controller } = setup();

      const refused = await controller.remove(99).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(NotFoundException);
      expect(refused).toHaveProperty('message', 'El tipo de soporte no existe');
      expect(db.supportType.delete).not.toHaveBeenCalled();
    });
  });

  describe('the request body', () => {
    const errors = async (input: Record<string, unknown>): Promise<string[]> =>
      (await validate(plainToInstance(SupportTypeInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

    it('accepts a name of up to 60 characters and says in Spanish when it is longer', async () => {
      expect(await errors({ name: 'a'.repeat(60) })).toEqual([]);
      expect(await errors({ name: 'a'.repeat(61) })).toEqual(['El nombre no puede tener más de 60 caracteres']);
    });

    it('accepts a colour written #rrggbb, in either case', async () => {
      for (const color of ['#1a2b3c', '#1A2B3C', '#000000', '#ffffff']) expect(await errors({ color })).toEqual([]);
    });

    it.each(['1a2b3c', '#1a2b3', '#1a2b3cd', '#1a2b3g', '#fff', 'rojo', 'rgb(1, 2, 3)', '', ' #1a2b3c', 0x1a2b3c])(
      'refuses %p as a colour, and says in Spanish how to write one',
      async (color) => {
        expect(await errors({ color })).toEqual([COLOR_REFUSED]);
      },
    );

    it('refuses a name or a state of the wrong kind', async () => {
      expect(await errors({ name: 7 })).not.toEqual([]);
      expect(await errors({ active: 'no' })).not.toEqual([]);
    });
  });
});
