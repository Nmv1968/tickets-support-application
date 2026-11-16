import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ASSIGNEES } from '../assignees/assignees.service';
import type { PrismaService } from '../prisma.service';
import { NamedCatalogService, entryDto, labelOfNone, requiredName, tidyName, usableName } from './named-catalog';
import { uniqueViolation } from './testing';

// What the catalogs share. The routes of `NamedCatalogService` are gone through by the specs of
// the companies, the responsibles and the support types, each with its own rules; here is what
// does not depend on them.

describe('a name of a catalog', () => {
  const NONE = labelOfNone('Sin tipo', 'un tipo de soporte');

  it('is stored without spaces around it, and with single spaces inside', () => {
    expect(tidyName('  Beta \t  Sur\n')).toBe('Beta Sur');
    expect(usableName('  Beta   Sur ')).toBe('Beta Sur');
  });

  // `@IsOptional()` lets a null through, and a name cannot be empty.
  it.each([undefined, null, '', '   '])('reads %p as not sent', (sent) => {
    expect(usableName(sent)).toBeNull();
  });

  it('is required for a new entry, in Spanish', () => {
    expect(() => requiredName('   ')).toThrow(BadRequestException);
    expect(() => requiredName(null)).toThrow('El nombre es obligatorio');
  });

  // The label the reports give the cases without an entry, however it is written: the refusal quotes the name as it would be stored.
  it.each(['Sin tipo', 'SIN  TIPO', ' sin tipo '])('cannot be the label of the cases without one ("%s")', (sent) => {
    expect(() => usableName(sent, NONE)).toThrow(new BadRequestException(`"${tidyName(sent)}" no puede ser el nombre de un tipo de soporte: en los reportes ya significa que el caso no tiene ninguno`));
    expect(() => requiredName(sent, NONE)).toThrow(BadRequestException);
  });

  it('can start or end like that label', () => {
    expect(usableName('Sin tipo definido', NONE)).toBe('Sin tipo definido');
    expect(NONE.means('Sin tipos')).toBe(false);
  });

  // The modules keep the spaces inside their names as they were sent.
  it('is tidied the way the catalog says', () => {
    const trimmed = (text: string): string => text.trim();

    expect(usableName('  Notas  de crédito ', NONE, trimmed)).toBe('Notas  de crédito');
    expect(requiredName(' Ventas ', undefined, trimmed)).toBe('Ventas');
  });
});

describe('an entry as the API answers it', () => {
  const row = { id: 3, name: 'Acme', active: false, _count: { tickets: 2 } };

  // The answers of the catalogs keep the order of their fields of before: the clients see the same text.
  it('has its fields in the order the API has always given them', () => {
    expect(JSON.stringify(entryDto(row))).toBe('{"id":3,"name":"Acme","active":false,"tickets":2}');
  });

  it('puts the fields of its own of a catalog after the name', () => {
    expect(JSON.stringify(entryDto(row, { color: '#1a2b3c' }))).toBe('{"id":3,"name":"Acme","color":"#1a2b3c","active":false,"tickets":2}');
  });
});

// The specs of each catalog go through a fake table with the unique index of its key. These are
// the refusals of the database that are not the one of the name.
describe('a write the database refuses', () => {
  const failing = (error: unknown) => {
    const assignee = {
      create: jest.fn().mockRejectedValue(error),
      update: jest.fn().mockRejectedValue(error),
      findUnique: jest.fn().mockResolvedValue({ active: false }),
    };
    return { assignee, catalog: new NamedCatalogService({ assignee } as unknown as PrismaService, ASSIGNEES) };
  };
  const known = (code: string, target: string[]): Prisma.PrismaClientKnownRequestError =>
    new Prisma.PrismaClientKnownRequestError('refused', { code, clientVersion: Prisma.prismaVersion.client, meta: { target } });

  it('is told apart by the index of the key of the name, which it reads the other entry by', async () => {
    const { assignee, catalog } = failing(uniqueViolation('Assignee', 'nameKey'));

    await expect(catalog.create({ name: ' Ana  Pérez ' })).rejects.toThrow(new ConflictException(ASSIGNEES.messages.takenInactive));
    expect(assignee.findUnique).toHaveBeenCalledWith({ where: { nameKey: 'ana perez' }, select: { active: true } });
  });

  // Gone between the refusal and the reading (deleted meanwhile): it was there, and it was taken.
  it('says the name is taken when the other entry cannot be read any more', async () => {
    const { assignee, catalog } = failing(uniqueViolation('Assignee', 'nameKey'));
    assignee.findUnique.mockResolvedValue(null);

    await expect(catalog.update(4, { name: 'Ana' })).rejects.toThrow(new ConflictException(ASSIGNEES.messages.taken));
  });

  it.each([
    ['another unique index', known('P2002', ['email'])],
    ['a missing row', known('P2025', [])],
    ['an error that is not of Prisma', new Error('connection lost')],
  ])('passes %s on as it is, for the filter of Prisma errors or as a 500', async (_what, error) => {
    const { assignee, catalog } = failing(error);

    await expect(catalog.create({ name: 'Ana' })).rejects.toBe(error);
    await expect(catalog.update(4, { name: 'Ana' })).rejects.toBe(error);
    expect(assignee.findUnique).not.toHaveBeenCalled();
  });

  // A write that changes no name cannot repeat one.
  it('is not taken for a repeated name when the edit sends no name', async () => {
    const refusal = uniqueViolation('Assignee', 'nameKey');
    const { catalog } = failing(refusal);

    await expect(catalog.update(4, { active: false })).rejects.toBe(refusal);
  });
});
