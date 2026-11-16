import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/auth';
import { HealthService } from './health.service';
import type { HealthDto } from './health.service';

/**
 * Whether the API is up and reaches its database: for the healthcheck of Docker Compose, the
 * end-to-end stack and whoever watches the installation. Without a session, like the logo of the
 * login page, and counted by the general limit like every other request.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Public()
  @Get()
  check(): Promise<HealthDto> {
    return this.health.check();
  }
}
