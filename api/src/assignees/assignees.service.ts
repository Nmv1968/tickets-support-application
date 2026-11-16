import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { searchKey } from '../common/labels';
import { NamedCatalogService, entryDto, namedTable } from '../common/named-catalog';
import type { CountedEntry, NamedCatalogRules, NamedEntryDto } from '../common/named-catalog';
import { tooLong } from '../common/validation';
import { PrismaService } from '../prisma.service';

export const ASSIGNEE_NAME_MAX = 80;

/** Used for both create and update. Create additionally requires the name. */
export class AssigneeInput {
  @IsOptional()
  @IsString()
  @MaxLength(ASSIGNEE_NAME_MAX, tooLong('El nombre', ASSIGNEE_NAME_MAX))
  name?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

/** A responsible, with the number of the cases assigned to them. */
export type AssigneeDto = NamedEntryDto;

/**
 * Words the "Responsable" of a case already uses for something else, as `searchKey` leaves them:
 * the assistants read both as nobody.
 */
const RESERVED = new Set(['ninguno', 'sin asignar']);

/** True for a word that, written as the responsible of a case, means that it has none. */
export function meansNobody(name: string): boolean {
  return RESERVED.has(searchKey(name));
}

/**
 * The people a case can be assigned to. A catalog of names, apart from the users of the app: a
 * responsible does not log in, and a user is not a responsible. "Cliente" is one more name here,
 * for the teams that leave cases in the hands of the client.
 */
export const ASSIGNEES = {
  table: (db) => namedTable(db.assignee),
  key: 'nameKey',
  // A name is all a responsible has, with its key.
  newEntry: (name: string): Prisma.AssigneeCreateManyInput => ({ name, nameKey: searchKey(name) }),
  edit: (name: string | null): Prisma.AssigneeUpdateInput => ({ nameKey: name === null ? undefined : searchKey(name) }),
  toDto: (row: CountedEntry): AssigneeDto => entryDto(row),
  reserved: { means: meansNobody, refusal: (name: string) => `"${name}" no puede ser el nombre de un responsable: en un caso ya significa otra cosa` },
  messages: {
    missing: 'El responsable no existe',
    taken: 'Ya existe un responsable con ese nombre',
    takenInactive: 'Ya existe un responsable con ese nombre, pero está inactivo. Actívalo en Configuración > Responsables.',
    inUse: (name: string, cases: number) =>
      `${name} tiene ${cases} ${cases === 1 ? 'caso asignado' : 'casos asignados'}. ` +
      'Desactívalo para que no aparezca en los casos nuevos, o reasigna sus casos antes de eliminarlo.',
  },
} satisfies NamedCatalogRules<CountedEntry, AssigneeDto, AssigneeInput>;

@Injectable()
export class AssigneesService extends NamedCatalogService<CountedEntry, AssigneeDto, AssigneeInput> {
  constructor(prisma: PrismaService) {
    super(prisma, ASSIGNEES);
  }
}
