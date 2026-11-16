import type { Prisma, TicketStatus } from '@prisma/client';
import type { TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import { refuseOverLimit } from '../common/exports';
import { STATUS_LABEL, formatDateEs, formatMomentEs, moduleFullName, supportTypesText, ticketCode, todayDateOnly } from '../common/labels';
import { PDF_COLOR, PDF_HEADER_CELL, PDF_STATUS_COLOR, pdfFrame, pdfSafe, renderPdf } from '../common/pdf';
import { XLSX_EXPORT_LIMIT } from '../common/xlsx';
import type { PrismaService } from '../prisma.service';
import type { TicketFilters } from '../tickets/ticket-filters';
import { exportRows, notesText } from './export-cases';
import { describeSelection } from './filter-wording';
import type { FilterNames } from './filter-wording';

/**
 * pdfmake lays the whole document out in memory inside the only API process, and nothing else is
 * answered meanwhile. Measured with texts of ordinary length: under three seconds at this size,
 * over ten seconds and about 1 GB of memory at 20,000.
 */
export const PDF_EXPORT_LIMIT = 5_000;

/**
 * The cases of the list as a document to read or print, headed by the filters that chose them.
 * `where` is the query of `filters`, whose order the rows follow.
 */
export async function pdfExport(prisma: PrismaService, filters: TicketFilters, where: Prisma.TicketWhereInput): Promise<Buffer> {
  await refuseOverLimit(
    prisma,
    where,
    PDF_EXPORT_LIMIT,
    (total) =>
      `La exportación a PDF admite hasta ${PDF_EXPORT_LIMIT} casos y la selección actual tiene ${total}. ` +
      // Excel is offered only while this selection fits in it.
      `Acota los filtros (por ejemplo, por fechas, estado o responsable)${total > XLSX_EXPORT_LIMIT ? '.' : ' o exporta a Excel.'}`,
  );
  const rows = await exportRows(prisma, where, filters);
  const count = (status: TicketStatus): number => rows.filter((t) => t.status === status).length;
  const selection = describeSelection(filters, await filterNames(prisma, filters));

  // The description takes what the other columns leave of the sheet (A4 on its side is 841.89 pt
  // wide, and pdfmake leaves 4 pt at each side of a cell). A number and not "*": pdfmake never
  // makes a "*" column narrower than its longest word, so a web address in a description pushed
  // the columns after it off the page. In a column of a set width the word goes on in the next line.
  const sideMargin = 28;
  const [before, after] = [
    [44, 46, 46, 84],
    [48, 58, 66, 150],
  ];
  const others = [...before, ...after];
  const descriptionWidth = Math.floor(841.89 - 2 * sideMargin - others.reduce((sum, width) => sum + width, 0) - 8 * (others.length + 1));

  const headerCell = (text: string): TableCell => ({ text, ...PDF_HEADER_CELL });
  const body: TableCell[][] = [
    ['Código', 'Fecha caso', 'Registro', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Tipos de soporte', 'Observación'].map(headerCell),
    ...rows.map((t): TableCell[] => [
      // The header only says that the file includes the archived cases: each of them says so itself.
      t.archivedAt ? { stack: [ticketCode(t.id), { text: '(archivado)', fontSize: 7, color: PDF_COLOR.muted }] } : ticketCode(t.id),
      t.time ? `${formatDateEs(t.date)} ${t.time}` : formatDateEs(t.date),
      formatMomentEs(t.createdAt),
      pdfSafe(t.company.name),
      pdfSafe(t.description),
      { text: STATUS_LABEL[t.status], color: PDF_STATUS_COLOR[t.status], bold: true },
      pdfSafe(t.assignee?.name ?? ''),
      pdfSafe(supportTypesText(t.supportTypes.map((link) => link.supportType))),
      pdfSafe(notesText(t.notes)),
    ]),
  ];

  const definition: TDocumentDefinitions = {
    pageSize: 'A4',
    pageOrientation: 'landscape',
    pageMargins: [sideMargin, 56, sideMargin, 36],
    ...pdfFrame('Casos de Soporte', formatDateEs(todayDateOnly()), sideMargin),
    content: [
      { text: pdfSafe(selection), color: PDF_COLOR.muted, margin: [0, 0, 0, 4] },
      {
        text: `Total: ${rows.length}   ·   Resueltos: ${count('RESOLVED')}   ·   Pendientes: ${count('PENDING')}   ·   Sin resolver: ${count('UNRESOLVED')}`,
        bold: true,
        fontSize: 9,
        margin: [0, 0, 0, 8],
      },
      {
        table: { headerRows: 1, widths: [...before, descriptionWidth, ...after], body },
        layout: {
          hLineWidth: () => 0.5,
          vLineWidth: () => 0,
          hLineColor: () => PDF_COLOR.rule,
          paddingTop: () => 4,
          paddingBottom: () => 4,
        },
      },
    ],
  };

  return renderPdf(definition);
}

/** Looks up the names behind the ids the filters carry. */
async function filterNames(prisma: PrismaService, filters: TicketFilters): Promise<FilterNames> {
  const name = { select: { name: true } } as const;
  const [assignee, company, module, supportType, createdBy] = await Promise.all([
    typeof filters.assignee === 'number' ? prisma.assignee.findUnique({ where: { id: filters.assignee }, ...name }) : null,
    filters.companyId !== undefined ? prisma.company.findUnique({ where: { id: filters.companyId }, ...name }) : null,
    filters.moduleId !== undefined
      ? prisma.systemModule.findUnique({
          where: { id: filters.moduleId },
          select: { name: true, parent: { select: { name: true } } },
        })
      : null,
    filters.supportType !== undefined ? prisma.supportType.findUnique({ where: { id: filters.supportType }, ...name }) : null,
    filters.createdBy !== undefined ? prisma.user.findUnique({ where: { id: filters.createdBy }, ...name }) : null,
  ]);
  return {
    assignee: assignee?.name ?? null,
    company: company?.name ?? null,
    module: module ? moduleFullName(module) : null,
    supportType: supportType?.name ?? null,
    createdBy: createdBy?.name ?? null,
  };
}
