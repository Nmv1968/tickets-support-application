import { BadRequestException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import type { AuthUser } from '../common/auth';
import type { PrismaService } from '../prisma.service';
import { PREFERENCE_VALUE_MAX, PreferenceKeyPipe, PreferencesController } from './preferences.controller';

// The controller imports the login decorators and, through them, @nestjs/jwt, which is published
// as ES modules only: Jest cannot load it here. Nothing in these tests uses it.
jest.mock('@nestjs/jwt', () => ({ JwtService: class {} }));

describe('preferences of a user', () => {
  const ana: AuthUser = { id: 1, username: 'ana', name: 'Ana Torres' };
  const jose: AuthUser = { id: 2, username: 'jose', name: 'José Pérez' };

  interface Row {
    userId: number;
    key: string;
    value: string;
  }
  interface RowKey {
    where: { userId_key: { userId: number; key: string } };
  }

  /** The controller over a fake table of preferences, kept in memory with one row per user and key as the real one. */
  const setup = (stored: Row[] = []) => {
    const rows = [...stored];
    const find = ({ userId, key }: RowKey['where']['userId_key']): Row | undefined => rows.find((row) => row.userId === userId && row.key === key);
    const db = {
      userPreference: {
        findUnique: jest.fn(({ where }: RowKey) => Promise.resolve(find(where.userId_key) ?? null)),
        upsert: jest.fn(({ where, create, update }: RowKey & { create: Row; update: { value: string } }) => {
          const row = find(where.userId_key);
          if (row) row.value = update.value;
          else rows.push(create);
          return Promise.resolve({});
        }),
      },
    };
    return { db, rows, controller: new PreferencesController(db as unknown as PrismaService) };
  };

  it('answers null for a preference the user never saved', async () => {
    expect(await setup().controller.get('tickets.columns', ana)).toEqual({ value: null });
  });

  it('gives back what was saved, whatever kind of JSON value it is', async () => {
    const { controller } = setup();
    const columns = { visible: ['code', 'company', 'status'] };

    for (const value of [columns, ['a', 'b'], 'compacta', 25, true, false, 0, '']) {
      await controller.save('tickets.columns', { value }, ana);
      expect(await controller.get('tickets.columns', ana)).toEqual({ value });
    }
  });

  it('keeps one value per key: saving again replaces it, and another key is another preference', async () => {
    const { rows, controller } = setup();

    await controller.save('tickets.columns', { value: { visible: ['code'] } }, ana);
    await controller.save('tickets.columns', { value: { visible: ['code', 'status'] } }, ana);
    await controller.save('tickets.filters-open', { value: true }, ana);

    expect(rows).toEqual([
      { userId: 1, key: 'tickets.columns', value: '{"visible":["code","status"]}' },
      { userId: 1, key: 'tickets.filters-open', value: 'true' },
    ]);
  });

  // The columns one person chooses are theirs: nothing here is a setting of the whole team.
  it('never shows or changes the preferences of another user', async () => {
    const { rows, controller } = setup();

    await controller.save('tickets.columns', { value: { visible: ['code', 'company'] } }, ana);

    expect(await controller.get('tickets.columns', jose)).toEqual({ value: null });

    await controller.save('tickets.columns', { value: { visible: ['code', 'date'] } }, jose);

    expect(await controller.get('tickets.columns', ana)).toEqual({ value: { visible: ['code', 'company'] } });
    expect(await controller.get('tickets.columns', jose)).toEqual({ value: { visible: ['code', 'date'] } });
    expect(rows.map((row) => row.userId)).toEqual([1, 2]);
  });

  it('reads and writes only the row of the logged-in user', async () => {
    const { db, controller } = setup();

    await controller.save('tickets.columns', { value: 1 }, jose);
    await controller.get('tickets.columns', jose);

    const where = { userId_key: { userId: 2, key: 'tickets.columns' } };
    expect(db.userPreference.upsert).toHaveBeenCalledWith({ where, create: { userId: 2, key: 'tickets.columns', value: '1' }, update: { value: '1' } });
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where });
  });

  describe('the size of a value', () => {
    // Counted on the JSON text that is stored: the quotes of a string are two of its characters.
    const textOf = (length: number): string => 'x'.repeat(length - 2);

    it('accepts a value of up to 10 000 characters', async () => {
      const { rows, controller } = setup();

      await controller.save('tickets.columns', { value: textOf(PREFERENCE_VALUE_MAX) }, ana);

      expect(PREFERENCE_VALUE_MAX).toBe(10_000);
      expect(rows[0].value).toHaveLength(10_000);
    });

    it('refuses a longer one, and stores nothing', async () => {
      const { db, controller } = setup();

      const refused = await controller.save('tickets.columns', { value: textOf(PREFERENCE_VALUE_MAX + 1) }, ana).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', 'La preferencia es demasiado grande');
      expect(db.userPreference.upsert).not.toHaveBeenCalled();
    });

    it('measures a list or an object by the text they are stored as', async () => {
      const { db, controller } = setup();
      const visible = Array.from({ length: 2000 }, (_, index) => `col-${index}`);

      await expect(controller.save('tickets.columns', { value: { visible } }, ana)).rejects.toThrow('La preferencia es demasiado grande');
      expect(db.userPreference.upsert).not.toHaveBeenCalled();
    });
  });

  it('refuses a request without a value, and keeps the one that was saved', async () => {
    const { db, controller } = setup([{ userId: 1, key: 'tickets.columns', value: '{"visible":["code"]}' }]);

    await expect(controller.save('tickets.columns', {}, ana)).rejects.toThrow('Falta el valor de la preferencia');

    expect(db.userPreference.upsert).not.toHaveBeenCalled();
    expect(await controller.get('tickets.columns', ana)).toEqual({ value: { visible: ['code'] } });
  });

  // A null is a JSON value like the others. Read back, it is the same as never having saved.
  it('stores a null, which reads as nothing saved', async () => {
    const { rows, controller } = setup();

    await controller.save('tickets.columns', { value: null }, ana);

    expect(rows[0].value).toBe('null');
    expect(await controller.get('tickets.columns', ana)).toEqual({ value: null });
  });

  // Only a hand edit of the table leaves that: the answer is still a preference, not a 500.
  it('reads a stored text that is not JSON as nothing saved', async () => {
    const { controller } = setup([{ userId: 1, key: 'tickets.columns', value: '{visible' }]);

    expect(await controller.get('tickets.columns', ana)).toEqual({ value: null });
  });

  describe('the key', () => {
    const pipe = new PreferenceKeyPipe();

    it.each(['tickets.columns', 'tickets.filters-open', 'a', 'board2', `a${'b'.repeat(59)}`])('accepts "%s"', (key) => {
      expect(pipe.transform(key)).toBe(key);
    });

    it.each(['', 'Tickets.columns', '1columns', '.columns', '-columns', 'tickets columns', 'tickets/columns', 'tickets_columns', 'año', `a${'b'.repeat(60)}`])(
      'refuses "%s" with a 400 in Spanish',
      (key) => {
        expect(() => pipe.transform(key)).toThrow(BadRequestException);
        expect(() => pipe.transform(key)).toThrow('Clave de preferencia no válida');
      },
    );

    // The check lives in a pipe: a route that took the key without it would store any text as a key.
    it.each(['get', 'save'])('is checked by the route that %ss a preference', (method) => {
      const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, PreferencesController, method) as Record<string, { data?: string; pipes: unknown[] }>;

      expect(Object.values(args).find((arg) => arg.data === 'key')?.pipes).toEqual([PreferenceKeyPipe]);
    });
  });
});
