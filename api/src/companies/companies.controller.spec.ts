import { ConflictException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { catalogTable, sqlText } from '../common/testing';
import type { PrismaService } from '../prisma.service';
import { CompaniesController } from './companies.controller';
import { CompaniesService, CompanyInput } from './companies.service';

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

  /**
   * The controller and its service over a fake database that holds `rows` and records what is
   * written to it. Its table of companies refuses a second company with the key of a name, as the
   * unique index of `sortKey` does.
   */
  const setup = (rows: Row[] = [zeta, nandu, acme], cases = acmeCases) => {
    const db = {
      // A list of queries run together: all of them, or none if one fails.
      $transaction: jest.fn((work: Promise<unknown>[]) => Promise.all(work)),
      // A statement written by hand: its text, with a ? for each value, and the values.
      $executeRaw: jest.fn<Promise<number>, [TemplateStringsArray, ...unknown[]]>(() => Promise.resolve(cases.length)),
      company: catalogTable('Company', 'sortKey', rows),
      ticket: {
        findMany: jest.fn(({ where }: { where: { companyId: number } }) => Promise.resolve(where.companyId === acme.id ? cases : [])),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    return { db, controller: new CompaniesController(new CompaniesService(db as unknown as PrismaService)) };
  };

  /** The statements written by hand, each one as its text with a ? for each value, and its values. */
  const statements = (db: ReturnType<typeof setup>['db']) =>
    db.$executeRaw.mock.calls.map(([sql, ...values]) => ({ sql: sqlText(sql), values }));

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
      // The database refused it: nothing was added.
      expect(db.company.rows).toHaveLength(3);
    });

    // A deactivated company is in none of the lists that offer one: the person types its name,
    // finds nothing and presses "Crear empresa". "Ya existe" alone would send them looking for it in vain.
    it.each(['Zeta', ' ZETA '])('cannot repeat the name of a deactivated company, and says where to activate it ("%s")', async (name) => {
      const { db, controller } = setup();

      const failure = await controller.create({ name }).catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(ConflictException);
      expect(failure).toHaveProperty('message', 'Ya existe una empresa con ese nombre, pero está inactiva. Actívala en Configuración > Empresas.');
      expect(db.company.rows).toHaveLength(3);
    });

    // "Crear empresa «X»" is one click on the screens that register a case: two people with a case
    // of the same new client, or one request sent twice, arrive together. The unique index lets
    // the first one in; the second is told the name is taken.
    it('is added once when two requests bring the same new name at the same moment', async () => {
      const { db, controller } = setup();

      const answers = await Promise.allSettled([controller.create({ name: 'Beta Sur' }), controller.create({ name: 'BETA  SUR' })]);

      expect(db.company.rows.map((row) => row.name)).toEqual(['Zeta', 'Corporación Ñandú', 'Acme', 'Beta Sur']);
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
      // One statement for all of them, with the key of each case, and only for the cases still of the company.
      expect(statements(db)).toEqual([
        {
          sql:
            'UPDATE "Ticket" SET "searchText" = renamed."searchText", "updatedAt" = now() AT TIME ZONE \'UTC\' ' +
            'FROM unnest(?::integer[], ?::text[]) AS renamed("id", "searchText") WHERE "Ticket"."id" = renamed."id" AND "Ticket"."companyId" = ?',
          values: [[7, 9], ['acme nandu s.a. no abre la facturacion', 'acme nandu s.a. no imprime'], 1],
        },
      ]);
      expect(db.ticket.update).not.toHaveBeenCalled();
      // The new name and the new keys are written together or not at all.
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    // It used to be one UPDATE per case, in one transaction: thousands for a client of years.
    it('rewrites the search keys of all the cases of a renamed company in one statement, however many they are', async () => {
      const many = Array.from({ length: 2500 }, (_, index) => ({ id: index + 1, description: `Caso ${index + 1}` }));
      const { db, controller } = setup(undefined, many);

      await controller.update(1, { name: 'ACME Global' });

      const [statement] = statements(db);
      expect(statements(db)).toHaveLength(1);
      expect(statement.values).toEqual([many.map((ticket) => ticket.id), many.map((ticket) => `acme global caso ${ticket.id}`), 1]);
      expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('writes nothing to the cases of a company that has none', async () => {
      const { db, controller } = setup();

      await controller.update(2, { name: 'Ñandú Express' });

      expect(db.$executeRaw).not.toHaveBeenCalled();
      expect(db.$transaction.mock.calls[0][0]).toHaveLength(1);
    });

    it('cannot take the name of another company', async () => {
      const { db, controller } = setup();

      await expect(controller.update(1, { name: 'corporacion nandu' })).rejects.toThrow(new ConflictException('Ya existe una empresa con ese nombre'));
      expect(db.company.rows.find((row) => row.id === 1)).toMatchObject({ name: 'Acme', sortKey: 'acme' });
      // The search keys of its cases went in the same transaction as the rename, which the
      // database refused: none of them was stored either.
      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.$transaction.mock.calls[0][0]).toHaveLength(2);
    });

    it('cannot take the name of a deactivated company either, and says where that one is', async () => {
      const { db, controller } = setup();

      await expect(controller.update(2, { name: 'zeta' })).rejects.toThrow(
        'Ya existe una empresa con ese nombre, pero está inactiva. Actívala en Configuración > Empresas.',
      );
      expect(db.company.rows.find((row) => row.id === 2)).toMatchObject({ name: 'Corporación Ñandú' });
    });

    // A rename used to be checked outside of any lock: two renames to the same new name at once
    // both found it free. The unique index lets only one of them in.
    it('gives a new name to one company only when two renames to it arrive together', async () => {
      const { db, controller } = setup();

      const answers = await Promise.allSettled([controller.update(2, { name: 'Beta Sur' }), controller.update(3, { name: 'BETA SUR' })]);

      expect(answers[0]).toMatchObject({ status: 'fulfilled', value: { id: 2, name: 'Beta Sur' } });
      expect(answers[1]).toMatchObject({ status: 'rejected', reason: new ConflictException('Ya existe una empresa con ese nombre') });
      expect(db.company.rows.map((row) => row.name)).toEqual(['Zeta', 'Beta Sur', 'Acme']);
    });

    // The database looks for the company before its name: there is no company to tell that the name is taken.
    it('answers 404 for a company that is not there, whatever name it is given', async () => {
      const { controller } = setup();

      for (const name of ['Empresa Libre', 'acme']) {
        await expect(controller.update(99, { name })).rejects.toMatchObject({ code: 'P2025' });
      }
    });

    it('deactivates and reactivates without touching the name, nor the cases', async () => {
      const { db, controller } = setup();

      expect(await controller.update(1, { active: false })).toMatchObject({ id: 1, name: 'Acme', active: false, tickets: 3 });
      expect(db.company.update.mock.calls[0][0].data).toEqual({ name: undefined, sortKey: undefined, active: false });
      // Nothing to compare the name with, and no search key to redo: neither the others nor the cases are read.
      expect(db.company.findMany).not.toHaveBeenCalled();
      expect(db.ticket.findMany).not.toHaveBeenCalled();
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    // The checks of the request body let a null through, and the database takes it in neither column.
    it('reads a null as "not sent"', async () => {
      const { db, controller } = setup();

      await controller.update(1, { name: null, active: null } as unknown as CompanyInput);

      expect(db.company.update.mock.calls[0][0].data).toEqual({ name: undefined, sortKey: undefined, active: undefined });
      expect(db.$executeRaw).not.toHaveBeenCalled();
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
