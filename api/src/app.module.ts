import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { AssigneesController } from './assignees/assignees.controller';
import { AuthController } from './auth/auth.controller';
import { CatalogController } from './catalog/catalog.controller';
import { JwtGuard } from './common/auth';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { DashboardController } from './dashboard/dashboard.controller';
import { ChangeEventsInterceptor } from './events/change-events.interceptor';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { PrismaService } from './prisma.service';
import { SeedService } from './seed.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { BrandingController } from './branding/branding.controller';
import { BrandingService } from './branding/branding.service';
import { AttachmentsController } from './tickets/attachments.controller';
import { TicketsController } from './tickets/tickets.controller';
import { TicketsService } from './tickets/tickets.service';
import { TransferController } from './transfer/transfer.controller';
import { TransferService } from './transfer/transfer.service';
import { UsersController } from './users/users.controller';

@Module({
  imports: [
    // api/.env holds development values; ../.env is the file Docker Compose also reads.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    JwtModule.registerAsync({
      global: true,
      useFactory: () => {
        const secret = process.env.JWT_SECRET;
        if (!secret) throw new Error('JWT_SECRET is not set');
        return { secret, signOptions: { expiresIn: '7d' } };
      },
    }),
  ],
  controllers: [
    AuthController,
    UsersController,
    AssigneesController,
    CatalogController,
    TicketsController,
    AttachmentsController,
    AiController,
    DashboardController,
    TransferController,
    SettingsController,
    BrandingController,
    EventsController,
  ],
  providers: [
    PrismaService,
    SeedService,
    SettingsService,
    BrandingService,
    TicketsService,
    AiService,
    TransferService,
    EventsService,
    { provide: APP_GUARD, useClass: JwtGuard },
    { provide: APP_INTERCEPTOR, useClass: ChangeEventsInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
