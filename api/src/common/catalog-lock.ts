import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

/**
 * The catalogs whose entries cannot repeat a name, each with the number of its lock in the
 * database. The numbers mean nothing by themselves: they only have to differ from each other.
 */
const LOCK_KEY = { companies: 7301, supportTypes: 7302, assignees: 7303 } as const;

export type NamedCatalog = keyof typeof LOCK_KEY;

/**
 * Runs `work` in a transaction that is alone among the ones adding a name to that catalog: the
 * next one waits until this one has committed or failed, and then sees what it stored. Asking
 * whether a name is free and adding it are two statements, and no constraint of the database
 * compares names the way `searchKey` does: without the lock, two requests that arrive together
 * with the same new name both hear that it is free. The lock ends with the transaction.
 */
export function withCatalogLock<T>(prisma: PrismaService, catalog: NamedCatalog, work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY[catalog]}::bigint)`;
    return work(tx);
  });
}
