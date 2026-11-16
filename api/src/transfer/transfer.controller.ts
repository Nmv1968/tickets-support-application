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
import { datedFileName, download } from '../common/exports';
import { FEW_FIELDS, MB, NO_FILE_MESSAGE, uploadErrors } from '../common/uploads';
import { parseTicketFilters } from '../tickets/ticket-filters';
import type { TicketQuery } from '../tickets/ticket-filters';
import type { ImportResult } from './sheet-import';
import { TransferService } from './transfer.service';

const MAX_IMPORT_BYTES = 20 * MB;
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
    if (!file) throw new BadRequestException(NO_FILE_MESSAGE);
    const options = { dryRun: dryRun === '1', dateOrder: dateOrder === 'dmy' ? ('dmy' as const) : ('mdy' as const), createMissing: createMissing === '1' };
    return this.transfer.import(file, options, user);
  }

  /** Spreadsheet with the columns the import reads and what the system has to choose from, for people to fill in and import. */
  @Get('import/template')
  async template(@Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    return download(res, await this.transfer.template(), 'plantilla-casos-soporte.xlsx');
  }

  // Both exports take the filters of the list, and are answered once the file exists (`download`).

  @Get('export/xlsx')
  async xlsx(@Query() query: TicketQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.transfer.xlsx(parseTicketFilters(query));
    return download(res, file, datedFileName('casos-soporte', 'xlsx'));
  }

  @Get('export/pdf')
  async pdf(@Query() query: TicketQuery, @Res({ passthrough: true }) res: Response): Promise<StreamableFile> {
    const file = await this.transfer.pdf(parseTicketFilters(query));
    return download(res, file, datedFileName('casos-soporte', 'pdf'));
  }
}
