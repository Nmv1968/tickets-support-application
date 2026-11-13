import { BadRequestException, Controller, Get, Query, Res, StreamableFile } from '@nestjs/common';
import { Priority, Prisma } from '@prisma/client';
import type { Response } from 'express';
import { formatDateOnly, todayDateOnly } from '../common/labels';
import { PrismaService } from '../prisma.service';
import { TicketsService, parseTicketFilters } from '../tickets/tickets.service';
import { XLSX_EXPORT_LIMIT, renderPdf } from '../transfer/transfer.service';
import { buildReportWorkbook, reportPdf, reportSelect, summarize, summarySelect } from './dashboard.report';
import type { ReportOptions, StatusCount } from './dashboard.report';

export interface DashboardDto {
  totals: { total: number; unresolved: number; pending: number; resolved: number; overdue: number };
  /** Creation to resolution, for cases resolved inside the app. Imported history has no resolution time. */
  avgResolutionHours: number | null;
  /** Percentage of cases with a deadline that were resolved on time. Open cases count once overdue. */
  slaCompliance: number | null;
  /** Sums over cases that have an estimate. */
  estimatedMinutes: number;
  spentMinutes: number;
  byAssignee: StatusCount[];
  /** The ten companies with most cases, under the name each has in the catalog. */
  byCompany: { name: string; total: number }[];
  byModule: { name: string; total: number }[];
  byPriority: { priority: Priority | null; total: number }[];
  /** A case with two types counts in both. The cases without one go last, as "Sin tipo" and with no colour. */
  bySupportType: { name: string; color: string | null; total: number }[];
  /** The last twelve months with cases. */
  monthly: { month: string; total: number; resolved: number; open: number }[];
}

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketsService,
  ) {}

  /** The numbers of the cases dated in the range. `archived=exclude` leaves the archived ones out. */
  @Get()
  async get(@Query('from') from?: string, @Query('to') to?: string, @Query('archived') archived?: string): Promise<DashboardDto> {
    const { where, options } = this.selection(from, to, archived);
    const summary = summarize(await this.prisma.ticket.findMany({ where, select: summarySelect }), options.now);
    return {
      totals: summary.totals,
      avgResolutionHours: summary.avgResolutionHours,
      slaCompliance: summary.slaCompliance,
      estimatedMinutes: summary.estimatedMinutes,
      spentMinutes: summary.spentMinutes,
      byAssignee: summary.byAssignee,
      // The screen draws the top of the long lists. The spreadsheet of the report has them whole.
      byCompany: summary.byCompany.slice(0, 10).map(({ name, total }) => ({ name, total })),
      byModule: summary.byModule.slice(0, 12),
      byPriority: summary.byPriority,
      bySupportType: summary.bySupportType,
      monthly: summary.monthly.slice(-12),
    };
  }

  // The two files of the report cover the same cases as the screen: same period, same choice about
  // the archived ones. As in the exports of the list, the headers of the file are set once it
  // exists, so a report that is refused answers with a plain JSON error.

  /** The report as a spreadsheet for analysis: the summaries, and every case in a table. */
  @Get('export/xlsx')
  async xlsx(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ): Promise<StreamableFile> {
    const { where, options } = this.selection(from, to, archived);
    // Counted first, as in the export of the list: a refused report costs one query and loads no rows.
    // It is never cut short: a report with part of the cases and nothing that says so reads as the whole.
    const total = await this.prisma.ticket.count({ where });
    if (total > XLSX_EXPORT_LIMIT) {
      throw new BadRequestException(
        `El reporte en Excel admite hasta ${XLSX_EXPORT_LIMIT} casos y el periodo elegido tiene ${total}. ` +
          'Acota el periodo con las fechas "Desde" y "Hasta" y descarga el reporte por partes.',
      );
    }
    // By case number: the order the sheet of data has when nobody has sorted it yet.
    const rows = await this.prisma.ticket.findMany({ where, select: reportSelect, orderBy: { id: 'asc' } });
    const file = Buffer.from(await buildReportWorkbook(rows, options).xlsx.writeBuffer());
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="reporte-soporte-${formatDateOnly(todayDateOnly(options.now))}.xlsx"`,
    });
    return new StreamableFile(file);
  }

  /** The report as a document to read or print: the indicators, and each breakdown with its bars. */
  @Get('export/pdf')
  async pdf(
    @Res({ passthrough: true }) res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('archived') archived?: string,
  ): Promise<StreamableFile> {
    const { where, options } = this.selection(from, to, archived);
    // No limit here: the document holds the numbers, not the cases, and the screen loads as many.
    const summary = summarize(await this.prisma.ticket.findMany({ where, select: summarySelect }), options.now);
    const file = await renderPdf(reportPdf(summary, options));
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="reporte-soporte-${formatDateOnly(todayDateOnly(options.now))}.pdf"`,
    });
    return new StreamableFile(file);
  }

  /**
   * The cases the screen and its report are about, and how the report describes them. A day of the
   * range that does not exist is a 400 (see `parseTicketFilters`).
   */
  private selection(from?: string, to?: string, archived?: string): { where: Prisma.TicketWhereInput; options: ReportOptions } {
    const range = parseTicketFilters({ from, to });
    // The numbers are about the work done: an archived case counts like any other, unless the person leaves them out.
    const includeArchived = archived !== 'exclude';
    return {
      where: this.tickets.buildWhere({ ...range, archived: includeArchived ? 'all' : undefined }),
      options: { from: range.from, to: range.to, includeArchived, now: new Date() },
    };
  }
}
