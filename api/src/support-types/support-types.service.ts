import { BadRequestException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { NO_SUPPORT_TYPE, searchKey } from '../common/labels';
import { NamedCatalogService, entryDto, labelOfNone, namedTable } from '../common/named-catalog';
import type { CountedEntry, NamedCatalogRules, NamedEntryDto } from '../common/named-catalog';
import { tooLong } from '../common/validation';
import { PrismaService } from '../prisma.service';

export const SUPPORT_TYPE_NAME_MAX = 60;

/** "Sin tipo", the name of the cases without a support type: no type can be called so. */
const NO_TYPE = labelOfNone(NO_SUPPORT_TYPE, 'un tipo de soporte');

/** True for the words that name the cases without a support type, however they are written. No type can be called so. */
export const meansNoType = NO_TYPE.means;

const COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_MESSAGE = 'El color debe ser un código hexadecimal como #1a2b3c';

/** Used for both create and update. Create additionally requires the name and the colour. */
export class SupportTypeInput {
  @IsOptional()
  @IsString()
  @MaxLength(SUPPORT_TYPE_NAME_MAX, tooLong('El nombre', SUPPORT_TYPE_NAME_MAX))
  name?: string;

  /** `#rrggbb`. Capitals are accepted and stored in lowercase. */
  @IsOptional() @Matches(COLOR, { message: COLOR_MESSAGE }) color?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

export interface SupportTypeDto extends NamedEntryDto {
  /** `#rrggbb`, in lowercase. */
  color: string;
}

/**
 * "Tipos de soporte": the labels a case can carry to say what kind of support it was (a failure
 * of the system, the user did not know how...). A catalog of names, each with the colour its
 * label is shown in. A case has zero or more.
 */
export const SUPPORT_TYPES = {
  table: (db) => namedTable(db.supportType),
  key: 'nameKey',
  // The label of a type is drawn in its colour, and there is no default one to fall back on.
  newEntry: (name: string, input: SupportTypeInput): Prisma.SupportTypeCreateManyInput => {
    const color = input.color?.toLowerCase();
    if (!color) throw new BadRequestException(COLOR_MESSAGE);
    return { name, nameKey: searchKey(name), color };
  },
  // Only the name tells two types apart: the colour is not checked against the others.
  edit: (name: string | null, input: SupportTypeInput): Prisma.SupportTypeUpdateInput => ({
    nameKey: name === null ? undefined : searchKey(name),
    color: input.color?.toLowerCase(),
  }),
  toDto: (row: CountedEntry & { color: string }): SupportTypeDto => entryDto(row, { color: row.color }),
  reserved: NO_TYPE,
  messages: {
    missing: 'El tipo de soporte no existe',
    taken: 'Ya existe un tipo de soporte con ese nombre',
    takenInactive: 'Ya existe un tipo de soporte con ese nombre, pero está inactivo. Actívalo en Configuración > Tipos de soporte.',
    // Deleting it would quietly take the label off those cases.
    inUse: (name: string, cases: number) =>
      `${name} está en ${cases} ${cases === 1 ? 'caso' : 'casos'}. ` +
      'Desactívalo para que no se ofrezca en los casos nuevos, o quítalo de esos casos antes de eliminarlo.',
  },
} satisfies NamedCatalogRules<CountedEntry & { color: string }, SupportTypeDto, SupportTypeInput>;

@Injectable()
export class SupportTypesService extends NamedCatalogService<CountedEntry & { color: string }, SupportTypeDto, SupportTypeInput> {
  constructor(prisma: PrismaService) {
    super(prisma, SUPPORT_TYPES);
  }
}
