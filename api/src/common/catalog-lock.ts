import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../prisma.service';

/**
 * The catalogs whose entries cannot repeat a name, each with the number of its lock in the
 * database. The numbers mean nothing by themselves: they only have to differ from each other.
 */
const LOCK_KEY = { companies: 7301, supportTypes: 7302, assignees: 7303 } as const;

export type NamedCatalog = keyof typeof LOCK_KEY;

/**
 * The order in which a transaction that needs several of the locks takes them: by their number,
 * whatever order it names them in. Two transactions that each held one lock and waited for the
 * other's would wait for ever; taken in one order, the second one waits for the first lock and
 * holds nothing meanwhile.
 */
const LOCK_ORDER = (Object.keys(LOCK_KEY) as NamedCatalog[]).sort((a, b) => LOCK_KEY[a] - LOCK_KEY[b]);

/**
 * The longest a transaction may keep locks of the catalogs: the time limit of the import, which
 * holds them from the moment it adds the first entry until every case of the sheet is stored.
 * The import is given exactly this; see `TransferService.import`.
 */
export const CATALOG_LOCK_HOLD_MS = 120_000;

/**
 * Time limits of the transaction `withCatalogLock` opens. Prisma gives an interactive transaction
 * 5 s by default, and the wait for the lock happens inside it: a company added by hand while an
 * import holds the lock of the companies would fail after those 5 s, though the import would have
 * let it through a little later. So the transaction may last as long as an import may hold the lock,
 * plus the moment its own work takes. `maxWait` is the wait for a connection of the pool, which an
 * import does not lengthen: it uses one.
 */
export const CATALOG_LOCK_TRANSACTION = { maxWait: 5_000, timeout: CATALOG_LOCK_HOLD_MS + 15_000 } as const;

/**
 * Runs `work` in a transaction that is alone among the ones adding a name to those catalogs: the
 * next one waits until this one has committed or failed, and then sees what it stored. Asking
 * whether a name is free and adding it are two statements, and no constraint of the database
 * compares names the way `searchKey` does: without the lock, two requests that arrive together
 * with the same new name both hear that it is free. The lock ends with the transaction.
 *
 * Given `{ tx }`, the locks are taken in that transaction, which is already open, and they last
 * until it ends: that is how the import adds the names of a sheet in the same transaction as its
 * cases. Given the client, it opens a transaction of its own, with `CATALOG_LOCK_TRANSACTION`.
 */
export function withCatalogLock<T>(
  db: PrismaService | { tx: Prisma.TransactionClient },
  catalogs: NamedCatalog | readonly NamedCatalog[],
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  const wanted = typeof catalogs === 'string' ? [catalogs] : catalogs;
  const locked = async (tx: Prisma.TransactionClient): Promise<T> => {
    for (const catalog of LOCK_ORDER.filter((each) => wanted.includes(each))) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LOCK_KEY[catalog]}::bigint)`;
    }
    return work(tx);
  };
  return 'tx' in db ? locked(db.tx) : db.$transaction(locked, CATALOG_LOCK_TRANSACTION);
}
