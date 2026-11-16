import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';

/** The cases, with their observations, attachments and timer. The AI works on a case through `TicketsService`. */
@Module({
  imports: [SettingsModule],
  controllers: [TicketsController, AttachmentsController],
  providers: [TicketsService, AttachmentsService],
  exports: [TicketsService],
})
export class TicketsModule {}
