import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { AdminOnly, CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { IdPipe } from '../common/id.pipe';
import { CreateUserDto, UpdateUserDto, UsersService } from './users.service';
import type { UserDto } from './users.service';

/**
 * The people who log in (`UsersService`). The list is open to every user, since the case list
 * names who registered each case. Creating and editing users is for administrators.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  list(): Promise<UserDto[]> {
    return this.users.list();
  }

  @AdminOnly()
  @Post()
  create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.users.create(dto);
  }

  @AdminOnly()
  @Patch(':id')
  update(@Param('id', IdPipe) id: number, @Body() dto: UpdateUserDto, @CurrentUser() me: AuthUser): Promise<UserDto> {
    return this.users.update(id, dto, me);
  }
}
