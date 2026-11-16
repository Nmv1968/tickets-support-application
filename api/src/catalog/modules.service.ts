import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { MAX_ID } from '../common/id.pipe';
import { NO_MODULE, moduleFullName, searchKey } from '../common/labels';
import { labelOfNone, requiredName, usableName } from '../common/named-catalog';
import { violatesUnique } from '../common/prisma-exception.filter';
import { PrismaService } from '../prisma.service';

export const MODULE_NAME_MAX = 80;

// An id that no module can have. Passed on, the database rejects the number and the answer is a 500.
const noParent = { message: 'El módulo padre no existe' };

export class ModuleInput {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(MODULE_NAME_MAX) name?: string;
  /** Null makes it a top-level module. */
  @IsOptional() @IsInt() @Min(1, noParent) @Max(MAX_ID, noParent) parentId?: number | null;
  @IsOptional() @IsBoolean() active?: boolean;
}

export interface ModuleDto {
  id: number;
  name: string;
  parentId: number | null;
  active: boolean;
  /** "Parent > Child" for submodules. */
  fullName: string;
}

/** "Sin módulo", the name of the cases without a module: no module can be called so. */
const NO_MODULE_NAME = labelOfNone(NO_MODULE, 'un módulo');

/** The name of a module is stored as it was sent, without the spaces around it only. */
const trimmed = (text: string): string => text.trim();

/**
 * The 409 of a name that another module has in the same place: among the submodules of one
 * module, or among the main modules. `taken` is that module, with its parent; null if it could
 * not be read.
 */
export function moduleNameTaken(taken: { active: boolean; parent: { name: string } | null } | null): string {
  if (!taken) return 'Ya existe un módulo con ese nombre en ese lugar';
  const where = taken.parent ? `Ya existe un módulo con ese nombre en ${taken.parent.name}` : 'Ya existe un módulo principal con ese nombre';
  // A deactivated module is in none of the lists that offer one: whoever looks for it finds nothing.
  return taken.active ? where : `${where}, pero está inactivo. Actívalo en Configuración > Módulos.`;
}

/** The modules of the system a case is about, in two levels: "Ventas", and "Ventas > Facturas". */
@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  /** The active modules, or all of them (for the settings screen), by full name. */
  async list(all: boolean): Promise<ModuleDto[]> {
    const rows = await this.prisma.systemModule.findMany({ orderBy: { name: 'asc' } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    return rows
      .filter((r) => all || r.active)
      .map((r) => {
        const parent = r.parentId ? byId.get(r.parentId) : undefined;
        return { id: r.id, name: r.name, parentId: r.parentId, active: r.active, fullName: moduleFullName({ name: r.name, parent }) };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'));
  }

  async create(dto: ModuleInput): Promise<{ id: number }> {
    const name = requiredName(dto.name, NO_MODULE_NAME, trimmed);
    const parentId = dto.parentId ?? null;
    await this.assertValidParent(parentId, null);
    const nameKey = searchKey(name);
    const row = await this.unlessTaken({ id: null, parentId, nameKey }, () => this.prisma.systemModule.create({ data: { name, nameKey, parentId } }));
    return { id: row.id };
  }

  /** A rename, a move to another place, or both, can meet a module with the same name there. */
  async update(id: number, dto: ModuleInput): Promise<void> {
    const name = usableName(dto.name, NO_MODULE_NAME, trimmed);
    if (dto.parentId !== undefined) await this.assertValidParent(dto.parentId, id);
    const nameKey = name === null ? undefined : searchKey(name);
    await this.unlessTaken({ id, parentId: dto.parentId, nameKey }, () =>
      this.prisma.systemModule.update({
        where: { id },
        // `@IsOptional()` lets a null through. `active` cannot be empty in the database, so for it null
        // means "not sent"; for `parentId` null is a real value: no parent.
        data: { name: name ?? undefined, nameKey, parentId: dto.parentId, active: dto.active ?? undefined },
      }),
    );
  }

  /**
   * Does `write`, which gives a module (`wanted.id`, null for a new one) a place and the key of its
   * name: those of `wanted`, or the ones it has for what `wanted` leaves out. Two modules with the
   * same name in the same place, however it is written (`searchKey`), are refused by the unique
   * index of the table, and the answer says where the other one is.
   */
  private async unlessTaken<T>(wanted: { id: number | null; parentId?: number | null; nameKey?: string }, write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (error) {
      if (!violatesUnique(error, 'parentId', 'nameKey')) throw error;
      // The write was refused: the module still has what it had.
      const own = wanted.id === null ? null : await this.prisma.systemModule.findUnique({ where: { id: wanted.id }, select: { parentId: true, nameKey: true } });
      const taken = await this.prisma.systemModule.findFirst({
        where: {
          parentId: wanted.parentId === undefined ? (own?.parentId ?? null) : wanted.parentId,
          nameKey: wanted.nameKey ?? own?.nameKey,
          id: wanted.id === null ? undefined : { not: wanted.id },
        },
        select: { active: true, parent: { select: { name: true } } },
      });
      throw new ConflictException(moduleNameTaken(taken));
    }
  }

  /** Only two levels: a submodule's parent must be a top-level module. */
  private async assertValidParent(parentId: number | null, selfId: number | null): Promise<void> {
    if (parentId === null) return;
    if (parentId === selfId) throw new BadRequestException('Un módulo no puede ser su propio padre');
    const parent = await this.prisma.systemModule.findUnique({ where: { id: parentId } });
    if (!parent) throw new BadRequestException(noParent.message);
    if (parent.parentId !== null) throw new BadRequestException('Solo se permiten dos niveles de módulos');
    if (selfId !== null && (await this.prisma.systemModule.count({ where: { parentId: selfId } })) > 0) {
      throw new BadRequestException('Este módulo tiene submódulos; no puede convertirse en submódulo');
    }
  }
}
