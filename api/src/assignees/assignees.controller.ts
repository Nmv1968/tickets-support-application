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
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
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
 * the import and the assistants read "Cliente" as the client, and "ninguno" as nobody.
 */
const RESERVED = new Set(['cliente', 'ninguno', 'sin asignar']);

const withCount = { _count: { select: { tickets: true } } } as const;

function toDto(row: { id: number; name: string; active: boolean; _count: { tickets: number } }): AssigneeDto {
  return { id: row.id, name: row.name, active: row.active, tickets: row._count.tickets };
}

/**
 * The people a case can be assigned to. A catalog of names: a responsible need not be a user of
 * the app, and a user is a responsible only when linked to one (see `User.assigneeId`).
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
    const name = await this.usableName(dto.name, null);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    return toDto(await this.prisma.assignee.create({ data: { name }, include: withCount }));
  }

  @Patch(':id')
  async update(@Param('id', IdPipe) id: number, @Body() dto: AssigneeInput): Promise<AssigneeDto> {
    const name = await this.usableName(dto.name, id);
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

  /**
   * The name as it will be stored, or null when none was sent. Two responsibles cannot differ only
   * in case or accents: the import and the assistants find them by name.
   */
  private async usableName(sent: string | null | undefined, selfId: number | null): Promise<string | null> {
    const name = sent?.replace(/\s+/g, ' ').trim();
    if (!name) return null;
    const key = searchKey(name);
    if (RESERVED.has(key)) {
      throw new BadRequestException(`"${name}" no puede ser el nombre de un responsable: en un caso ya significa otra cosa`);
    }
    const others = await this.prisma.assignee.findMany({ where: selfId === null ? undefined : { id: { not: selfId } }, select: { name: true } });
    if (others.some((other) => searchKey(other.name) === key)) {
      throw new ConflictException('Ya existe un responsable con ese nombre');
    }
    return name;
  }
}
