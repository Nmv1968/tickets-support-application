import { BadRequestException, Logger } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth';
import { sqlText } from '../common/testing';
import type { PrismaService } from '../prisma.service';
import { PreferenceKeyPipe, PreferencesController } from './preferences.controller';
import { PREFERENCE_DEPTH_MAX, PREFERENCE_VALUE_MAX, PreferencesService } from './preferences.service';

describe('preferences of a user', () => {
  const ana: AuthUser = { id: 1, username: 'ana', name: 'Ana Torres', role: 'AGENT' };
  const jose: AuthUser = { id: 2, username: 'jose', name: 'José Pérez', role: 'AGENT' };

  interface Row {
    userId: number;
    key: string;
    /** What the `json` column holds: the JSON text, as it was written. */
    text: string;
  }
  interface RowKey {
    where: { userId_key: { userId: number; key: string } };
  }
  /** The statement that saves a preference: the row of the user and key, added or with its value replaced. */
  const UPSERT = /^INSERT INTO "UserPreference" \("userId", "key", "value", "updatedAt"\) VALUES \(\?, \?, \?::json, now\(\) AT TIME ZONE 'UTC'\) ON CONFLICT \("userId", "key"\) DO UPDATE SET "value" = EXCLUDED\."value", "updatedAt" = EXCLUDED\."updatedAt"$/;

  /**
   * The controller over a fake table of preferences, kept in memory with one row per user and key
   * as the real one. A row holds the JSON text it was given, and comes back as Prisma reads a
   * `json` column: the value of that text.
   */
  const setup = (stored: Row[] = []) => {
    const rows = [...stored];
    const find = ({ userId, key }: RowKey['where']['userId_key']): Row | undefined => rows.find((row) => row.userId === userId && row.key === key);
    const db = {
      userPreference: {
        findUnique: jest.fn(({ where }: RowKey) => {
          const row = find(where.userId_key);
          return Promise.resolve(row ? { userId: row.userId, key: row.key, value: JSON.parse(row.text) as unknown } : null);
        }),
      },
      $executeRaw: jest.fn((sql: TemplateStringsArray, userId: number, key: string, text: string) => {
        expect(sqlText(sql)).toMatch(UPSERT);
        const row = find({ userId, key });
        if (row) row.text = text;
        else rows.push({ userId, key, text });
        return Promise.resolve(1);
      }),
    };
    return { db, rows, controller: new PreferencesController(new PreferencesService(db as unknown as PrismaService)) };
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
      { userId: 1, key: 'tickets.columns', text: '{"visible":["code","status"]}' },
      { userId: 1, key: 'tickets.filters-open', text: 'true' },
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
    expect(db.$executeRaw).toHaveBeenCalledWith(expect.anything(), 2, 'tickets.columns', '1');
    expect(db.userPreference.findUnique).toHaveBeenCalledWith({ where });
  });

  // Prisma's own write of a JSON column rounds a number to 16 digits: 0.1 + 0.2 would come back as 0.3.
  it('stores the JSON text of the value, every digit of its numbers included', async () => {
    const { rows, controller } = setup();
    const value = { zoom: 0.1 + 0.2, big: 12345678901234567000, order: { z: 1, a: 2 } };

    await controller.save('board.layout', { value }, ana);

    expect(rows[0].text).toBe('{"zoom":0.30000000000000004,"big":12345678901234567000,"order":{"z":1,"a":2}}');
    expect(JSON.stringify((await controller.get('board.layout', ana)).value)).toBe(rows[0].text);
  });

  describe('the size of a value', () => {
    // Counted on the JSON text that is stored: the quotes of a string are two of its characters.
    const textOf = (length: number): string => 'x'.repeat(length - 2);

    it('accepts a value of up to 10 000 characters', async () => {
      const { rows, controller } = setup();

      await controller.save('tickets.columns', { value: textOf(PREFERENCE_VALUE_MAX) }, ana);

      expect(PREFERENCE_VALUE_MAX).toBe(10_000);
      expect(rows[0].text).toHaveLength(10_000);
    });

    it('refuses a longer one, and stores nothing', async () => {
      const { db, controller } = setup();

      const refused = await controller.save('tickets.columns', { value: textOf(PREFERENCE_VALUE_MAX + 1) }, ana).catch((error: unknown) => error);

      expect(refused).toBeInstanceOf(BadRequestException);
      expect(refused).toHaveProperty('message', 'La preferencia es demasiado grande');
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    it('measures a list or an object by the text they are stored as', async () => {
      const { db, controller } = setup();
      const visible = Array.from({ length: 2000 }, (_, index) => `col-${index}`);

      await expect(controller.save('tickets.columns', { value: { visible } }, ana)).rejects.toThrow('La preferencia es demasiado grande');
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });
  });

  it('refuses a request without a value, and keeps the one that was saved', async () => {
    const { db, controller } = setup([{ userId: 1, key: 'tickets.columns', text: '{"visible":["code"]}' }]);

    await expect(controller.save('tickets.columns', {}, ana)).rejects.toThrow('Falta el valor de la preferencia');

    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(await controller.get('tickets.columns', ana)).toEqual({ value: { visible: ['code'] } });
  });

  // A null is a JSON value like the others. Read back, it is the same as never having saved.
  it('stores a null, which reads as nothing saved', async () => {
    const { rows, controller } = setup();

    await controller.save('tickets.columns', { value: null }, ana);

    expect(rows[0].text).toBe('null');
    expect(await controller.get('tickets.columns', ana)).toEqual({ value: null });
  });

  // What the request body lets through and the column takes, but the client of the database
  // cannot read back: without these refusals, the preference would answer a 500 from then on.
  describe('a value the database could not give back', () => {
    const halfPair = String.fromCharCode(0xd800);
    const nested = (levels: number): unknown => {
      let value: unknown = 'fondo';
      for (let level = 0; level < levels; level++) value = level % 2 ? { a: value } : [value];
      return value;
    };

    it.each([
      ['in a text', ['a', `b${halfPair}`]],
      ['in the name of a field', { [`x${halfPair}`]: 1 }],
      ['deep inside', { a: [{ b: [halfPair] }] }],
    ])('is a text with half of a UTF-16 pair (%s): refused, nothing stored', async (_where, value) => {
      const { db, controller } = setup();

      await expect(controller.save('tickets.columns', { value }, ana)).rejects.toThrow(new BadRequestException('La preferencia tiene un texto que no es válido'));
      expect(db.$executeRaw).not.toHaveBeenCalled();
    });

    // Saved before `save` refused it: the client of the database fails to read the row.
    it('reads as never saved when one is already stored, and other failures of the database still fail', async () => {
      const { db, controller } = setup();
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      db.userPreference.findUnique.mockRejectedValueOnce(new Prisma.PrismaClientUnknownRequestError('invalid JSON', { clientVersion: 'test' }));

      expect(await controller.get('tickets.columns', ana)).toEqual({ value: null });
      expect(warn).toHaveBeenCalledTimes(1);

      const down = new Prisma.PrismaClientKnownRequestError('down', { code: 'P1001', clientVersion: 'test' });
      db.userPreference.findUnique.mockRejectedValueOnce(down);
      await expect(controller.get('tickets.columns', ana)).rejects.toBe(down);
      warn.mockRestore();
    });

    it('is not a text with a whole pair, as an emoji', async () => {
      const { rows, controller } = setup();

      await controller.save('tickets.columns', { value: { m: 'ñandú 😀' } }, ana);

      expect(rows[0].text).toBe('{"m":"ñandú 😀"}');
    });

    it('nests lists and objects more than 100 levels: refused, nothing stored', async () => {
      const { db, rows, controller } = setup();

      await controller.save('tickets.columns', { value: nested(PREFERENCE_DEPTH_MAX) }, ana);
      const refused = await controller.save('tickets.columns', { value: nested(PREFERENCE_DEPTH_MAX + 1) }, ana).catch((error: unknown) => error);

      expect(PREFERENCE_DEPTH_MAX).toBe(100);
      expect(refused).toEqual(new BadRequestException('La preferencia no puede tener más de 100 niveles'));
      expect(db.$executeRaw).toHaveBeenCalledTimes(1);
      expect(rows[0].text).toBe(JSON.stringify(nested(PREFERENCE_DEPTH_MAX)));
    });
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
