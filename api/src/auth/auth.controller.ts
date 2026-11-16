import { Body, Controller, Get, HttpCode, HttpStatus, Ip, Post, UseFilters } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser, Public } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { RetryAfterFilter } from '../common/retry-after';
import { AuthService } from './auth.service';

class LoginDto {
  @IsString() @MinLength(1) @MaxLength(60) username!: string;
  @IsString() @MinLength(1) @MaxLength(200) password!: string;
}

class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(200) current!: string;
  @IsString() @MinLength(6) @MaxLength(200) next!: string;
}

/** Each 429 of these routes says in `Retry-After` how long is left (`TooManyAttemptsException`). */
@UseFilters(RetryAfterFilter)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** `ip` is the address of the client that `trust proxy` gives (see `configureApp`). */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  login(@Body() dto: LoginDto, @Ip() ip: string | undefined): Promise<{ token: string; user: AuthUser }> {
    return this.auth.login(dto.username, dto.password, ip);
  }

  /** The user of the session as stored now, role included: the web asks for it to know what to show. */
  @Get('me')
  me(@CurrentUser() user: AuthUser): AuthUser {
    return user;
  }

  /** Changes the password of the session's user, and answers the new token the session goes on with. */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto): Promise<{ token: string }> {
    return this.auth.changePassword(user, dto.current, dto.next);
  }
}
