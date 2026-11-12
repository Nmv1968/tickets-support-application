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
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { IdPipe } from '../common/id.pipe';
import { PrismaService } from '../prisma.service';

class CreateUserDto {
  @IsString()
  @Matches(/^[a-z0-9._-]{3,40}$/i, { message: 'Usuario: 3 a 40 caracteres, solo letras, números, punto, guion' })
  username!: string;

  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MinLength(6) @MaxLength(200) password!: string;
}

class UpdateUserDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MinLength(6) @MaxLength(200) password?: string;
}

export interface UserDto {
  id: number;
  username: string;
  name: string;
  active: boolean;
  /** False for people created by the spreadsheet import until someone sets a password. */
  canLogin: boolean;
}

function toDto(u: { id: number; username: string; name: string; active: boolean; passwordHash: string | null }): UserDto {
  return { id: u.id, username: u.username, name: u.name, active: u.active, canLogin: !!u.passwordHash };
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
    const user = await this.prisma.user.create({
      data: { username, name: dto.name.trim(), passwordHash: await hash(dto.password, 10) },
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
    const user = await this.prisma.user.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        // `@IsOptional()` lets a null through, and the column cannot be empty: null means "not sent".
        active: dto.active ?? undefined,
        passwordHash: dto.password ? await hash(dto.password, 10) : undefined,
      },
    });
    return toDto(user);
  }
}
