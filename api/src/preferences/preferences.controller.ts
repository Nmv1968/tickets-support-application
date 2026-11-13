import { BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Injectable, Param, Put } from '@nestjs/common';
import type { PipeTransform } from '@nestjs/common';
import { Allow } from 'class-validator';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { PrismaService } from '../prisma.service';

/** Longest value a preference can hold, counted on its JSON text. */
export const PREFERENCE_VALUE_MAX = 10_000;

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
 * Small settings of the web that each person chooses for themselves, such as the columns of the
 * case list. Every route works on the preferences of the logged-in user and takes no user id, so
 * nobody reads or changes those of another person. What applies to everyone lives in `settings`.
 * These writes are not announced to the other browsers: they concern one user only.
 */
@Controller('preferences')
export class PreferencesController {
  constructor(private readonly prisma: PrismaService) {}

  /** Null when the user never saved that preference. */
  @Get(':key')
  async get(@Param('key', PreferenceKeyPipe) key: string, @CurrentUser() user: AuthUser): Promise<{ value: unknown }> {
    const row = await this.prisma.userPreference.findUnique({ where: { userId_key: { userId: user.id, key } } });
    return { value: row ? storedValue(row.value) : null };
  }

  @Put(':key')
  @HttpCode(HttpStatus.NO_CONTENT)
  async save(@Param('key', PreferenceKeyPipe) key: string, @Body() dto: PreferenceInput, @CurrentUser() user: AuthUser): Promise<void> {
    if (dto.value === undefined) throw new BadRequestException('Falta el valor de la preferencia');
    const value = JSON.stringify(dto.value);
    if (value.length > PREFERENCE_VALUE_MAX) throw new BadRequestException('La preferencia es demasiado grande');
    await this.prisma.userPreference.upsert({
      where: { userId_key: { userId: user.id, key } },
      create: { userId: user.id, key, value },
      update: { value },
    });
  }
}

/** A stored text that is not JSON, which only a hand edit of the table leaves, reads as never saved. */
function storedValue(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
