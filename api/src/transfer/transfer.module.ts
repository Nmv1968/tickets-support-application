import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';

/** The import of cases from a sheet, its template, and the export of the list to Excel and PDF. */
@Module({ imports: [SettingsModule], controllers: [TransferController], providers: [TransferService] })
export class TransferModule {}
