import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** Longest value a preference can hold, counted on its JSON text. */
export const PREFERENCE_VALUE_MAX = 10_000;

/**
 * Deepest a preference can nest lists and objects inside each other: `[[1]]` is two levels. The
 * client of the database reads the value as JSON of its own, and goes no deeper than some 120
 * levels. A screen saves two or three.
 */
export const PREFERENCE_DEPTH_MAX = 100;

/** Half of a UTF-16 pair with no other half: a request can write one in a JSON string, and the client of the database cannot read it back. */
const HALF_PAIR = /\p{Cs}/u;

/**
 * Small settings of the web that each person chooses for themselves, such as the columns of the
 * case list. Always those of one user: what applies to everyone lives in `settings`. The value is
 * a JSON column (PostgreSQL `json`) and comes back as it was sent: the keys of an object in their
 * order, every number with all its digits.
 */
@Injectable()
export class PreferencesService {
  private readonly logger = new Logger(PreferencesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Null when the user never saved that preference. Also when the stored value cannot be read
   * back (half of a UTF-16 pair, or nesting past what the client of the database reads): `save`
   * refuses such values now, but one saved before the column was `json` may still be there. The
   * screen then starts from its default, as for a preference never saved, until it saves again.
   */
  async get(userId: number, key: string): Promise<unknown> {
    try {
      const row = await this.prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } });
      return row ? row.value : null;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientUnknownRequestError)) throw error;
      this.logger.warn(`No se pudo leer la preferencia «${key}» del usuario ${userId}: se trata como no guardada.`);
      return null;
    }
  }

  /**
   * `value` is any JSON value: the screen that saves the preference decides its shape. It is
   * stored as its JSON text, in one statement that adds the row or replaces its value: Prisma's
   * own write of a JSON column would round a number to 16 digits (0.1 + 0.2 stored as 0.3).
   * Prisma's read keeps every digit, and `get` uses it.
   */
  async save(userId: number, key: string, sent: unknown): Promise<void> {
    if (sent === undefined) throw new BadRequestException('Falta el valor de la preferencia');
    const text = JSON.stringify(sent);
    if (text.length > PREFERENCE_VALUE_MAX) throw new BadRequestException('La preferencia es demasiado grande');
    const refusal = unreadable(sent);
    if (refusal) throw new BadRequestException(refusal);
    // `updatedAt` as Prisma writes it: the moment in UTC.
    await this.prisma.$executeRaw`
      INSERT INTO "UserPreference" ("userId", "key", "value", "updatedAt")
      VALUES (${userId}, ${key}, ${text}::json, now() AT TIME ZONE 'UTC')
      ON CONFLICT ("userId", "key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"`;
  }
}

/**
 * Why the client of the database could not read `value` back, or null when it can: what the
 * request body lets through and the column takes, but `get` would answer with a 500. `depth` is
 * the level of `value` itself.
 */
function unreadable(value: unknown, depth = 1): string | null {
  if (typeof value === 'string') return HALF_PAIR.test(value) ? 'La preferencia tiene un texto que no es válido' : null;
  if (value === null || typeof value !== 'object') return null;
  if (depth > PREFERENCE_DEPTH_MAX) return `La preferencia no puede tener más de ${PREFERENCE_DEPTH_MAX} niveles`;
  const items: unknown[] = Array.isArray(value) ? value : Object.keys(value).flatMap((name) => [name, (value as Record<string, unknown>)[name]]);
  for (const item of items) {
    const refusal = unreadable(item, depth + 1);
    if (refusal) return refusal;
  }
  return null;
}
