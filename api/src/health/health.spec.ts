import { ServiceUnavailableException } from '@nestjs/common';
import type { PrismaService } from '../prisma.service';
import { HealthController } from './health.controller';
import { DATABASE_DOWN_MESSAGE, HealthService } from './health.service';

describe('the health check', () => {
  const controllerOn = (queryRaw: jest.Mock) => new HealthController(new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService));

  it('says the API is up and reaches its database, after one query that reads no table', async () => {
    const queryRaw = jest.fn().mockResolvedValue([{ '?column?': 1 }]);

    expect(await controllerOn(queryRaw).check()).toEqual({ status: 'ok', database: 'ok' });
    const [sql] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('?')).toBe('SELECT 1');
  });

  it('answers 503 in Spanish when the database does not answer, whatever the reason', async () => {
    for (const failure of [new Error("Can't reach database server at db:5432"), new Error('Timed out fetching a new connection from the connection pool')]) {
      await expect(controllerOn(jest.fn().mockRejectedValue(failure)).check()).rejects.toEqual(new ServiceUnavailableException(DATABASE_DOWN_MESSAGE));
    }
  });
});
