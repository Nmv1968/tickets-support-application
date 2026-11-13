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
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { withCatalogLock } from '../common/catalog-lock';
import { IdPipe } from '../common/id.pipe';
import { searchKey } from '../common/labels';
import { PrismaService } from '../prisma.service';

export const ASSIGNEE_NAME_MAX = 80;

/** Used for both create and update. Create additionally requires the name. */
export class AssigneeInput {
  @IsOptional()
  @IsString()
  @MaxLength(ASSIGNEE_NAME_MAX, { message: `El nombre no puede tener más de ${ASSIGNEE_NAME_MAX} caracteres` })
  name?: string;

  @IsOptional() @IsBoolean() active?: boolean;
}

export interface AssigneeDto {
  id: number;
  name: string;
  /** False keeps the cases they have and takes them out of the lists for new ones. */
  active: boolean;
  /** Cases assigned to them, open or closed. With any, the responsible cannot be deleted. */
  tickets: number;
}

/**
 * Words the "Responsable" of a case already uses for something else, as `searchKey` leaves them:
 * the assistants read both as nobody.
 */
const RESERVED = new Set(['ninguno', 'sin asignar']);

/** True for a word that, written as the responsible of a case, means that it has none. */
export function meansNobody(name: string): boolean {
  return RESERVED.has(searchKey(name));
}

const withCount = { _count: { select: { tickets: true } } } as const;

function toDto(row: { id: number; name: string; active: boolean; _count: { tickets: number } }): AssigneeDto {
  return { id: row.id, name: row.name, active: row.active, tickets: row._count.tickets };
}

/**
 * The people a case can be assigned to. A catalog of names, apart from the users of the app: a
 * responsible does not log in, and a user is not a responsible. "Cliente" is one more name here,
 * for the teams that leave cases in the hands of the client.
 */
@Controller('assignees')
export class AssigneesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Everyone, active first. The screens that assign a case offer the active ones. */
  @Get()
  async list(): Promise<AssigneeDto[]> {
    const rows = await this.prisma.assignee.findMany({ include: withCount });
    return rows.map(toDto).sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es'));
  }

  @Post()
  async create(@Body() dto: AssigneeInput): Promise<AssigneeDto> {
    const name = usableName(dto.name);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    // Asking whether the name is free and adding it is done by one request at a time: two that
    // arrive together with the same new name would both find it free.
    return withCatalogLock(this.prisma, 'assignees', async (tx) => {
      await assertNameFree(tx, name, null);
      return toDto(await tx.assignee.create({ data: { name }, include: withCount }));
    });
  }

  @Patch(':id')
  async update(@Param('id', IdPipe) id: number, @Body() dto: AssigneeInput): Promise<AssigneeDto> {
    const name = usableName(dto.name);
    if (name !== null) await assertNameFree(this.prisma, name, id);
    const row = await this.prisma.assignee.update({
      where: { id },
      // `@IsOptional()` lets a null through, and neither column can be empty: null means "not sent".
      data: { name: name ?? undefined, active: dto.active ?? undefined },
      include: withCount,
    });
    return toDto(row);
  }

  /** Only someone without cases: deleting a responsible must not leave their cases without one. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', IdPipe) id: number): Promise<void> {
    const row = await this.prisma.assignee.findUnique({ where: { id }, include: withCount });
    if (!row) throw new NotFoundException('El responsable no existe');
    const cases = row._count.tickets;
    if (cases > 0) {
      throw new ConflictException(
        `${row.name} tiene ${cases} ${cases === 1 ? 'caso asignado' : 'casos asignados'}. ` +
          'Desactívalo para que no aparezca en los casos nuevos, o reasigna sus casos antes de eliminarlo.',
      );
    }
    await this.prisma.assignee.delete({ where: { id } });
  }
}

/**
 * The name as it will be stored: without spaces around it or repeated inside. Null when none was
 * sent. A word that on a case means nobody is refused.
 */
function usableName(sent: string | null | undefined): string | null {
  const name = sent?.replace(/\s+/g, ' ').trim();
  if (!name) return null;
  if (meansNobody(name)) {
    throw new BadRequestException(`"${name}" no puede ser el nombre de un responsable: en un caso ya significa otra cosa`);
  }
  return name;
}

/**
 * Refuses a name that another responsible has. Two responsibles cannot differ only in case or
 * accents: the import and the assistants find them by name. `db` is where the others are read:
 * for a new responsible, the transaction that holds the lock of the catalog.
 */
async function assertNameFree(db: Prisma.TransactionClient, name: string, selfId: number | null): Promise<void> {
  const key = searchKey(name);
  const others = await db.assignee.findMany({ where: selfId === null ? undefined : { id: { not: selfId } }, select: { name: true, active: true } });
  const taken = others.find((other) => searchKey(other.name) === key);
  if (!taken) return;
  // A deactivated responsible is in none of the lists that offer one: whoever looks for the name
  // finds nothing, tries to add it and has to be told where it is.
  throw new ConflictException(`Ya existe un responsable con ese nombre${taken.active ? '' : ', pero está inactivo. Actívalo en Configuración > Responsables.'}`);
}
