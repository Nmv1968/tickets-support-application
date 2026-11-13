import type { PrismaService } from '../prisma.service';
import { CATALOG_LOCK_HOLD_MS, CATALOG_LOCK_TRANSACTION, withCatalogLock } from './catalog-lock';
import type { NamedCatalog } from './catalog-lock';

describe('withCatalogLock', () => {
  /** A fake database that writes down, in order, what is asked of it inside and outside a transaction. */
  const setup = () => {
    const asked: string[] = [];
    const tx = {
      // A tagged template: the pieces of the SQL, then each value put between them.
      $executeRaw: jest.fn((sql: TemplateStringsArray, ...values: unknown[]) => {
        asked.push(`${sql.join('?')} <- ${values.join(', ')}`);
        return Promise.resolve(1);
      }),
    };
    const db = {
      $transaction: jest.fn(async (work: (client: typeof tx) => Promise<unknown>): Promise<unknown> => {
        asked.push('begin');
        try {
          return await work(tx);
        } finally {
          asked.push('end');
        }
      }),
    };
    return { asked, tx, prisma: db as unknown as PrismaService };
  };

  // The lock is what makes "is the name free?" and the insert one step: asked for after the read,
  // or outside the transaction that writes, it protects nothing.
  it('opens a transaction, takes in it the lock of the catalog, and only then does the work, with the client of that transaction', async () => {
    const { asked, tx, prisma } = setup();

    const answer = await withCatalogLock(prisma, 'companies', (client) => {
      asked.push('work');
      expect(client).toBe(tx);
      return Promise.resolve('stored');
    });

    expect(answer).toBe('stored');
    // `pg_advisory_xact_lock`: the one that waits for its turn, and that the end of the transaction gives back.
    expect(asked).toEqual(['begin', 'SELECT pg_advisory_xact_lock(?::bigint) <- 7301', 'work', 'end']);
  });

  it('gives each catalog a lock of its own, so that adding a company does not wait for whoever adds a responsible', async () => {
    const keys: unknown[] = [];
    for (const catalog of ['companies', 'supportTypes', 'assignees'] satisfies NamedCatalog[]) {
      const { tx, prisma } = setup();
      await withCatalogLock(prisma, catalog, () => Promise.resolve());
      keys.push(tx.$executeRaw.mock.calls[0][1]);
    }

    expect(keys.every((key) => Number.isInteger(key))).toBe(true);
    expect(new Set(keys).size).toBe(3);
  });

  // Prisma ends an interactive transaction after 5 s unless told otherwise, and the wait for the
  // lock is part of it: a company added by hand while an import holds the lock would fail.
  it('gives its transaction time to wait for whoever holds the lock as long as an import may hold it', async () => {
    const { prisma } = setup();

    await withCatalogLock(prisma, 'companies', () => Promise.resolve());

    const db = prisma as unknown as { $transaction: jest.Mock };
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), CATALOG_LOCK_TRANSACTION);
    expect(CATALOG_LOCK_TRANSACTION.timeout).toBeGreaterThan(CATALOG_LOCK_HOLD_MS);
    expect(CATALOG_LOCK_TRANSACTION.maxWait).toBeGreaterThan(0);
  });

  describe('in a transaction that is already open', () => {
    // The import adds the names of a sheet and stores its cases in one transaction: the locks have
    // to be in it, and last until it ends.
    it('takes the locks in it, opens none, and does the work with its client', async () => {
      const { asked, tx, prisma } = setup();

      const answer = await withCatalogLock({ tx: tx as never }, ['companies'], (client) => {
        asked.push('work');
        expect(client).toBe(tx);
        return Promise.resolve('stored');
      });

      expect(answer).toBe('stored');
      expect(asked).toEqual(['SELECT pg_advisory_xact_lock(?::bigint) <- 7301', 'work']);
      expect((prisma as unknown as { $transaction: jest.Mock }).$transaction).not.toHaveBeenCalled();
    });

    // Two imports that each held one lock and waited for the other's would wait for ever.
    it('takes several always in the same order, whatever order they are named in, and each once', async () => {
      const orders: string[][] = [];
      for (const catalogs of [
        ['assignees', 'supportTypes', 'companies'],
        ['companies', 'assignees', 'supportTypes'],
        ['supportTypes', 'companies', 'assignees', 'companies'],
      ] satisfies NamedCatalog[][]) {
        const { asked, tx } = setup();
        await withCatalogLock({ tx: tx as never }, catalogs, () => Promise.resolve());
        orders.push(asked);
      }

      const all = ['7301', '7302', '7303'].map((key) => `SELECT pg_advisory_xact_lock(?::bigint) <- ${key}`);
      expect(orders).toEqual([all, all, all]);
    });

    it('takes only the locks it is given', async () => {
      const { asked, tx } = setup();

      await withCatalogLock({ tx: tx as never }, ['assignees', 'companies'], () => Promise.resolve());
      expect(asked).toEqual(['SELECT pg_advisory_xact_lock(?::bigint) <- 7301', 'SELECT pg_advisory_xact_lock(?::bigint) <- 7303']);

      const none = setup();
      await withCatalogLock({ tx: none.tx as never }, [], () => Promise.resolve());
      expect(none.asked).toEqual([]);
    });
  });

  // The refusal of a repeated name is thrown by the work: it must reach the request as it is.
  it('lets what the work throws through', async () => {
    const { asked, prisma } = setup();
    const refusal = new Error('Ya existe una empresa con ese nombre');

    await expect(withCatalogLock(prisma, 'companies', () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(asked.at(-1)).toBe('end');
  });
});
