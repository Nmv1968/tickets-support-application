import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { withCatalogLock } from '../common/catalog-lock';
import { IdPipe } from '../common/id.pipe';
import { NO_SUPPORT_TYPE, searchKey } from '../common/labels';
import { PrismaService } from '../prisma.service';

export const SUPPORT_TYPE_NAME_MAX = 60;

/** True for the words that name the cases without a support type, however they are written. No type can be called so. */
export function meansNoType(name: string): boolean {
  return searchKey(name) === searchKey(NO_SUPPORT_TYPE);
}

const COLOR = /^#[0-9a-fA-F]{6}$/;
const COLOR_MESSAGE = 'El color debe ser un código hexadecimal como #1a2b3c';

/** Used for both create and update. Create additionally requires the name and the colour. */
export class SupportTypeInput {
  @IsOptional()
  @IsString()
  @MaxLength(SUPPORT_TYPE_NAME_MAX, { message: `El nombre no puede tener más de ${SUPPORT_TYPE_NAME_MAX} caracteres` })
  name?: string;

  /** `#rrggbb`. Capitals are accepted and stored in lowercase. */
  @IsOptional() @Matches(COLOR, { message: COLOR_MESSAGE }) color?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

export interface SupportTypeDto {
  id: number;
  name: string;
  /** `#rrggbb`, in lowercase. */
  color: string;
  /** False keeps it on the cases that carry it and stops offering it for new ones. */
  active: boolean;
  /** Cases that carry it, open or closed. With any, the type cannot be deleted. */
  tickets: number;
}

const withCount = { _count: { select: { tickets: true } } } as const;

function toDto(row: { id: number; name: string; color: string; active: boolean; _count: { tickets: number } }): SupportTypeDto {
  return { id: row.id, name: row.name, color: row.color, active: row.active, tickets: row._count.tickets };
}

/**
 * "Tipos de soporte": the labels a case can carry to say what kind of support it was (a failure
 * of the system, the user did not know how...). A catalog of names, each with the colour its
 * label is shown in. A case has zero or more.
 */
@Controller('support-types')
export class SupportTypesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Every type, active first. The screens that label a case offer the active ones. */
  @Get()
  async list(): Promise<SupportTypeDto[]> {
    const rows = await this.prisma.supportType.findMany({ include: withCount });
    return rows.map(toDto).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));
  }

  @Post()
  async create(@Body() dto: SupportTypeInput): Promise<SupportTypeDto> {
    const name = usableName(dto.name);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    const color = dto.color?.toLowerCase();
    if (!color) throw new BadRequestException(COLOR_MESSAGE);
    // Asking whether the name is free and adding it is done by one request at a time: two that
    // arrive together with the same new name would both find it free.
    return withCatalogLock(this.prisma, 'supportTypes', async (tx) => {
      await assertNameFree(tx, name, null);
      return toDto(await tx.supportType.create({ data: { name, color }, include: withCount }));
    });
  }

  @Patch(':id')
  async update(@Param('id', IdPipe) id: number, @Body() dto: SupportTypeInput): Promise<SupportTypeDto> {
    const name = usableName(dto.name);
    if (name !== null) await assertNameFree(this.prisma, name, id);
    const row = await this.prisma.supportType.update({
      where: { id },
      // `@IsOptional()` lets a null through, and none of the columns can be empty: null means "not sent".
      data: { name: name ?? undefined, color: dto.color?.toLowerCase(), active: dto.active ?? undefined },
      include: withCount,
    });
    return toDto(row);
  }

  /** Only a type no case carries: deleting it must not quietly take the label off those cases. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', IdPipe) id: number): Promise<void> {
    const row = await this.prisma.supportType.findUnique({ where: { id }, include: withCount });
    if (!row) throw new NotFoundException('El tipo de soporte no existe');
    const cases = row._count.tickets;
    if (cases > 0) {
      throw new ConflictException(
        `${row.name} está en ${cases} ${cases === 1 ? 'caso' : 'casos'}. ` +
          'Desactívalo para que no se ofrezca en los casos nuevos, o quítalo de esos casos antes de eliminarlo.',
      );
    }
    await this.prisma.supportType.delete({ where: { id } });
  }
}

/**
 * The name as it will be stored: without spaces around it or repeated inside. Null when none was
 * sent. The words the reports use for the cases without a type are refused.
 */
function usableName(sent: string | null | undefined): string | null {
  const name = sent?.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (meansNoType(name)) {
    throw new BadRequestException(`"${name}" no puede ser el nombre de un tipo de soporte: en los reportes ya significa que el caso no tiene ninguno`);
  }
  return name;
}

/**
 * Refuses a name that another type has. Two types cannot differ only in case or accents: the
 * import and the assistants find them by name. `db` is where the others are read: for a new type,
 * the transaction that holds the lock of the catalog.
 */
async function assertNameFree(db: Prisma.TransactionClient, name: string, selfId: number | null): Promise<void> {
  const key = searchKey(name);
  const others = await db.supportType.findMany({ where: selfId === null ? undefined : { id: { not: selfId } }, select: { name: true, active: true } });
  const taken = others.find((other) => searchKey(other.name) === key);
  if (!taken) return;
  // A deactivated type is in none of the lists that offer one: whoever looks for the name finds
  // nothing, tries to add it and has to be told where it is.
  throw new ConflictException(`Ya existe un tipo de soporte con ese nombre${taken.active ? '' : ', pero está inactivo. Actívalo en Configuración > Tipos de soporte.'}`);
}
