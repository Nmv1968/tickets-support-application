import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { IsBoolean, IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AdminOnly, CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { IdPipe } from '../common/id.pipe';
import { END_SESSIONS } from '../common/session-token';
import { EventsService } from '../events/events.service';
import { PrismaService } from '../prisma.service';
import { WORKING_ADMIN } from './admins';

const ROLE = { message: 'El rol debe ser ADMIN (administrador) o AGENT (agente)' };

class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,40}$/i, { message: 'Usuario: 3 a 40 caracteres, solo letras, números, punto, guion' })
  username!: string;

  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MinLength(6) @MaxLength(200) password!: string;
  /** Left out, the new user is an agent. */
  @IsOptional() @IsEnum(Role, ROLE) role?: Role;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(200) password?: string;
  @IsOptional() @IsEnum(Role, ROLE) role?: Role;
}

export interface UserDto {
  id: number;
  username: string;
  name: string;
  active: boolean;
  /** False for a user without a password, until someone sets one. */
  canLogin: boolean;
  role: Role;
}

function toDto(u: { id: number; username: string; name: string; active: boolean; passwordHash: string | null; role: Role }): UserDto {
  return { id: u.id, username: u.username, name: u.name, active: u.active, canLogin: !!u.passwordHash, role: u.role };
}

/**
 * Number of the database lock taken by the edits that can take an administrator away:
 * deactivating one, or making one an agent. Two administrators who demote each other at the same
 * moment would each still see the other and leave none; one after the other, the second one sees
 * what the first did.
 */
const ADMINS_LOCK = 7310;

/**
 * The people who log in. Being a user says nothing about attending cases: the responsibles of
 * the cases are a catalog of their own (see `AssigneesController`).
 *
 * The list is open to every user, since the case list names who registered each case. Creating
 * and editing users is for administrators.
 */
@Controller('users')
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventsService,
  ) {}

  @Get()
  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return users.map(toDto);
  }

  @AdminOnly()
  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserDto> {
    const username = dto.username.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new ConflictException('Ya existe un usuario con ese nombre de usuario');
    }
    const user = await this.prisma.user.create({
      data: { username, name: dto.name.trim(), passwordHash: await hash(dto.password, 10), role: dto.role ?? Role.AGENT },
    });
    return toDto(user);
  }

  @AdminOnly()
  @Patch(':id')
  async update(
    @Param('id', IdPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: AuthUser,
  ): Promise<UserDto> {
    if (dto.active === false && id === me.id) {
      throw new BadRequestException('No puedes desactivar tu propio usuario');
    }
    if (dto.role != null && dto.role !== me.role && id === me.id) {
      throw new BadRequestException('No puedes cambiar tu propio rol. Otro administrador puede hacerlo.');
    }
    // Written here, it would end this very session (see below). In Mi cuenta it asks for the current
    // one, as it does of everybody, and answers the new token the session goes on with.
    if (dto.password && id === me.id) {
      throw new BadRequestException('Tu propia contraseña se cambia en Configuración > Mi cuenta, con la contraseña actual.');
    }
    // A new password, another role or the user deactivated: the sessions the user has open end.
    // Whoever had the old password, or an administrator demoted, does not go on with them.
    const ends = !!dto.password || dto.active === false || (dto.role != null && dto.role !== (await this.roleOf(id)));
    const data = {
      name: dto.name?.trim(),
      // `@IsOptional()` lets a null through, and these columns cannot be empty: null means "not sent".
      active: dto.active ?? undefined,
      role: dto.role ?? undefined,
      passwordHash: dto.password ? await hash(dto.password, 10) : undefined,
      ...(ends ? END_SESSIONS : {}),
    };
    const user =
      dto.active !== false && dto.role !== Role.AGENT
        ? await this.prisma.user.update({ where: { id }, data })
        : await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ADMINS_LOCK}::bigint)`;
            const updated = await tx.user.update({ where: { id }, data });
            // Thrown inside the transaction, which undoes the edit.
            if ((await tx.user.count({ where: WORKING_ADMIN })) === 0) {
              throw new BadRequestException('Debe quedar al menos un administrador activo. Haz administrador a otra persona antes.');
            }
            return updated;
          });
    // Once the edit is committed: the streams of events those sessions keep open end too.
    if (ends) this.events.sessionsEnded(id);
    return toDto(user);
  }

  /** The role the user has now; a user that does not exist answers 404 here, before anything is written. */
  private async roleOf(id: number): Promise<Role> {
    return (await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { role: true } })).role;
  }
}
