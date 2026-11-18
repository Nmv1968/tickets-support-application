import type { Prisma } from '@prisma/client';
import { formatMomentEs } from '../common/labels';
import type { PrismaService } from '../prisma.service';
import { ticketOrder } from '../tickets/ticket-filters';
import type { TicketFilters } from '../tickets/ticket-filters';

// The cases an export loads, and what the two exports, to Excel and to PDF, write the same way.

const exportInclude = {
  company: { select: { name: true } },
  assignees: { select: { assignee: { select: { name: true } } } },
  module: { select: { name: true, parent: { select: { name: true } } } },
  supportTypes: { select: { supportType: { select: { name: true } } } },
  notes: { orderBy: { createdAt: 'asc' }, select: { text: true, createdAt: true } },
} satisfies Prisma.TicketInclude;

export type ExportRow = Prisma.TicketGetPayload<{ include: typeof exportInclude }>;

/**
 * Every case of the selection. There is no `take` on purpose: the caller has just counted the
 * selection against its limit, and a cut here would hand over an incomplete file without notice.
 */
export function exportRows(prisma: PrismaService, where: Prisma.TicketWhereInput, filters: TicketFilters): Promise<ExportRow[]> {
  return prisma.ticket.findMany({
    where,
    include: exportInclude,
    // Same order as the list on screen.
    orderBy: ticketOrder(filters),
  });
}

/** The "Observación" cell: one observation goes alone, several go one per line with the day each was written. */
export function notesText(notes: ExportRow['notes']): string {
  if (notes.length <= 1) return notes[0]?.text ?? '';
  // `createdAt` is a moment, not a calendar date: its day is the one on the server's clock, not the UTC one.
  return notes.map((note) => `${formatMomentEs(note.createdAt)}: ${note.text}`).join('\n');
}
