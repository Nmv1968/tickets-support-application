import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** The 503 of a health check whose query does not reach the database. */
export const DATABASE_DOWN_MESSAGE = 'La base de datos no responde.';

/** What `GET /api/health` answers while the API is up and reaches its database. No data of anybody. */
export interface HealthDto {
  status: 'ok';
  database: 'ok';
}

@Injectable()
export class HealthService {
  constructor(private readonly prisma: PrismaService) {}

  /** One query that reads no table; a 503 when the database does not answer it, whatever the reason. */
  async check(): Promise<HealthDto> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException(DATABASE_DOWN_MESSAGE);
    }
    return { status: 'ok', database: 'ok' };
  }
}
