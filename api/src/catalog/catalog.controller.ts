import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { Priority } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { AdminOnly } from '../common/auth';
import { IdPipe, MAX_ID } from '../common/id.pipe';
import { NO_MODULE, PRIORITIES, moduleFullName, searchKey } from '../common/labels';
import { PrismaService } from '../prisma.service';

// An id that no module can have. Passed on, the database rejects the number and the answer is a 500.
const noParent = { message: 'El módulo padre no existe' };

export class ModuleInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  /** Null makes it a top-level module. */
  @IsOptional() @IsInt() @Min(1, noParent) @Max(MAX_ID, noParent) parentId?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

class SlaItem {
  @IsEnum(Priority) priority!: Priority;
  @IsInt() @Min(1) @Max(24 * 365) hours!: number;
}

class SlaInput {
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => SlaItem) items!: SlaItem[];
}

export interface ModuleDto {
  id: number;
  name: string;
  parentId: number | null;
  active: boolean;
  /** "Parent > Child" for submodules. */
  fullName: string;
}

@Controller()
export class CatalogController {
  constructor(private readonly prisma: PrismaService) {}

  /** Active modules by default; `?all=1` also returns deactivated ones (for the settings screen). */
  @Get('modules')
  async modules(@Query('all') all?: string): Promise<ModuleDto[]> {
    const rows = await this.prisma.systemModule.findMany({ orderBy: { name: 'asc' } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rows
      .filter((r) => all === '1' || r.active)
      .map((r) => {
        const parent = r.parentId ? byId.get(r.parentId) : undefined;
        return { id: r.id, name: r.name, parentId: r.parentId, active: r.active, fullName: moduleFullName({ name: r.name, parent }) };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  }

  @Post('modules')
  async createModule(@Body() dto: ModuleInput): Promise<{ id: number }> {
    const name = usableName(dto.name);
    if (!name) throw new BadRequestException('El nombre es obligatorio');
    await this.assertValidParent(dto.parentId ?? null, null);
    const row = await this.prisma.systemModule.create({ data: { name, parentId: dto.parentId ?? null } });
    return { id: row.id };
  }

  @Patch('modules/:id')
  async updateModule(@Param('id', IdPipe) id: number, @Body() dto: ModuleInput): Promise<void> {
    const name = usableName(dto.name);
    if (dto.parentId !== undefined) await this.assertValidParent(dto.parentId, id);
    await this.prisma.systemModule.update({
      where: { id },
      // `@IsOptional()` lets a null through. `active` cannot be empty in the database, so for it null
      // means "not sent"; for `parentId` null is a real value: no parent.
      data: { name: name ?? undefined, parentId: dto.parentId, active: dto.active ?? undefined },
    });
  }

  @Get('sla')
  async sla(): Promise<{ priority: Priority; hours: number }[]> {
    const rows = await this.prisma.slaPolicy.findMany();
    return PRIORITIES.map((priority) => ({ priority, hours: rows.find((r) => r.priority === priority)?.hours ?? 0 }));
  }

  /** New hours apply to tickets created or re-prioritised from now on. */
  @AdminOnly()
  @Put('sla')
  async saveSla(@Body() dto: SlaInput): Promise<void> {
    await this.prisma.$transaction(
      dto.items.map((item) =>
        this.prisma.slaPolicy.upsert({
          where: { priority: item.priority },
          create: { priority: item.priority, hours: item.hours },
          update: { hours: item.hours },
        }),
      ),
    );
  }

  /** Only two levels: a submodule's parent must be a top-level module. */
  private async assertValidParent(parentId: number | null, selfId: number | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === selfId) throw new BadRequestException('Un módulo no puede ser su propio padre');
    const parent = await this.prisma.systemModule.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException('El módulo padre no existe');
    if (parent.parentId !== null) throw new BadRequestException('Solo se permiten dos niveles de módulos');
    if (selfId !== null && (await this.prisma.systemModule.count({ where: { parentId: selfId } })) > 0) {
      throw new BadRequestException('Este módulo tiene submódulos; no puede convertirse en submódulo');
    }
  }
}

/**
 * The name of a module as it will be stored. Null when none was sent. The words the reports use
 * for the cases without a module are refused, however they are written.
 */
function usableName(sent: string | null | undefined): string | null {
  const name = sent?.trim();
  if (!name) return null;
  if (searchKey(name) === searchKey(NO_MODULE)) {
    throw new BadRequestException(`"${name}" no puede ser el nombre de un módulo: en los reportes ya significa que el caso no tiene ninguno`);
  }
  return name;
}
