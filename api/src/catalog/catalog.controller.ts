import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import type { Priority } from '@prisma/client';
import { AdminOnly } from '../common/auth';
import { IdPipe } from '../common/id.pipe';
import { ModuleInput, ModulesService } from './modules.service';
import type { ModuleDto } from './modules.service';
import { SlaInput, SlaService } from './sla.service';

@Controller()
export class CatalogController {
  constructor(
    private readonly systemModules: ModulesService,
    private readonly slaPolicies: SlaService,
  ) {}

  /** Active modules by default; `?all=1` also returns deactivated ones (for the settings screen). */
  @Get('modules')
  modules(@Query('all') all?: string): Promise<ModuleDto[]> {
    return this.systemModules.list(all === '1');
  }

  @Post('modules')
  createModule(@Body() dto: ModuleInput): Promise<{ id: number }> {
    return this.systemModules.create(dto);
  }

  @Patch('modules/:id')
  updateModule(@Param('id', IdPipe) id: number, @Body() dto: ModuleInput): Promise<void> {
    return this.systemModules.update(id, dto);
  }

  @Get('sla')
  sla(): Promise<{ priority: Priority; hours: number }[]> {
    return this.slaPolicies.hours();
  }

  @AdminOnly()
  @Put('sla')
  saveSla(@Body() dto: SlaInput): Promise<void> {
    return this.slaPolicies.save(dto.items);
  }
}
