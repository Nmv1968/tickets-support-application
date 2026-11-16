import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

/** `GET /api/health`. */
@Module({ controllers: [HealthController], providers: [HealthService] })
export class HealthModule {}
