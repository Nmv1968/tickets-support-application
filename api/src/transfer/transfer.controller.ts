import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { CurrentUser } from '../common/auth';
import type { AuthUser } from '../common/auth';
import { formatDateOnly, todayDateOnly } from '../common/labels';
import { FEW_FIELDS, uploadErrors } from '../common/uploads';
import { parseTicketFilters } from '../tickets/tickets.service';
import type { TicketQuery } from '../tickets/tickets.service';
import { TransferService } from './transfer.service';
import type { ImportResult } from './transfer.service';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const IMPORT_LIMITS = { fileSize: MAX_IMPORT_BYTES, files: 1, ...FEW_FIELDS };

@Controller()
export class TransferController {
  constructor(private readonly transfer: TransferService) {}

  /**
   * `dryRun=1` only reports what would be imported. `createMissing=1` adds the companies,
   * responsibles and support types of the sheet that do not exist; without it, the rows that name
   * them are rejected.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(uploadErrors(IMPORT_LIMITS), FileInterceptor('file', { limits: IMPORT_LIMITS }))
  import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Query('dryRun') dryRun?: string,
    @Query('dateOrder') dateOrder?: string,
    @Query('createMissing') createMissing?: string,
  ): Promise<ImportResult> {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    const options = { dryRun: dryRun === '1', dateOrder: dateOrder === 'dmy' ? ('dmy' as const) : ('mdy' as const), createMissing: createMissing === '1' };
    return this.transfer.import(file, options, user);
  }

  /** Spreadsheet with the columns the import reads and what the system has to choose from, for people to fill in and import. */
  @Get('import/template')
  async template(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.transfer.template();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-casos-soporte.xlsx"',
    });
    return new StreamableFile(file);
  }

  // Both exports take the filters of the list. The file headers are set once the file exists,
  // so an export that fails or is refused answers with a plain JSON error, not with an attachment.

  @Get('export/xlsx')
  async xlsx(@Query() query: TicketQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.transfer.xlsx(parseTicketFilters(query));
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="casos-soporte-${formatDateOnly(todayDateOnly())}.xlsx"`,
    });
    return new StreamableFile(file);
  }

  @Get('export/pdf')
  async pdf(@Query() query: TicketQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.transfer.pdf(parseTicketFilters(query));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="casos-soporte-${formatDateOnly(todayDateOnly())}.pdf"`,
    });
    return new StreamableFile(file);
  }
}
