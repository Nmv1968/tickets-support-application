import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare, hash } from 'bcryptjs';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { PrismaService } from '../prisma.service';

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(60) username!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) current!: string;
  @IsString() @MinLength(6) @MaxLength(200) next!: string;
}

const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

@Controller('auth')
export class AuthController {
  /** Failed logins per username. In memory: enough for one API instance. */
  private readonly failures = new Map<string, { count: number; lockedUntil: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto): Promise<{ token: string; user: AuthUser }> {
    const username = dto.username.trim().toLowerCase();
    const entry = this.failures.get(username);
    if (entry && entry.lockedUntil > Date.now()) {
      throw new HttpException('Demasiados intentos. Espera un minuto.', HttpStatus.TOO_MANY_REQUESTS);
    }

    const user = await this.prisma.user.findUnique({ where: { username } });
    const valid = !!user?.active && !!user.passwordHash && (await compare(dto.password, user.passwordHash));
    if (!user || !valid) {
      // Bounded memory: made-up usernames must not grow the map without limit.
      if (this.failures.size > 5000) this.failures.clear();
      const count = (entry?.count ?? 0) + 1;
      this.failures.set(username, {
        count: count >= MAX_FAILURES ? 0 : count,
        lockedUntil: count >= MAX_FAILURES ? Date.now() + LOCK_MS : 0,
      });
      throw new UnauthorizedException('Usuario o contraseña incorrectos');
    }

    this.failures.delete(username);
    return {
      token: await this.jwt.signAsync({ sub: user.id }),
      user: { id: user.id, username: user.username, name: user.name },
    };
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  @Post('password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<void> {
    const row = await this.prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    if (!row.passwordHash || !(await compare(dto.current, row.passwordHash))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hash(dto.next, 10) } });
  }
}
