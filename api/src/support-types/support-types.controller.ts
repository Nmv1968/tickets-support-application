import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe';
import { SupportTypeInput, SupportTypesService } from './support-types.service';
import type { SupportTypeDto } from './support-types.service';

/** "Tipos de soporte", the labels a case can carry (`SUPPORT_TYPES`). */
@Controller('support-types')
export class SupportTypesController {
  constructor(private readonly supportTypes: SupportTypesService) {}

  /** Every type, active first. The screens that label a case offer the active ones. */
  @Get()
  list(): Promise<SupportTypeDto[]> {
    return this.supportTypes.list();
  }

  @Post()
  create(@Body() dto: SupportTypeInput): Promise<SupportTypeDto> {
    return this.supportTypes.create(dto);
  }

  @Patch(':id')
  update(@Param('id', IdPipe) id: number, @Body() dto: SupportTypeInput): Promise<SupportTypeDto> {
    return this.supportTypes.update(id, dto);
  }

  /** Only a type no case carries. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IdPipe) id: number): Promise<void> {
    return this.supportTypes.remove(id);
  }
}
