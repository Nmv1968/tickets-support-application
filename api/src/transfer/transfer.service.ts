import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuthUser } from '../common/auth';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import { buildWhere } from '../tickets/ticket-filters';
import type { TicketFilters } from '../tickets/ticket-filters';
import { templateFile } from './import-template';
import { pdfExport } from './pdf-export';
import { importSheet } from './sheet-import';
import type { ImportOptions, ImportResult } from './sheet-import';
import type { SheetFile } from './sheet-reading';
import { xlsxExport } from './xlsx-export';

/**
 * What the controller of the transfers calls: the import of a sheet of cases and its template
 * (sheet-import.ts, import-template.ts), and the exports of the list to Excel and to PDF
 * (xlsx-export.ts, pdf-export.ts). Each job is in a file of its own; this service gives them the
 * database, and the exports the query of the filters with the reminder rules of the moment.
 */
@Injectable()
export class TransferService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  import(file: SheetFile, options: ImportOptions, user: AuthUser): Promise<ImportResult> {
    return importSheet(this.prisma, file, options, user);
  }

  template(): Promise<Buffer> {
    return templateFile(this.prisma);
  }

  async xlsx(filters: TicketFilters): Promise<Buffer> {
    return xlsxExport(this.prisma, filters, await this.where(filters));
  }

  async pdf(filters: TicketFilters): Promise<Buffer> {
    return pdfExport(this.prisma, filters, await this.where(filters));
  }

  /** The query of the cases the filters choose, as the list runs it. */
  private async where(filters: TicketFilters): Promise<Prisma.TicketWhereInput> {
    return buildWhere(filters, await this.settings.reminderRules());
  }
}
