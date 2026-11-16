import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import type request from 'supertest';
import type { App } from 'supertest/types';
import { configureApp } from '../app.setup';
import type { AuthUser } from './auth';
import { searchKey } from './labels';
import type { NameKeyColumn } from './named-catalog';

// What the tests of the API share, whatever part of it they are about. Only tests load this file:
// the build leaves it out (tsconfig.build.json). What the tests of one folder share is in the
// testing.ts of that folder.

/**
 * A case date as the database holds it: that day at UTC midnight. Written out here, and not taken
 * from `parseDateOnly`, so that the tests do not check the API with the API's own code.
 */
export const day = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

/** The administrator a test acts as when who acts is not what it is about. */
export const ADMIN_USER: AuthUser = { id: 1, username: 'admin', name: 'Admin', role: 'ADMIN' };

/** A statement written by hand (`$executeRaw`) as a fake of it reads it: its text with a ? for each value, spaces collapsed. */
export const sqlText = (strings: TemplateStringsArray): string => strings.join('?').replace(/\s+/g, ' ').trim();

/** The message of an error the API answered over HTTP. */
export const said = (answer: request.Response): string => (answer.body as { message: string }).message;

/** The application of a test module as main.ts sets it up (`configureApp`, with `env` for its variables), started. Without Nest's logs. */
export async function startedApp(moduleRef: TestingModule, env: NodeJS.ProcessEnv = {}): Promise<INestApplication<App>> {
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(app, env);
  await app.init();
  return app;
}

// The catalogs of names.

/** The error Prisma throws when a unique index refuses a write, naming the columns of the index as Prisma 6 does on PostgreSQL. */
export function uniqueViolation(modelName: string, ...target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError(`Unique constraint failed on the fields: (${target.join(', ')})`, {
    code: 'P2002',
    clientVersion: Prisma.prismaVersion.client,
    meta: { modelName, target },
  });
}

/** The error of an update of a row that is not there. */
export function missingRow(modelName: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('No record was found for an update.', {
    code: 'P2025',
    clientVersion: Prisma.prismaVersion.client,
    meta: { modelName, cause: 'No record was found for an update.' },
  });
}

/** An entry of a catalog of names as a spec gives it. */
export interface CatalogRow {
  id: number;
  name: string;
  active: boolean;
  _count: { tickets: number };
}

/**
 * The table of a catalog of names (`company`, `assignee`, `supportType`) over `rows`, kept in
 * memory, with the calls `NamedCatalogService` makes. Like the database, it holds the key of each
 * name in the column `key`, and its unique index: a create or an update that would give a second
 * entry the key of another one fails as Prisma fails then (P2002), and stores nothing. A new
 * entry gets the id 9, then 10... Every call is a mock, to see what was asked.
 */
export function catalogTable<Row extends CatalogRow>(modelName: string, key: NameKeyColumn, rows: Row[]) {
  type Stored = Row & Record<NameKeyColumn, string>;
  const table = rows.map((row) => ({ ...row, [key]: searchKey(row.name) }) as unknown as Stored);
  let nextId = 9;
  /** The refusal of the index for a write of `data` to the row `selfId` (null: a new row), or null when it lets it through. */
  const refusal = (data: Record<string, unknown>, selfId: number | null): Prisma.PrismaClientKnownRequestError | null =>
    data[key] !== undefined && table.some((row) => row.id !== selfId && row[key] === data[key]) ? uniqueViolation(modelName, key) : null;
  const sent = (data: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined));

  return {
    /** What the table holds, as the database would: changed by every write that went through. */
    rows: table,
    findMany: jest.fn(() => Promise.resolve(table.map((row) => ({ ...row })))),
    findUnique: jest.fn(({ where }: { where: Partial<Record<'id' | NameKeyColumn, unknown>> }) => {
      const found = table.find((row) => (where.id !== undefined ? row.id === where.id : row[key] === where[key]));
      return Promise.resolve(found ? { ...found } : null);
    }),
    create: jest.fn(({ data }: { data: Record<string, unknown> }) => {
      // A column without a default cannot be left out: the database refuses the row.
      if (typeof data[key] !== 'string') return Promise.reject(new Error(`The new entry has no ${key}`));
      const refused = refusal(data, null);
      if (refused) return Promise.reject(refused);
      const row = { ...data, id: nextId++, active: true, _count: { tickets: 0 } } as unknown as Stored;
      table.push(row);
      return Promise.resolve({ ...row });
    }),
    update: jest.fn(({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
      const row = table.find((each) => each.id === where.id);
      if (!row) return Promise.reject(missingRow(modelName));
      const refused = refusal(data, row.id);
      if (refused) return Promise.reject(refused);
      Object.assign(row, sent(data));
      return Promise.resolve({ ...row });
    }),
    delete: jest.fn().mockResolvedValue({}),
  };
}
