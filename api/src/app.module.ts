import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiController } from './ai/ai.controller';
import { AiService } from './ai/ai.service';
import { AssigneesController } from './assignees/assignees.controller';
import { AuthController } from './auth/auth.controller';
import { CatalogController } from './catalog/catalog.controller';
import { JwtGuard, RolesGuard } from './common/auth';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { jwtOptions } from './common/session-token';
import { throttlerOptions } from './common/throttle';
import { CompaniesController } from './companies/companies.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { ChangeEventsInterceptor } from './events/change-events.interceptor';
import { EventsController } from './events/events.controller';
import { EventsService } from './events/events.service';
import { PreferencesController } from './preferences/preferences.controller';
import { PrismaService } from './prisma.service';
import { SeedService } from './seed.service';
import { SettingsController } from './settings/settings.controller';
import { SettingsService } from './settings/settings.service';
import { SupportTypesController } from './support-types/support-types.controller';
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
    // A factory, like the one below: the secret and the lifetime of the tokens come from the .env files.
    JwtModule.registerAsync({ global: true, useFactory: () => jwtOptions(process.env) }),
    // A factory, so that the limits are read once ConfigModule has loaded the .env files. With the
    // JwtService of the login check: a request with a valid token counts for its user.
    ThrottlerModule.forRootAsync({ inject: [JwtService], useFactory: (jwt: JwtService) => throttlerOptions(process.env, jwt) }),
  ],
  controllers: [
    AuthController,
    UsersController,
    AssigneesController,
    CompaniesController,
    SupportTypesController,
    CatalogController,
    TicketsController,
    AttachmentsController,
    AiController,
    DashboardController,
    TransferController,
    SettingsController,
    PreferencesController,
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
    // Before the login check: a flood of requests is cut before each one reaches the database. It
    // checks the signature of the token itself to tell whose budget a request spends.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    // After the login check, whose user it reads: an @AdminOnly() route answers 403 to an agent.
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ChangeEventsInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
  ],
})
export class AppModule {}
