import { Body, Controller, Get, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { AdminOnly } from '../common/auth';
import { SettingsService } from './settings.service';

/** Each field is optional: a screen saves only the reminder it edits. A null counts as not sent. */
class RemindersDto {
  /** Forgotten cases. 0 turns the reminder off. Upper limit: one year. */
  @IsOptional() @IsInt() @Min(0) @Max(24 * 365) staleHours?: number;
  /** Advance notice before a promised delivery date, in days. 0 = no advance notice. */
  @IsOptional() @IsInt() @Min(0) @Max(60) promiseSoonDays?: number;
}

@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get('reminders')
  async reminders(): Promise<{ staleHours: number; promiseSoonDays: number }> {
    const [staleHours, promiseSoonDays] = await Promise.all([this.settings.staleHours(), this.settings.promiseSoonDays()]);
    return { staleHours, promiseSoonDays };
  }

  @AdminOnly()
  @Put('reminders')
  @HttpCode(HttpStatus.NO_CONTENT)
  async saveReminders(@Body() dto: RemindersDto): Promise<void> {
    if (dto.staleHours != null) await this.settings.setStaleHours(dto.staleHours);
    if (dto.promiseSoonDays != null) await this.settings.setPromiseSoonDays(dto.promiseSoonDays);
  }
}
