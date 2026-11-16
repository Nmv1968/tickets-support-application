import { Module } from '@nestjs/common';
import { TicketsModule } from '../tickets/tickets.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/** The AI providers, and the drafts they write: a case from an image or a text, and the reply of a case. */
@Module({ imports: [TicketsModule], controllers: [AiController], providers: [AiService] })
export class AiModule {}
