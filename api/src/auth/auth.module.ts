import { Module } from '@nestjs/common';
import { EventsModule } from '../events/events.module';
import { UsersController } from '../users/users.controller';
import { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * The login and the users who log in. Both end the sessions of a user, and tell the live streams
 * so through `EventsService`. The checks every request goes through (JwtGuard, RolesGuard) are
 * global: see AppModule.
 */
@Module({ imports: [EventsModule], controllers: [AuthController, UsersController], providers: [AuthService, UsersService] })
export class AuthModule {}
