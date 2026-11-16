import { Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { download } from '../common/exports';
import { DashboardService } from './dashboard.service';
import type { DashboardDto } from './dashboard.service';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  /** The numbers of the cases dated in the range. `archived=exclude` leaves the archived ones out. */
  @Get()
  get(@Query('from') from?: string, @Query('to') to?: string, @Query('archived') archived?: string): Promise<DashboardDto> {
    return this.dashboard.summary({ from, to, archived });
  }

  // The two files of the report cover the same cases as the screen: same period, same choice about
  // the archived ones. As the exports of the list, each is answered once it exists (`download`).

  /** The report as a spreadsheet for analysis: the summaries, and every case in a table. */
  @Get('export/xlsx')
  async xlsx(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.dashboard.xlsx({ from, to, archived });
    return download(res, file, filename);
  }

  /** The report as a document to read or print: the indicators, and each breakdown with its bars. */
  @Get('export/pdf')
  async pdf(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ): Promise<StreamableFile> {
    const { file, filename } = await this.dashboard.pdf({ from, to, archived });
    return download(res, file, filename);
  }
}
