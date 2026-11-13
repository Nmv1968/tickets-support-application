import type { PrismaService } from '../prisma.service';
import { withCatalogLock } from './catalog-lock';
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

  // The refusal of a repeated name is thrown by the work: it must reach the request as it is.
  it('lets what the work throws through', async () => {
    const { asked, prisma } = setup();
    const refusal = new Error('Ya existe una empresa con ese nombre');

    await expect(withCatalogLock(prisma, 'companies', () => Promise.reject(refusal))).rejects.toBe(refusal);
    expect(asked.at(-1)).toBe('end');
  });
});
