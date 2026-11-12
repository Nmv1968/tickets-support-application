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
import { hash } from 'bcryptjs';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { IdPipe, MAX_ID } from '../common/id.pipe';
import { PrismaService } from '../prisma.service';

// An id that no responsible can have. Passed on, the database rejects the number and the answer is a 500.
const noPerson = { message: 'El responsable no existe' };

class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,40}$/i, { message: 'Usuario: 3 a 40 caracteres, solo letras, números, punto, guion' })
  username!: string;

  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MinLength(6) @MaxLength(200) password!: string;
  /** The responsible this user is, when they also attend cases. */
  @IsOptional() @IsInt() @Min(1, noPerson) @Max(MAX_ID, noPerson) assigneeId?: number | null;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(200) password?: string;
  /** Null unlinks the user from their responsible. */
  @IsOptional() @IsInt() @Min(1, noPerson) @Max(MAX_ID, noPerson) assigneeId?: number | null;
}

export interface UserDto {
  id: number;
  username: string;
  name: string;
  active: boolean;
  /** False for a user without a password, until someone sets one. */
  canLogin: boolean;
  /** The responsible this user is. Null for a user who does not attend cases. */
  assigneeId: number | null;
}

function toDto(u: { id: number; username: string; name: string; active: boolean; passwordHash: string | null; assigneeId: number | null }): UserDto {
  return { id: u.id, username: u.username, name: u.name, active: u.active, canLogin: !!u.passwordHash, assigneeId: u.assigneeId };
}

@Controller('users')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return users.map(toDto);
  }

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserDto> {
    const username = dto.username.trim().toLowerCase();
    if (await this.prisma.user.findUnique({ where: { username } })) {
      throw new ConflictException('Ya existe un usuario con ese nombre de usuario');
    }
    await this.assertAssignee(dto.assigneeId);
    const user = await this.prisma.user.create({
      data: { username, name: dto.name.trim(), passwordHash: await hash(dto.password, 10), assigneeId: dto.assigneeId ?? null },
    });
    return toDto(user);
  }

  @Patch(':id')
  async update(
    @Param('id', IdPipe) id: number,
    @Body() dto: UpdateUserDto,
    @CurrentUser() me: AuthUser,
  ): Promise<UserDto> {
    if (dto.active === false && id === me.id) {
      throw new BadRequestException('No puedes desactivar tu propio usuario');
    }
    await this.assertAssignee(dto.assigneeId);
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        // Here null is a value: the user stops being a responsible. Not sent leaves the link as it is.
        assigneeId: dto.assigneeId,
        name: dto.name?.trim(),
        // `@IsOptional()` lets a null through, and the column cannot be empty: null means "not sent".
        active: dto.active ?? undefined,
        passwordHash: dto.password ? await hash(dto.password, 10) : undefined,
      },
    });
    return toDto(user);
  }

  /** A link to a responsible that does not exist is a 400, not a database error. */
  private async assertAssignee(id: number | null | undefined): Promise<void> {
    if (id == null) return;
    if (!(await this.prisma.assignee.findUnique({ where: { id }, select: { id: true } }))) {
      throw new BadRequestException('El responsable no existe');
    }
  }
}
