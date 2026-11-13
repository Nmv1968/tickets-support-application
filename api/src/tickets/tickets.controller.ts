import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { IdPipe } from '../common/id.pipe';
import { TicketInput, TicketsService, parseTicketFilters } from './tickets.service';
import type { TicketDetailDto, TicketListDto, TicketQuery } from './tickets.service';

export class NoteDto {
  @IsString()
  @MinLength(1, { message: 'La observación está vacía' })
  @MaxLength(5000, { message: 'La observación no puede tener más de 5000 caracteres' })
  text!: string;
}

@Controller('tickets')
export class TicketsController {
  constructor(private readonly tickets: TicketsService) {}

  @Get()
  list(@Query() query: TicketQuery): Promise<{ items: TicketListDto[]; total: number; page: number; pageSize: number }> {
    return this.tickets.list(parseTicketFilters(query));
  }

  /** Delivery promises due, forgotten cases and SLA-overdue cases, for the notification bell. */
  @Get('reminders')
  reminders(): ReturnType<TicketsService['reminders']> {
    return this.tickets.reminders();
  }

  @Get(':id')
  get(@Param('id', IdPipe) id: number): Promise<TicketDetailDto> {
    return this.tickets.get(id);
  }

  @Post()
  create(@Body() dto: TicketInput, @CurrentUser() user: AuthUser): Promise<TicketDetailDto> {
    return this.tickets.create(dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', IdPipe) id: number,
    @Body() dto: TicketInput,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketDetailDto> {
    return this.tickets.update(id, dto, user);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', IdPipe) id: number): Promise<void> {
    return this.tickets.remove(id);
  }

  @Post(':id/notes')
  addNote(
    @Param('id', IdPipe) id: number,
    @Body() dto: NoteDto,
    @CurrentUser() user: AuthUser,
  ): Promise<TicketDetailDto> {
    return this.tickets.addNote(id, dto.text, user);
  }

  @Delete(':id/notes/:noteId')
  removeNote(
    @Param('id', IdPipe) id: number,
    @Param('noteId', IdPipe) noteId: number,
  ): Promise<TicketDetailDto> {
    return this.tickets.removeNote(id, noteId);
  }

  @Post(':id/timer/start')
  startTimer(@Param('id', IdPipe) id: number): Promise<TicketDetailDto> {
    return this.tickets.startTimer(id);
  }

  @Post(':id/timer/stop')
  stopTimer(@Param('id', IdPipe) id: number): Promise<TicketDetailDto> {
    return this.tickets.stopTimer(id);
  }
}
