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
import { parseTicketFilters } from '../tickets/tickets.service';
import type { TicketQuery } from '../tickets/tickets.service';
import { TransferService } from './transfer.service';
import type { ImportResult } from './transfer.service';

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

@Controller()
export class TransferController {
  constructor(private readonly transfer: TransferService) {}

  /** `dryRun=1` only reports what would be imported. */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMPORT_BYTES } }))
  import(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: AuthUser,
    @Query('dryRun') dryRun?: string,
    @Query('dateOrder') dateOrder?: string,
  ): Promise<ImportResult> {
    if (!file) throw new BadRequestException('No se recibió ningún archivo');
    return this.transfer.import(file, { dryRun: dryRun === '1', dateOrder: dateOrder === 'dmy' ? 'dmy' : 'mdy' }, user);
  }

  /** Empty spreadsheet with the columns the import reads, for people to fill in and import. */
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
