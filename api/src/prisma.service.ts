import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnApplicationShutdown {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  /**
   * The last step of closing the application, once the server has answered the requests it had:
   * the connections to the database close instead of being cut when the process ends.
   */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
