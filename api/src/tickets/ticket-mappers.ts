import type { Prisma, TicketStatus } from '@prisma/client';
import { byName, formatDateOnly, moduleFullName, ticketCode, todayDateOnly } from '../common/labels';
import type { ReminderRules } from '../settings/settings.service';

// What the API answers about a case: what its queries load, and the shapes that is turned into.

export const baseInclude = {
  company: { select: { id: true, name: true } },
  module: { select: { id: true, name: true, parent: { select: { name: true } } } },
  supportTypes: { select: { supportType: { select: { id: true, name: true, color: true } } } },
  assignees: { select: { assignee: { select: { id: true, name: true } } } },
} satisfies Prisma.TicketInclude;

export const listInclude = {
  ...baseInclude,
  notes: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true } },
  _count: { select: { notes: true, attachments: true } },
} satisfies Prisma.TicketInclude;

export const detailInclude = {
  ...baseInclude,
  createdBy: { select: { name: true } },
  notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
  attachments: { orderBy: { createdAt: 'asc' } },
  history: { orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { name: true } } } },
} satisfies Prisma.TicketInclude;

/** A case as stored, with its company, its support types, its responsibles and the name of its module. */
export type StoredTicket = Prisma.TicketGetPayload<{ include: typeof baseInclude }>;
type ListRow = Prisma.TicketGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;

export function moduleName(module: StoredTicket['module']): string | null {
  return module ? moduleFullName(module) : null;
}

/**
 * Where an open case stands against its promised delivery date:
 * `overdue` the day has passed, `today` it is due today, `soon` it is within the advance
 * notice the team configured, `later` it is further away. Null without a promise or once resolved.
 */
export type PromiseState = 'overdue' | 'today' | 'soon' | 'later';

export function promiseState(t: { status: TicketStatus; promisedDate: Date | null }, soonDays: number): PromiseState | null {
  if (!t.promisedDate || t.status === 'RESOLVED') return null;
  const days = Math.round((t.promisedDate.getTime() - todayDateOnly().getTime()) / 86_400_000);
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  return soonDays > 0 && days <= soonDays ? 'soon' : 'later';
}

/**
 * `rules.staleBefore` is the forgotten-case cutoff: an open case whose last activity
 * (`lastActivityAt`, see `activityStamp`) is older counts as forgotten.
 */
function baseDto(t: StoredTicket, rules: ReminderRules) {
  const { staleBefore } = rules;
  return {
    id: t.id,
    code: ticketCode(t.id),
    date: formatDateOnly(t.date),
    time: t.time,
    companyId: t.companyId,
    company: t.company.name,
    description: t.description,
    status: t.status,
    /** By name, as the support types. Empty for a case nobody is responsible for. */
    assignees: byName(t.assignees.map((link) => link.assignee)),
    supportTypes: byName(t.supportTypes.map((link) => link.supportType)),
    priority: t.priority,
    estimatedMinutes: t.estimatedMinutes,
    spentMinutes: t.spentMinutes,
    timerStartedAt: t.timerStartedAt,
    moduleId: t.moduleId,
    moduleName: moduleName(t.module),
    dueAt: t.dueAt,
    promisedDate: t.promisedDate ? formatDateOnly(t.promisedDate) : null,
    promiseState: promiseState(t, rules.promiseSoonDays),
    resolvedAt: t.resolvedAt,
    overdue: t.status !== 'RESOLVED' && !!t.dueAt && t.dueAt < new Date(),
    lastActivityAt: t.lastActivityAt,
    stale: t.status !== 'RESOLVED' && !!staleBefore && t.lastActivityAt < staleBefore,
    aiGenerated: t.aiGenerated,
    customerReply: t.customerReply,
    createdById: t.createdById,
    createdAt: t.createdAt,
    /** Null for a case that is not archived. */
    archivedAt: t.archivedAt,
  };
}

export function listDto(t: ListRow, rules: ReminderRules) {
  return {
    ...baseDto(t, rules),
    lastNote: t.notes[0]?.text ?? null,
    notesCount: t._count.notes,
    attachmentsCount: t._count.attachments,
  };
}

export function detailDto(t: DetailRow, rules: ReminderRules) {
  return {
    ...baseDto(t, rules),
    createdByName: t.createdBy?.name ?? null,
    lastNote: t.notes[0]?.text ?? null,
    notesCount: t.notes.length,
    attachmentsCount: t.attachments.length,
    notes: t.notes.map((n) => ({ id: n.id, text: n.text, authorName: n.author?.name ?? null, createdAt: n.createdAt })),
    attachments: t.attachments.map((a) => ({
      id: a.id,
      filename: a.filename,
      mime: a.mime,
      size: a.size,
      createdAt: a.createdAt,
    })),
    history: t.history.map((h) => ({
      id: h.id,
      field: h.field,
      oldValue: h.oldValue,
      newValue: h.newValue,
      userName: h.user?.name ?? null,
      createdAt: h.createdAt,
    })),
  };
}

export type TicketListDto = ReturnType<typeof listDto>;
export type TicketDetailDto = ReturnType<typeof detailDto>;
