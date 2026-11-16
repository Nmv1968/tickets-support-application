import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiModule } from './ai/ai.module';
import { AuthModule } from './auth/auth.module';
import { BrandingModule } from './branding/branding.module';
import { CatalogsModule } from './catalogs.module';
import { JwtGuard, RolesGuard } from './common/auth';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { RouteErrorsFilter } from './common/route-errors.filter';
import { jwtOptions } from './common/session-token';
import { throttlerOptions } from './common/throttle';
import { DashboardModule } from './dashboard/dashboard.module';
import { ChangeEventsInterceptor } from './events/change-events.interceptor';
import { EventsModule } from './events/events.module';
import { HealthModule } from './health/health.module';
import { PreferencesModule } from './preferences/preferences.module';
import { PrismaModule } from './prisma.module';
import { SeedService } from './seed.service';
import { SettingsModule } from './settings/settings.module';
import { TicketsModule } from './tickets/tickets.module';
import { TransferModule } from './transfer/transfer.module';

/**
 * The API: one module per part of it, and here what goes for every request (the guards, the
 * interceptor of the live events, the filters of the errors of the database and of the routes)
 * and the seed.
 */
@Module({
  imports: [
    // api/.env holds development values; ../.env is the file Docker Compose also reads.
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../.env'] }),
    // A factory, like the one below: the secret and the lifetime of the tokens come from the .env files.
    JwtModule.registerAsync({ global: true, useFactory: () => jwtOptions(process.env) }),
    // A factory, so that the limits are read once ConfigModule has loaded the .env files. With the
    // JwtService of the login check: a request with a valid token counts for its user.
    ThrottlerModule.forRootAsync({ inject: [JwtService], useFactory: (jwt: JwtService) => throttlerOptions(process.env, jwt) }),
    PrismaModule,
    AuthModule,
    CatalogsModule,
    TicketsModule,
    AiModule,
    DashboardModule,
    TransferModule,
    SettingsModule,
    PreferencesModule,
    BrandingModule,
    EventsModule,
    HealthModule,
  ],
  providers: [
    SeedService,
    // Before the login check: a flood of requests is cut before each one reaches the database. It
    // checks the signature of the token itself to tell whose budget a request spends.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtGuard },
    // After the login check, whose user it reads: an @AdminOnly() route answers 403 to an agent.
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: ChangeEventsInterceptor },
    { provide: APP_FILTER, useClass: PrismaExceptionFilter },
    // Also for the requests no route takes: Nest answers those through the global filters too.
    { provide: APP_FILTER, useClass: RouteErrorsFilter },
  ],
})
export class AppModule {}
