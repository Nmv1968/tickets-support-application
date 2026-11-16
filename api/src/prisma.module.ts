import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * The client of the database, for every module without importing this one. It is the only
 * provider of `PrismaService`: one more would open a pool of connections of its own.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
