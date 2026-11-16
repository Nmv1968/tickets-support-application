import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post } from '@nestjs/common';
import { IdPipe } from '../common/id.pipe';
import { AssigneeInput, AssigneesService } from './assignees.service';
import type { AssigneeDto } from './assignees.service';

/** The people a case can be assigned to (`ASSIGNEES`). */
@Controller('assignees')
export class AssigneesController {
  constructor(private readonly assignees: AssigneesService) {}

  /** Everyone, active first. The screens that assign a case offer the active ones. */
  @Get()
  list(): Promise<AssigneeDto[]> {
    return this.assignees.list();
  }

  @Post()
  create(@Body() dto: AssigneeInput): Promise<AssigneeDto> {
    return this.assignees.create(dto);
  }

  @Patch(':id')
  update(@Param('id', IdPipe) id: number, @Body() dto: AssigneeInput): Promise<AssigneeDto> {
    return this.assignees.update(id, dto);
  }

  /** Only someone without cases. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IdPipe) id: number): Promise<void> {
    return this.assignees.remove(id);
  }
}
