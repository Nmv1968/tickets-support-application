import type { Prisma, TicketStatus } from '@prisma/client';
import ExcelJS from 'exceljs';
import { refuseOverLimit } from '../common/exports';
import { PRIORITY_LABEL, STATUS_LABEL, moduleFullName, supportTypesText, ticketCode } from '../common/labels';
import { EXCEL_FORMAT, XLSX_EXPORT_LIMIT, excelMoment, paintHeader } from '../common/xlsx';
import type { PrismaService } from '../prisma.service';
import type { TicketFilters } from '../tickets/ticket-filters';
import { exportRows, notesText } from './export-cases';

/**
 * The cases of the list as a spreadsheet, one row per case. `where` is the query of `filters`,
 * whose order the rows follow.
 */
export async function xlsxExport(prisma: PrismaService, filters: TicketFilters, where: Prisma.TicketWhereInput): Promise<Buffer> {
  await refuseOverLimit(
    prisma,
    where,
    XLSX_EXPORT_LIMIT,
    (total) =>
      `La exportación a Excel admite hasta ${XLSX_EXPORT_LIMIT} casos y la selección actual tiene ${total}. ` +
      'Acota los filtros (por ejemplo, por fechas, estado o responsable) y exporta por partes.',
  );
  const rows = await exportRows(prisma, where, filters);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Casos de Soporte', { views: [{ state: 'frozen', ySplit: 1 }] });

  sheet.columns = [
    { header: 'Código', key: 'code', width: 12 },
    { header: 'Fecha del caso', key: 'date', width: 15, style: { numFmt: EXCEL_FORMAT.day } },
    { header: 'Hora del caso', key: 'time', width: 10 },
    { header: 'Fecha de registro', key: 'registered', width: 17, style: { numFmt: EXCEL_FORMAT.moment } },
    { header: 'Empresa', key: 'company', width: 28 },
    { header: 'Descripción', key: 'description', width: 60 },
    { header: 'Estado', key: 'status', width: 14 },
    { header: 'Responsable', key: 'assignee', width: 18 },
    { header: 'Observación', key: 'notes', width: 60 },
    { header: 'Prioridad', key: 'priority', width: 11 },
    { header: 'Módulo', key: 'module', width: 26 },
    { header: 'Tipos de soporte', key: 'supportTypes', width: 28 },
    { header: 'Estimado (min)', key: 'estimated', width: 15 },
    { header: 'Real (min)', key: 'spent', width: 11 },
    { header: 'Promesa de entrega', key: 'promised', width: 18, style: { numFmt: EXCEL_FORMAT.day } },
    { header: 'Fecha límite SLA', key: 'due', width: 17, style: { numFmt: EXCEL_FORMAT.moment } },
    { header: 'Resuelto el', key: 'resolved', width: 17, style: { numFmt: EXCEL_FORMAT.moment } },
    // With the filter on "Todos" the file mixes both kinds of case, and this is what tells them
    // apart. The import does not know the column: an archived case comes back in as any other.
    { header: 'Archivado', key: 'archived', width: 11 },
  ];

  paintHeader(sheet.getRow(1));

  const statusFill: Record<TicketStatus, string> = { RESOLVED: 'FFA9D08E', PENDING: 'FFFFD966', UNRESOLVED: 'FFF4B183' };
  for (const t of rows) {
    const row = sheet.addRow({
      code: ticketCode(t.id),
      date: t.date,
      time: t.time ?? '',
      registered: excelMoment(t.createdAt),
      company: t.company.name,
      description: t.description,
      status: STATUS_LABEL[t.status],
      assignee: t.assignee?.name ?? '',
      notes: notesText(t.notes),
      priority: t.priority ? PRIORITY_LABEL[t.priority] : '',
      module: t.module ? moduleFullName(t.module) : '',
      supportTypes: supportTypesText(t.supportTypes.map((link) => link.supportType)),
      estimated: t.estimatedMinutes,
      spent: t.spentMinutes || null,
      promised: t.promisedDate,
      due: excelMoment(t.dueAt),
      resolved: excelMoment(t.resolvedAt),
      archived: t.archivedAt ? 'Sí' : 'No',
    });
    row.alignment = { vertical: 'top', wrapText: true };
    row.getCell('status').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: statusFill[t.status] } };
  }
  sheet.autoFilter = { from: 'A1', to: { row: 1, column: sheet.columnCount } };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
