import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PRIORITY_LABEL, STATUS_LABEL, formatDateEs, formatDateOnly, parseDateOnly, supportTypesText, ticketSearchKey, todayDateOnly } from '../common/labels';
import type { TicketInput } from './ticket-input';
import { moduleName } from './ticket-mappers';
import type { StoredTicket } from './ticket-mappers';

// What a write of a case stores: the plan of an edit by a person, and the rules every write of a
// case follows (its last activity, the deadline of its SLA, its date, its reply and its timer).

/**
 * Every write that counts as someone working on a case spreads this into its `data`: case created,
 * case edited by a person, note added, attachments uploaded, timer started or stopped, client reply
 * saved. The import passes the day of the case. No other write moves `lastActivityAt`, so a bulk
 * fix or a maintenance script does not make forgotten cases look attended.
 */
export function activityStamp(at: Date = new Date()): { lastActivityAt: Date } {
  return { lastActivityAt: at };
}

/** What an edit needs from outside the case itself. The caller looks it up: see `TicketsService.lookups`. */
export interface TicketUpdateContext {
  now: Date;
  /** Name of the company in `dto.companyId`. */
  companyName: string | null;
  /** Name of the responsible in `dto.assigneeId`. */
  assigneeName: string | null;
  /** The support types in `dto.supportTypeIds`, each once. Null when the input does not carry them. */
  supportTypes: { id: number; name: string }[] | null;
  /** Name of the module in `dto.moduleId`, as shown in the history. */
  moduleName: string | null;
  /** Hours the SLA gives to `dto.priority`. Null without a priority or without a policy for it. */
  slaHours: number | null;
}

/** One line of the history of a case: the field as the person reads it and its two values. */
export interface TicketChange {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

export interface TicketUpdatePlan {
  data: Prisma.TicketUncheckedUpdateInput;
  history: TicketChange[];
}

/**
 * Decides what an edit by a person writes: the columns that change and the history lines.
 * It reads no database and no clock, so the same case, input and context always give the same plan.
 * Throws a 400 when the input would leave the case without description, or dated in the future.
 */
export function planTicketUpdate(before: StoredTicket, dto: TicketInput, context: TicketUpdateContext): TicketUpdatePlan {
  const { now } = context;
  // An edit by a person is activity on the case, whichever field it touches. The archive switch is
  // the exception: putting a case away, or bringing it back, is not working on it. Sent alone, it
  // leaves the last activity where it was.
  const archiveAlone = dto.archived != null && Object.entries(dto).every(([field, value]) => field === 'archived' || value === undefined);
  const data: Prisma.TicketUncheckedUpdateInput = archiveAlone ? {} : { ...activityStamp(now) };
  const history: TicketChange[] = [];
  const track = (field: string, oldValue: string | null, newValue: string | null): void => {
    if (oldValue !== newValue) history.push({ field, oldValue, newValue });
  };

  // `@IsOptional()` lets a null through. The date, company, description, status and time spent of a
  // case cannot be empty in the database, so for them null means "not sent", as it does on create.
  // The same goes for its support types, where the empty value is an empty list, and for the archive.
  if (dto.date != null && dto.date !== formatDateOnly(before.date)) {
    assertReportDate(dto.date, now);
    data.date = parseDateOnly(dto.date);
    track('Fecha del caso', formatDateOnly(before.date), dto.date);
  }
  // The time is optional on a case: here null is a value, and removes it.
  if (dto.time !== undefined && dto.time !== before.time) {
    data.time = dto.time;
    track('Hora del caso', before.time, dto.time);
  }

  // The name of the company the case moves to. Null when the input names none, or the one the case has.
  const newCompany = dto.companyId != null && dto.companyId !== before.companyId ? context.companyName : null;
  let description = before.description;
  if (newCompany !== null) {
    data.companyId = dto.companyId;
    track('Empresa', before.company.name, newCompany);
  }
  if (dto.description != null) {
    description = dto.description.trim();
    if (!description) throw new BadRequestException('La descripción no puede quedar vacía');
    data.description = description;
    // The history says that the description changed, not what it said before or after.
    if (description !== before.description) history.push({ field: 'Descripción', oldValue: null, newValue: null });
  }
  if (newCompany !== null || dto.description != null) data.searchText = ticketSearchKey(newCompany ?? before.company.name, description);

  if (dto.status != null && dto.status !== before.status) {
    data.status = dto.status;
    data.resolvedAt = dto.status === 'RESOLVED' ? now : null;
    // Resolving stops a running timer, and its minutes join the time spent. An edit that also says
    // what the time spent is has the last word, further down.
    if (dto.status === 'RESOLVED' && before.timerStartedAt) {
      data.spentMinutes = before.spentMinutes + elapsedMinutes(before.timerStartedAt, now);
      data.timerStartedAt = null;
    }
    track('Estado', STATUS_LABEL[before.status], STATUS_LABEL[dto.status]);
  }

  // The responsible is optional on a case: null is a value, and leaves the case without one.
  if (dto.assigneeId !== undefined && dto.assigneeId !== before.assigneeId) {
    data.assigneeId = dto.assigneeId;
    track('Responsable', before.assignee?.name ?? null, dto.assigneeId ? context.assigneeName : null);
  }

  if (dto.supportTypeIds != null) {
    const had = before.supportTypes.map((link) => link.supportType);
    const wanted = context.supportTypes ?? [];
    const removed = had.filter((type) => !wanted.some((other) => other.id === type.id)).map((type) => type.id);
    const added = wanted.filter((type) => !had.some((other) => other.id === type.id)).map((type) => type.id);
    if (removed.length || added.length) {
      // Only the difference is written: the types the case keeps are not deleted and created again.
      data.supportTypes = {
        deleteMany: removed.length ? { supportTypeId: { in: removed } } : undefined,
        createMany: added.length ? { data: added.map((supportTypeId) => ({ supportTypeId })) } : undefined,
      };
      // Null for none, as for every other field a case can be left without.
      track('Tipos de soporte', supportTypesText(had) || null, supportTypesText(wanted) || null);
    }
  }

  if (dto.archived != null && dto.archived !== (before.archivedAt !== null)) {
    data.archivedAt = dto.archived ? now : null;
    track('Archivado', dto.archived ? 'No' : 'Sí', dto.archived ? 'Sí' : 'No');
  }

  if (dto.priority !== undefined && dto.priority !== before.priority) {
    data.priority = dto.priority;
    data.dueAt = slaDueAt(before.createdAt, dto.priority ? context.slaHours : null);
    track(
      'Prioridad',
      before.priority ? PRIORITY_LABEL[before.priority] : null,
      dto.priority ? PRIORITY_LABEL[dto.priority] : null,
    );
  }

  if (dto.promisedDate !== undefined) {
    const previous = before.promisedDate ? formatDateOnly(before.promisedDate) : null;
    const next = dto.promisedDate || null;
    if (next !== previous) {
      data.promisedDate = next ? parseDateOnly(next) : null;
      track('Promesa de entrega', before.promisedDate ? formatDateEs(before.promisedDate) : null, next ? formatDateEs(parseDateOnly(next)) : null);
    }
  }
  if (dto.customerReply !== undefined) data.customerReply = cleanReply(dto.customerReply);
  if (dto.estimatedMinutes !== undefined) data.estimatedMinutes = dto.estimatedMinutes;
  // Also over the minutes of a timer that resolving has just stopped: the form saves all its fields
  // together, and the number the person typed in it is the one they mean.
  if (dto.spentMinutes != null) data.spentMinutes = dto.spentMinutes;
  if (dto.moduleId !== undefined && dto.moduleId !== before.moduleId) {
    data.moduleId = dto.moduleId;
    track('Módulo', moduleName(before.module), dto.moduleId ? context.moduleName : null);
  }

  return { data, history };
}

/**
 * A case has two dates. `date` is the day the client reported the problem: a person
 * enters it and it can be in the past. `createdAt` is the moment the ticket was
 * registered here: always set by the server, never editable.
 * The reported day cannot be after today; one day of slack covers time-zone differences.
 */
export function assertReportDate(date: string | undefined, now: Date): void {
  if (!date) return;
  const limit = new Date(todayDateOnly(now).getTime() + 86_400_000);
  if (parseDateOnly(date) > limit) throw new BadRequestException('La fecha del caso no puede ser posterior a hoy');
}

/** Deadline = registration time + hours of the priority's SLA. No SLA hours, no deadline. */
export function slaDueAt(createdAt: Date, slaHours: number | null): Date | null {
  return slaHours === null ? null : new Date(createdAt.getTime() + slaHours * 3_600_000);
}

export function cleanReply(reply: string | null): string | null {
  return reply?.trim() || null;
}

export function elapsedMinutes(since: Date, now: Date): number {
  return Math.max(1, Math.round((now.getTime() - since.getTime()) / 60_000));
}
