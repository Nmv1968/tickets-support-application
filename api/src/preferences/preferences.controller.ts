import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, Put } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { Allow } from 'class-validator';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { PreferencesService } from './preferences.service';

const KEY = /^[a-z][a-z0-9.-]{0,59}$/;

/** Key of a preference taken from the URL, such as `tickets.columns`. Any other shape is a 400. */
@Injectable()
export class PreferenceKeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!KEY.test(value)) throw new BadRequestException('Clave de preferencia no válida');
    return value;
  }
}

export class PreferenceInput {
  /** Any JSON value: the screen that saves the preference decides its shape. */
  @Allow() value?: unknown;
}

/**
 * The preferences of the logged-in user (`PreferencesService`). Every route works on those of the
 * session and takes no user id, so nobody reads or changes those of another person. These writes
 * are not announced to the other browsers: they concern one user only.
 */
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly preferences: PreferencesService) {}

  /** Null when the user never saved that preference. */
  @Get(':key')
  async get(@Param('key', PreferenceKeyPipe) key: string, @CurrentUser() user: AuthUser): Promise<{ value: unknown }> {
    return { value: await this.preferences.get(user.id, key) };
  }

  @Put(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  save(@Param('key', PreferenceKeyPipe) key: string, @Body() dto: PreferenceInput, @CurrentUser() user: AuthUser): Promise<void> {
    return this.preferences.save(user.id, key, dto.value);
  }
}
