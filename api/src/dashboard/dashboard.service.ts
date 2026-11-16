import { Injectable } from '@nestjs/common';
import type { Priority, Prisma } from '@prisma/client';
import { datedFileName, refuseOverLimit } from '../common/exports';
import type { FileName } from '../common/exports';
import { renderPdf } from '../common/pdf';
import { XLSX_EXPORT_LIMIT } from '../common/xlsx';
import { PrismaService } from '../prisma.service';
import { buildWhere, parseTicketFilters } from '../tickets/ticket-filters';
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

/** The query of the screen and of its report: the cases dated in a range, and whether the archived ones count. */
export interface DashboardQuery {
  from?: string;
  to?: string;
  /** `exclude` leaves the archived cases out. */
  archived?: string;
}

/** What the names of the files of the report start with; then comes the day it was made. */
const REPORT_FILE = 'reporte-soporte';

/** A file of the report, with the name it is downloaded under. */
export interface ReportFile {
  file: Buffer;
  filename: FileName;
}

/** The numbers of the cases, for the screen and for the two files of its report, which cover the same cases. */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(query: DashboardQuery): Promise<DashboardDto> {
    const { where, options } = selection(query);
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

  /** The report as a spreadsheet for analysis: the summaries, and every case in a table. */
  async xlsx(query: DashboardQuery): Promise<ReportFile> {
    const { where, options } = selection(query);
    // As the export of the list.
    await refuseOverLimit(
      this.prisma,
      where,
      XLSX_EXPORT_LIMIT,
      (total) =>
        `El reporte en Excel admite hasta ${XLSX_EXPORT_LIMIT} casos y el periodo elegido tiene ${total}. ` +
        'Acota el periodo con las fechas "Desde" y "Hasta" y descarga el reporte por partes.',
    );
    // By case number: the order the sheet of data has when nobody has sorted it yet.
    const rows = await this.prisma.ticket.findMany({ where, select: reportSelect, orderBy: { id: 'asc' } });
    const file = Buffer.from(await buildReportWorkbook(rows, options).xlsx.writeBuffer());
    return { file, filename: datedFileName(REPORT_FILE, 'xlsx', options.now) };
  }

  /** The report as a document to read or print: the indicators, and each breakdown with its bars. */
  async pdf(query: DashboardQuery): Promise<ReportFile> {
    const { where, options } = selection(query);
    // No limit here: the document holds the numbers, not the cases, and the screen loads as many.
    const summary = summarize(await this.prisma.ticket.findMany({ where, select: summarySelect }), options.now);
    return { file: await renderPdf(reportPdf(summary, options)), filename: datedFileName(REPORT_FILE, 'pdf', options.now) };
  }
}

/**
 * The cases the screen and its report are about, and how the report describes them. A day of the
 * range that does not exist is a 400 (see `parseTicketFilters`).
 */
function selection({ from, to, archived }: DashboardQuery): { where: Prisma.TicketWhereInput; options: ReportOptions } {
  const range = parseTicketFilters({ from, to });
  // The numbers are about the work done: an archived case counts like any other, unless the person leaves them out.
  const includeArchived = archived !== 'exclude';
  return {
    where: buildWhere({ ...range, archived: includeArchived ? 'all' : undefined }),
    options: { from: range.from, to: range.to, includeArchived, now: new Date() },
  };
}
