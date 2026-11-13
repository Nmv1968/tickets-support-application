import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { PrismaService } from '../prisma.service';
import { CompaniesController, CompanyInput } from './companies.controller';

interface Row {
  id: number;
  name: string;
  active: boolean;
  _count: { tickets: number };
}

describe('companies catalog', () => {
  const acme: Row = { id: 1, name: 'Acme', active: true, _count: { tickets: 3 } };
  const nandu: Row = { id: 2, name: 'Corporación Ñandú', active: true, _count: { tickets: 0 } };
  const zeta: Row = { id: 3, name: 'Zeta', active: false, _count: { tickets: 1 } };
  /** The cases of Acme, as a rename reads them. */
  const acmeCases = [
    { id: 7, description: 'No abre la Facturación' },
    { id: 9, description: 'No imprime' },
  ];

  /** The controller over a fake database that holds `rows` and records what is written to it. */
  const setup = (rows: Row[] = [zeta, nandu, acme]) => {
    const table = [...rows];
    // The lock of the catalog as the database gives it: to one transaction at a time, until it ends.
    let lockFree: Promise<void> = Promise.resolve();
    const db = {
      // Either a list of queries to run together, or work to do inside a transaction.
      $transaction: jest.fn(async (work: unknown[] | ((tx: unknown) => Promise<unknown>)): Promise<unknown> => {
        if (typeof work !== 'function') return Promise.all(work);
        let release = (): void => undefined;
        const $executeRaw = jest.fn(async (): Promise<void> => {
          const held = lockFree;
          lockFree = new Promise((resolve) => (release = resolve));
          await held;
        });
        return work({ ...db, $executeRaw }).finally(() => release());
      }),
      company: {
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
      ticket: {
        findMany: jest.fn(({ where }: { where: { companyId: number } }) => Promise.resolve(where.companyId === acme.id ? acmeCases : [])),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { db, controller: new CompaniesController(db as unknown as PrismaService) };
  };

  it('lists every company with the cases it has: the active first, then by name', async () => {
    expect(await setup().controller.list()).toEqual([
      { id: 1, name: 'Acme', active: true, tickets: 3 },
      { id: 2, name: 'Corporación Ñandú', active: true, tickets: 0 },
      { id: 3, name: 'Zeta', active: false, tickets: 1 },
    ]);
  });

  describe('a new company', () => {
    it('is a name, stored without the spaces around it or repeated inside', async () => {
      const { db, controller } = setup();

      expect(await controller.create({ name: '  Beta   Sur ' })).toEqual({ id: 9, name: 'Beta Sur', active: true, tickets: 0 });
      // With the key the list of cases orders the companies by.
      expect(db.company.create).toHaveBeenCalledWith({ data: { name: 'Beta Sur', sortKey: 'beta sur' }, include: { _count: { select: { tickets: true } } } });
    });

    it.each([undefined, null, '', '   '])('needs a name: %p is refused', async (name) => {
      const { db, controller } = setup();

      await expect(controller.create({ name } as unknown as CompanyInput)).rejects.toThrow('El nombre es obligatorio');
      expect(db.company.create).not.toHaveBeenCalled();
    });

    // The import and the assistants find a company by name, whatever its case or accents.
    it.each(['Acme', 'ACME', ' acme ', 'corporacion nandu', 'CORPORACIÓN  ÑANDÚ'])('cannot repeat a name: "%s" is already there', async (name) => {
      const { db, controller } = setup();

      const failure = await controller.create({ name }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', 'Ya existe una empresa con ese nombre');
      expect(db.company.create).not.toHaveBeenCalled();
    });

    // A deactivated company is in none of the lists that offer one: the person types its name,
    // finds nothing and presses "Crear empresa". "Ya existe" alone would send them looking for it in vain.
    it.each(['Zeta', ' ZETA '])('cannot repeat the name of a deactivated company, and says where to activate it ("%s")', async (name) => {
      const { db, controller } = setup();

      const failure = await controller.create({ name }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', 'Ya existe una empresa con ese nombre, pero está inactiva. Actívala en Configuración > Empresas.');
      expect(db.company.create).not.toHaveBeenCalled();
    });

    // "Crear empresa «X»" is one click on the screens that register a case: two people with a case
    // of the same new client, or one request sent twice, arrive together. Each asks whether the
    // name is free before the other has added it, unless only one at a time may ask and add.
    it('is added once when two requests bring the same new name at the same moment', async () => {
      const { db, controller } = setup();

      const answers = await Promise.allSettled([controller.create({ name: 'Beta Sur' }), controller.create({ name: 'BETA  SUR' })]);

      expect(db.company.create).toHaveBeenCalledTimes(1);
      expect(answers[0]).toEqual({ status: 'fulfilled', value: { id: 9, name: 'Beta Sur', active: true, tickets: 0 } });
      expect(answers[1]).toMatchObject({ status: 'rejected', reason: { message: 'Ya existe una empresa con ese nombre' } });
      expect((answers[1] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      // Two different names do not get in each other's way.
      const others = await Promise.all([controller.create({ name: 'Gamma' }), controller.create({ name: 'Delta' })]);
      expect(others.map((company) => company.name)).toEqual(['Gamma', 'Delta']);
    });
  });

  describe('an edit', () => {
    it('renames, also to its own name written another way', async () => {
      const { db, controller } = setup();

      expect(await controller.update(2, { name: 'Corporacion Nandu' })).toMatchObject({ id: 2, name: 'Corporacion Nandu', tickets: 0 });
      expect(db.company.update.mock.calls[0][0]).toMatchObject({ where: { id: 2 }, data: { name: 'Corporacion Nandu', sortKey: 'corporacion nandu' } });
    });

    // The list of cases orders by company by this key: left as it was, the company would keep the
    // place of its old name.
    it('gives a renamed company the order key of its new name', async () => {
      const { db, controller } = setup();

      await controller.update(1, { name: ' Óptica  del Sur ' });

      expect(db.company.update.mock.calls[0][0].data).toEqual({ name: 'Óptica del Sur', sortKey: 'optica del sur', active: undefined });
    });

    // The search box matches a key stored on each case, and that key starts with the company's name.
    it('gives the cases of a renamed company the search key of the new name, so the search box keeps finding them', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { name: ' Acme  Ñandú S.A. ' })).toMatchObject({ id: 1, name: 'Acme Ñandú S.A.', tickets: 3 });

      expect(db.ticket.findMany).toHaveBeenCalledWith({ where: { companyId: 1 }, select: { id: true, description: true } });
      expect(db.ticket.update.mock.calls.map(([query]: [{ where: { id: number }; data: object }]) => [query.where.id, query.data])).toEqual([
        [7, { searchText: 'acme nandu s.a. no abre la facturacion' }],
        [9, { searchText: 'acme nandu s.a. no imprime' }],
      ]);
      // The new name and the new keys are written together or not at all.
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0][0]).toHaveLength(3);
    });

    it('cannot take the name of another company', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'acme' })).rejects.toThrow('Ya existe una empresa con ese nombre');
      expect(db.company.update).not.toHaveBeenCalled();
      expect(db.ticket.update).not.toHaveBeenCalled();
    });

    it('cannot take the name of a deactivated company either, and says where that one is', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'zeta' })).rejects.toThrow(
        'Ya existe una empresa con ese nombre, pero está inactiva. Actívala en Configuración > Empresas.',
      );
      expect(db.company.update).not.toHaveBeenCalled();
    });

    it('deactivates and reactivates without touching the name, nor the cases', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { active: false })).toMatchObject({ id: 1, name: 'Acme', active: false, tickets: 3 });
      expect(db.company.update.mock.calls[0][0].data).toEqual({ name: undefined, sortKey: undefined, active: false });
      // Nothing to compare the name with, and no search key to redo: neither the others nor the cases are read.
      expect(db.company.findMany).not.toHaveBeenCalled();
      expect(db.ticket.findMany).not.toHaveBeenCalled();
      expect(db.ticket.update).not.toHaveBeenCalled();
    });

    // The checks of the request body let a null through, and the database takes it in neither column.
    it('reads a null as "not sent"', async () => {
      const { db, controller } = setup();

      await controller.update(1, { name: null, active: null } as unknown as CompanyInput);

      expect(db.company.update.mock.calls[0][0].data).toEqual({ name: undefined, sortKey: undefined, active: undefined });
      expect(db.ticket.update).not.toHaveBeenCalled();
    });
  });

  describe('a delete', () => {
    it('removes a company without cases', async () => {
      const { db, controller } = setup();

      await controller.remove(2);

      expect(db.company.delete).toHaveBeenCalledWith({ where: { id: 2 } });
    });

    // A case always has its company: deleting one with cases would leave them pointing at nothing.
    it.each([
      [1, 'Acme tiene 3 casos.'],
      [3, 'Zeta tiene 1 caso.'],
    ])('refuses one with cases, and says what to do instead (%d)', async (id, start) => {
      const { db, controller } = setup();

      const failure = await controller.remove(id).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty(
        'message',
        `${start} Desactívala para que no aparezca en los casos nuevos, o cambia la empresa de sus casos antes de eliminarla.`,
      );
      expect(db.company.delete).not.toHaveBeenCalled();
    });

    it('answers 404 for a company that is not there', async () => {
      const { db, controller } = setup();

      const failure = await controller.remove(99).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NotFoundException);
      expect(failure).toHaveProperty('message', 'La empresa no existe');
      expect(db.company.delete).not.toHaveBeenCalled();
    });
  });

  describe('the request body', () => {
    const errors = async (input: Record<string, unknown>): Promise<string[]> =>
      (await validate(plainToInstance(CompanyInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

    it('accepts a name of up to 200 characters and says in Spanish when it is longer', async () => {
      expect(await errors({ name: 'a'.repeat(200) })).toEqual([]);
      expect(await errors({ name: 'a'.repeat(201) })).toEqual(['El nombre no puede tener más de 200 caracteres']);
    });

    it('refuses a name or a state of the wrong kind', async () => {
      expect(await errors({ name: 7 })).not.toEqual([]);
      expect(await errors({ active: 'no' })).not.toEqual([]);
    });
  });
});
