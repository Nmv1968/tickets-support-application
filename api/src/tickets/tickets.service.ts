import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Priority, Prisma, TicketStatus } from '@prisma/client';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateBy } from 'class-validator';
import { unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AuthUser } from '../common/auth';
import { MAX_ID } from '../common/id.pipe';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  formatDateEs,
  formatDateOnly,
  isDateOnly,
  isTimeOnly,
  moduleFullName,
  noteSearchKey,
  parseDateOnly,
  searchKey,
  ticketCode,
  ticketSearchKey,
  todayDateOnly,
} from '../common/labels';
import { PrismaService } from '../prisma.service';
import { SettingsService } from '../settings/settings.service';
import type { ReminderRules } from '../settings/settings.service';

/** Accepts only a day that exists, written `YYYY-MM-DD`. `message` is the text of the 400 the person reads. */
function IsDateOnly(message: string): PropertyDecorator {
  return ValidateBy({ name: 'isDateOnly', validator: { validate: isDateOnly } }, { message });
}

/** Accepts only a time of day written `HH:mm`, 24-hour clock. */
function IsTimeOnly(message: string): PropertyDecorator {
  return ValidateBy({ name: 'isTimeOnly', validator: { validate: isTimeOnly } }, { message });
}

// Texts of the 400 the person reads when a value of a case is too long or out of range.
const MAX_MINUTES = 1_000_000;
const tooLong = (field: string, max: number): { message: string } => ({ message: `${field} no puede tener más de ${max} caracteres` });
const minutesRange = (field: string): { message: string } => ({ message: `${field} debe estar entre 0 y ${MAX_MINUTES} minutos` });
// An id that no record can have. Passed on, the database rejects the number and the answer is a 500.
const noPerson = { message: 'El responsable no existe' };
const noModule = { message: 'El módulo no existe' };

/**
 * Used for both create and update. Create additionally requires company and description.
 * `@IsOptional()` also lets a null through. Where the case can be left without the value, null
 * removes it (see each field); for every other field the service reads null as "not sent".
 */
export class TicketInput {
  /** Day the client reported the problem. The registration moment (`createdAt`) is not an input. */
  @IsOptional() @IsDateOnly('La fecha del caso no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.') date?: string;
  /** Time of day the client reported it, `HH:mm`. Optional; null removes it. */
  @IsOptional() @IsTimeOnly('La hora del caso no es válida. Usa el formato HH:MM, de 00:00 a 23:59.') time?: string | null;
  @IsOptional() @IsString() @MaxLength(200, tooLong('La empresa', 200)) company?: string;
  @IsOptional() @IsString() @MaxLength(5000, tooLong('La descripción', 5000)) description?: string;
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  /** Null leaves the case without a responsible person. */
  @IsOptional() @IsInt() @Min(1, noPerson) @Max(MAX_ID, noPerson) assigneeId?: number | null;
  @IsOptional() @IsBoolean() assignedToClient?: boolean;
  @IsOptional() @IsEnum(Priority) priority?: Priority | null;
  @IsOptional() @IsInt() @Min(0, minutesRange('El tiempo estimado')) @Max(MAX_MINUTES, minutesRange('El tiempo estimado')) estimatedMinutes?: number | null;
  @IsOptional() @IsInt() @Min(0, minutesRange('El tiempo real')) @Max(MAX_MINUTES, minutesRange('El tiempo real')) spentMinutes?: number;
  /** Null leaves the case without a module. */
  @IsOptional() @IsInt() @Min(1, noModule) @Max(MAX_ID, noModule) moduleId?: number | null;
  /** "Promesa de entrega": day promised to the client, `YYYY-MM-DD`. Null removes the promise. */
  @IsOptional()
  @IsDateOnly('La promesa de entrega no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.')
  promisedDate?: string | null;
  /** Message for the client. Null or empty clears it. */
  @IsOptional() @IsString() @MaxLength(5000, tooLong('La respuesta para el cliente', 5000)) customerReply?: string | null;
  /** Create only: first "observación". */
  @IsOptional() @IsString() @MaxLength(5000, tooLong('La observación', 5000)) note?: string;
  @IsOptional() @IsBoolean() aiGenerated?: boolean;
}

/** Query string of a list of cases as it arrives: untrusted, and a repeated parameter is an array. */
export type TicketQuery = Record<string, unknown>;

/** Promised delivery date. `due` is what the bell shows: overdue, today and, when configured, soon. */
export type PromiseFilter = 'any' | 'overdue' | 'today' | 'soon' | 'due';
export type TicketSort = 'date' | 'company' | 'status';

/**
 * Filters, order and page of a list of cases, already validated: the list, the exports and the
 * dashboard all read this, never the query string. Each field is named after its query parameter;
 * an absent field does not filter. Comes from `parseTicketFilters`, or is written by hand in code.
 */
export type TicketFilters = {
  status?: TicketStatus[];
  /** A person's id, `client` for "Responsable: Cliente" or `none` for cases nobody is responsible for. */
  assignee?: number | 'client' | 'none';
  /** Exact company name, whatever the case. */
  company?: string;
  priority?: Priority;
  moduleId?: number;
  /** Range of the case date, both ends included, as `YYYY-MM-DD`. */
  from?: string;
  to?: string;
  /** Only open cases past their SLA deadline. */
  overdue?: boolean;
  /** Only forgotten cases. */
  stale?: boolean;
  promise?: PromiseFilter;
  /** Text typed in the search box. */
  q?: string;
  /** Without it the list is ordered by ticket number. */
  sort?: TicketSort;
  dir?: Prisma.SortOrder;
  page?: number;
  pageSize?: number;
};

const PROMISE_FILTERS: PromiseFilter[] = ['any', 'overdue', 'today', 'soon', 'due'];
const SORTS: TicketSort[] = ['date', 'company', 'status'];
const DIRECTIONS: Prisma.SortOrder[] = ['asc', 'desc'];
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;

/** Text values of one query parameter. Anything that is not text is left out. */
function queryValues(value: unknown): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values.filter((item): item is string => typeof item === 'string').map((item) => item.trim());
}

/**
 * The only reader of the query string of a list of cases. A value that is not valid is dropped,
 * as if the parameter had not been sent. The two ends of the date range are the exception: a
 * `from` or `to` that is not a real day throws a 400. Dropped, the answer would cover every date
 * and nothing in it would tell the caller that the range was ignored. `status` takes several
 * values, separated by commas or by repeating the parameter. The other parameters use their first
 * value when repeated.
 */
export function parseTicketFilters(query: TicketQuery): TicketFilters {
  const text = (name: string): string | undefined => queryValues(query[name])[0] || undefined;
  const oneOf = <T extends string>(name: string, allowed: readonly T[]): T | undefined => {
    const value = text(name);
    return allowed.find((option) => option === value);
  };
  const int = (name: string): number | undefined => {
    const value = text(name);
    return value && /^\d{1,9}$/.test(value) ? Number(value) : undefined;
  };
  // `label` is the name of the filter on screen. Absent or empty still means "not sent".
  const date = (name: string, label: string): string | undefined => {
    const value = text(name);
    if (value !== undefined && !isDateOnly(value)) {
      throw new BadRequestException(`El filtro "${label}" no es válido. Debe ser una fecha real con el formato AAAA-MM-DD.`);
    }
    return value;
  };

  const sentStatuses = queryValues(query.status).flatMap((value) => value.split(',').map((part) => part.trim()));
  const status = STATUSES.filter((option) => sentStatuses.includes(option));
  const pageSize = int('pageSize');

  return {
    status: status.length ? status : undefined,
    assignee: oneOf('assignee', ['client', 'none'] as const) ?? int('assignee'),
    company: text('company'),
    priority: oneOf('priority', PRIORITIES),
    moduleId: int('moduleId'),
    from: date('from', 'Desde'),
    to: date('to', 'Hasta'),
    overdue: text('overdue') === '1' || undefined,
    stale: text('stale') === '1' || undefined,
    promise: oneOf('promise', PROMISE_FILTERS),
    q: text('q'),
    sort: oneOf('sort', SORTS),
    dir: oneOf('dir', DIRECTIONS),
    // 0 is not a page or a size: it falls back to the default like any other invalid value.
    page: int('page') || undefined,
    pageSize: pageSize ? Math.min(pageSize, MAX_PAGE_SIZE) : undefined,
  };
}

const baseInclude = {
  assignee: { select: { id: true, name: true } },
  module: { select: { id: true, name: true, parent: { select: { name: true } } } },
} satisfies Prisma.TicketInclude;

const listInclude = {
  ...baseInclude,
  notes: { orderBy: { createdAt: 'desc' }, take: 1, select: { text: true } },
  _count: { select: { notes: true, attachments: true } },
} satisfies Prisma.TicketInclude;

const detailInclude = {
  ...baseInclude,
  createdBy: { select: { name: true } },
  notes: { orderBy: { createdAt: 'desc' }, include: { author: { select: { name: true } } } },
  attachments: { orderBy: { createdAt: 'asc' } },
  history: { orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { name: true } } } },
} satisfies Prisma.TicketInclude;

/** A case as stored, with the names of its responsible person and module. */
export type StoredTicket = Prisma.TicketGetPayload<{ include: typeof baseInclude }>;
type ListRow = Prisma.TicketGetPayload<{ include: typeof listInclude }>;
type DetailRow = Prisma.TicketGetPayload<{ include: typeof detailInclude }>;

/**
 * Order of a list of cases. By default the ticket number, highest first: the newest ticket on top.
 * `dir=asc` reverses it; `sort=date|company|status` orders by that field instead.
 */
export function ticketOrder(filters: TicketFilters): Prisma.TicketOrderByWithRelationInput[] {
  const dir = filters.dir ?? 'desc';
  if (!filters.sort) return [{ id: dir }];
  // Within a day, the cases that have a time go by it; the ones without it come after them.
  if (filters.sort === 'date') return [{ date: dir }, { time: { sort: dir, nulls: 'last' } }, { id: 'asc' }];
  return [{ [filters.sort]: dir }, { id: 'asc' }];
}

export function uploadDir(): string {
  return resolve(process.env.UPLOAD_DIR ?? './uploads');
}

/**
 * Every write that counts as someone working on a case spreads this into its `data`: case created,
 * case edited by a person, note added, attachments uploaded, timer started or stopped, client reply
 * saved. The import passes the day of the case. No other write moves `lastActivityAt`, so a bulk
 * fix or a maintenance script does not make forgotten cases look attended.
 */
export function activityStamp(at: Date = new Date()): { lastActivityAt: Date } {
  return { lastActivityAt: at };
}

function assigneeName(t: { assignedToClient: boolean; assignee: { name: string } | null }): string | null {
  return t.assignedToClient ? 'Cliente' : (t.assignee?.name ?? null);
}

function moduleName(module: StoredTicket['module']): string | null {
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
    company: t.company,
    description: t.description,
    status: t.status,
    assigneeId: t.assigneeId,
    assignedToClient: t.assignedToClient,
    assigneeName: assigneeName(t),
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
    createdAt: t.createdAt,
  };
}

function listDto(t: ListRow, rules: ReminderRules) {
  return {
    ...baseDto(t, rules),
    lastNote: t.notes[0]?.text ?? null,
    notesCount: t._count.notes,
    attachmentsCount: t._count.attachments,
  };
}

function detailDto(t: DetailRow, rules: ReminderRules) {
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

/** What an edit needs from outside the case itself. The caller looks it up: see `TicketsService.lookups`. */
export interface TicketUpdateContext {
  now: Date;
  /** Name of the responsible in `dto.assigneeId`. */
  assigneeName: string | null;
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
 * Throws a 400 when the input would leave the case without company or description, or dated in the future.
 */
export function planTicketUpdate(before: StoredTicket, dto: TicketInput, context: TicketUpdateContext): TicketUpdatePlan {
  const { now } = context;
  // An edit by a person is activity on the case, whichever field it touches.
  const data: Prisma.TicketUncheckedUpdateInput = { ...activityStamp(now) };
  const history: TicketChange[] = [];
  const track = (field: string, oldValue: string | null, newValue: string | null): void => {
    if (oldValue !== newValue) history.push({ field, oldValue, newValue });
  };

  // `@IsOptional()` lets a null through. The date, company, description, status and time spent of a
  // case cannot be empty in the database, so for them null means "not sent", as it does on create.
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

  let company = before.company;
  let description = before.description;
  if (dto.company != null) {
    company = dto.company.trim();
    if (!company) throw new BadRequestException('La empresa no puede quedar vacía');
    data.company = company;
    track('Empresa', before.company, company);
  }
  if (dto.description != null) {
    description = dto.description.trim();
    if (!description) throw new BadRequestException('La descripción no puede quedar vacía');
    data.description = description;
    // The history says that the description changed, not what it said before or after.
    if (description !== before.description) history.push({ field: 'Descripción', oldValue: null, newValue: null });
  }
  if (dto.company != null || dto.description != null) data.searchText = ticketSearchKey(company, description);

  if (dto.status != null && dto.status !== before.status) {
    data.status = dto.status;
    data.resolvedAt = dto.status === 'RESOLVED' ? now : null;
    if (dto.status === 'RESOLVED' && before.timerStartedAt) {
      data.spentMinutes = before.spentMinutes + elapsedMinutes(before.timerStartedAt, now);
      data.timerStartedAt = null;
    }
    track('Estado', STATUS_LABEL[before.status], STATUS_LABEL[dto.status]);
  }

  if (dto.assigneeId !== undefined || dto.assignedToClient !== undefined) {
    // Choosing a person clears "Cliente"; choosing "Cliente" clears the person.
    const toClient = dto.assignedToClient ?? (dto.assigneeId != null ? false : before.assignedToClient);
    const assigneeId = toClient ? null : dto.assigneeId !== undefined ? dto.assigneeId : before.assigneeId;
    data.assignedToClient = toClient;
    data.assigneeId = assigneeId;
    // Without a person in the input the case keeps the one it had, whose name is already loaded.
    const personName = dto.assigneeId != null ? context.assigneeName : (before.assignee?.name ?? null);
    track('Responsable', assigneeName(before), toClient ? 'Cliente' : assigneeId ? personName : null);
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
  // Resolving with the timer running already decided the time spent, above.
  if (dto.spentMinutes != null && data.spentMinutes === undefined) data.spentMinutes = dto.spentMinutes;
  if (dto.moduleId !== undefined && dto.moduleId !== before.moduleId) {
    data.moduleId = dto.moduleId;
    track('Módulo', moduleName(before.module), dto.moduleId ? context.moduleName : null);
  }

  return { data, history };
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** `rules` (see SettingsService.reminderRules) are needed only for the `stale` and `promise` filters. */
  buildWhere(filters: TicketFilters, rules: ReminderRules = { staleBefore: null, promiseSoonDays: 0 }): Prisma.TicketWhereInput {
    const and: Prisma.TicketWhereInput[] = [];
    const none: Prisma.TicketWhereInput = { id: -1 };
    const open: Prisma.TicketWhereInput = { status: { not: 'RESOLVED' } };

    if (filters.stale) {
      // With reminders turned off no case is forgotten.
      and.push(rules.staleBefore ? { ...open, lastActivityAt: { lt: rules.staleBefore } } : none);
    }

    if (filters.promise) {
      const today = todayDateOnly();
      const soonLimit = new Date(today.getTime() + rules.promiseSoonDays * 86_400_000);
      const byPromise: Record<PromiseFilter, Prisma.TicketWhereInput> = {
        any: { promisedDate: { not: null } },
        overdue: { ...open, promisedDate: { lt: today } },
        today: { ...open, promisedDate: today },
        soon: rules.promiseSoonDays > 0 ? { ...open, promisedDate: { gt: today, lte: soonLimit } } : none,
        due: { ...open, promisedDate: { lte: soonLimit } },
      };
      and.push(byPromise[filters.promise]);
    }

    if (filters.status?.length) and.push({ status: { in: filters.status } });

    if (filters.assignee === 'client') and.push({ assignedToClient: true });
    else if (filters.assignee === 'none') and.push({ assigneeId: null, assignedToClient: false });
    else if (filters.assignee !== undefined) and.push({ assigneeId: filters.assignee });

    if (filters.company) and.push({ company: { equals: filters.company, mode: 'insensitive' } });
    if (filters.priority) and.push({ priority: filters.priority });
    if (filters.moduleId !== undefined) and.push({ moduleId: filters.moduleId });
    if (filters.from) and.push({ date: { gte: parseDateOnly(filters.from) } });
    if (filters.to) and.push({ date: { lte: parseDateOnly(filters.to) } });
    if (filters.overdue) and.push({ dueAt: { lt: new Date() }, status: { not: 'RESOLVED' } });

    const text = searchKey(filters.q ?? '');
    if (text) {
      const or: Prisma.TicketWhereInput[] = [
        { searchText: { contains: text } },
        { notes: { some: { searchText: { contains: text } } } },
      ];
      const code = /^(?:sop-?)?0*(\d{1,9})$/i.exec(text);
      if (code) or.push({ id: Number(code[1]) });
      and.push({ OR: or });
    }

    return and.length ? { AND: and } : {};
  }

  async list(filters: TicketFilters): Promise<{ items: TicketListDto[]; total: number; page: number; pageSize: number }> {
    const rules = await this.settings.reminderRules();
    const where = this.buildWhere(filters, rules);
    const pageSize = filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const page = filters.page ?? 1;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where,
        include: listInclude,
        orderBy: ticketOrder(filters),
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.ticket.count({ where }),
    ]);
    return { items: rows.map((row) => listDto(row, rules)), total, page, pageSize };
  }

  /**
   * What the notification bell shows, all for open cases only:
   * - promises: promised delivery date already passed, due today or, when the team configured
   *   advance notice, coming up within those days (most urgent first);
   * - stale: nobody has touched the case for longer than the configured time (oldest first);
   * - overdue: past the SLA deadline.
   */
  async reminders(): Promise<{
    staleHours: number;
    promiseSoonDays: number;
    promises: TicketListDto[];
    stale: TicketListDto[];
    overdue: TicketListDto[];
  }> {
    const staleHours = await this.settings.staleHours();
    const rules = await this.settings.reminderRules();
    const [promises, stale, overdue] = await Promise.all([
      this.prisma.ticket.findMany({
        where: this.buildWhere({ promise: 'due' }, rules),
        include: listInclude,
        orderBy: [{ promisedDate: 'asc' }, { id: 'asc' }],
        take: 100,
      }),
      rules.staleBefore
        ? this.prisma.ticket.findMany({
            where: this.buildWhere({ stale: true }, rules),
            include: listInclude,
            orderBy: { lastActivityAt: 'asc' },
            take: 100,
          })
        : [],
      this.prisma.ticket.findMany({
        where: { status: { not: 'RESOLVED' }, dueAt: { lt: new Date() } },
        include: listInclude,
        orderBy: { dueAt: 'asc' },
        take: 100,
      }),
    ]);
    return {
      staleHours,
      promiseSoonDays: rules.promiseSoonDays,
      promises: promises.map((row) => listDto(row, rules)),
      stale: stale.map((row) => listDto(row, rules)),
      overdue: overdue.map((row) => listDto(row, rules)),
    };
  }

  async get(id: number): Promise<TicketDetailDto> {
    const ticket = await this.prisma.ticket.findUnique({ where: { id }, include: detailInclude });
    if (!ticket) throw new NotFoundException('El caso no existe');
    return detailDto(ticket, await this.settings.reminderRules());
  }

  async create(dto: TicketInput, user: AuthUser): Promise<TicketDetailDto> {
    const company = dto.company?.trim();
    const description = dto.description?.trim();
    if (!company || !description) throw new BadRequestException('Empresa y descripción son obligatorias');
    const { slaHours } = await this.lookups(dto);

    const now = new Date();
    assertReportDate(dto.date, now);
    const status = dto.status ?? 'PENDING';
    const toClient = dto.assignedToClient === true;
    const note = dto.note?.trim();

    const ticket = await this.prisma.ticket.create({
      data: {
        date: dto.date ? parseDateOnly(dto.date) : todayDateOnly(now),
        time: dto.time ?? null,
        company,
        description,
        searchText: ticketSearchKey(company, description),
        status,
        // Whoever registers the case takes it unless another responsible is chosen.
        assigneeId: toClient ? null : dto.assigneeId === undefined ? await this.ownAssigneeId(user.id) : dto.assigneeId,
        assignedToClient: toClient,
        priority: dto.priority ?? null,
        estimatedMinutes: dto.estimatedMinutes ?? null,
        spentMinutes: dto.spentMinutes ?? 0,
        moduleId: dto.moduleId ?? null,
        dueAt: slaDueAt(now, slaHours),
        promisedDate: dto.promisedDate ? parseDateOnly(dto.promisedDate) : null,
        resolvedAt: status === 'RESOLVED' ? now : null,
        aiGenerated: dto.aiGenerated ?? false,
        createdById: user.id,
        createdAt: now,
        ...activityStamp(now),
        notes: note ? { create: { text: note, searchText: noteSearchKey(note), authorId: user.id } } : undefined,
      },
    });
    return this.get(ticket.id);
  }

  async update(id: number, dto: TicketInput, user: AuthUser): Promise<TicketDetailDto> {
    const before = await this.prisma.ticket.findUnique({ where: { id }, include: baseInclude });
    if (!before) throw new NotFoundException('El caso no existe');

    const { data, history } = planTicketUpdate(before, dto, { now: new Date(), ...(await this.lookups(dto)) });
    await this.prisma.$transaction([
      this.prisma.ticket.update({ where: { id }, data }),
      this.prisma.ticketHistory.createMany({ data: history.map((change) => ({ ...change, ticketId: id, userId: user.id })) }),
    ]);
    return this.get(id);
  }

  async remove(id: number): Promise<void> {
    const attachments = await this.prisma.attachment.findMany({ where: { ticketId: id } });
    try {
      await this.prisma.ticket.delete({ where: { id } });
    } catch (error) {
      // P2025 is Prisma's "the row to delete does not exist". Any other failure is not a 404.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new NotFoundException('El caso no existe');
      }
      throw error;
    }
    await Promise.all(attachments.map((a) => unlink(join(uploadDir(), a.storedName)).catch(() => undefined)));
  }

  async addNote(id: number, text: string, user: AuthUser): Promise<TicketDetailDto> {
    const clean = text.trim();
    if (!clean) throw new BadRequestException('La observación está vacía');
    await this.get(id);
    await this.prisma.$transaction([
      this.prisma.ticketNote.create({ data: { ticketId: id, text: clean, searchText: noteSearchKey(clean), authorId: user.id } }),
      this.prisma.ticket.update({ where: { id }, data: activityStamp() }),
    ]);
    return this.get(id);
  }

  async removeNote(id: number, noteId: number): Promise<TicketDetailDto> {
    await this.prisma.ticketNote.deleteMany({ where: { id: noteId, ticketId: id } });
    return this.get(id);
  }

  /**
   * Stores the message for the client when it does not come from a person editing the case,
   * as the AI draft does. Null or empty clears it.
   */
  async saveCustomerReply(id: number, reply: string | null): Promise<void> {
    const { count } = await this.prisma.ticket.updateMany({
      where: { id },
      data: { customerReply: cleanReply(reply), ...activityStamp() },
    });
    if (!count) throw new NotFoundException('El caso no existe');
  }

  async startTimer(id: number): Promise<TicketDetailDto> {
    const ticket = await this.get(id);
    if (!ticket.timerStartedAt) {
      const now = new Date();
      await this.prisma.ticket.update({ where: { id }, data: { timerStartedAt: now, ...activityStamp(now) } });
    }
    return this.get(id);
  }

  async stopTimer(id: number): Promise<TicketDetailDto> {
    const ticket = await this.get(id);
    if (ticket.timerStartedAt) {
      const now = new Date();
      await this.prisma.ticket.update({
        where: { id },
        data: {
          timerStartedAt: null,
          spentMinutes: ticket.spentMinutes + elapsedMinutes(ticket.timerStartedAt, now),
          ...activityStamp(now),
        },
      });
    }
    return this.get(id);
  }

  /** Company names already used, most frequent first. Feeds the autocomplete. */
  async companies(q: string | undefined): Promise<string[]> {
    const text = q?.trim();
    const rows = await this.prisma.ticket.groupBy({
      by: ['company'],
      where: text ? { company: { contains: text, mode: 'insensitive' } } : undefined,
      _count: { company: true },
      orderBy: { _count: { company: 'desc' } },
      take: 12,
    });
    return rows.map((r) => r.company);
  }

  /**
   * Loads what the input points to: its person, its module and the SLA of its priority.
   * A person or a module that does not exist is a 400.
   */
  private async lookups(dto: TicketInput): Promise<Omit<TicketUpdateContext, 'now'>> {
    const [assignee, module, sla] = await Promise.all([
      dto.assigneeId != null ? this.prisma.assignee.findUnique({ where: { id: dto.assigneeId }, select: { name: true } }) : null,
      dto.moduleId != null ? this.prisma.systemModule.findUnique({ where: { id: dto.moduleId }, select: baseInclude.module.select }) : null,
      dto.priority ? this.prisma.slaPolicy.findUnique({ where: { priority: dto.priority } }) : null,
    ]);
    if (dto.assigneeId != null && !assignee) throw new BadRequestException('El responsable no existe');
    if (dto.moduleId != null && !module) throw new BadRequestException('El módulo no existe');
    return { assigneeName: assignee?.name ?? null, moduleName: moduleName(module), slaHours: sla?.hours ?? null };
  }

  /**
   * The responsible a user is, for the cases they register without choosing one. Null for a user
   * who does not attend cases, and for one whose responsible was deactivated.
   */
  private async ownAssigneeId(userId: number): Promise<number | null> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { assignee: { select: { id: true, active: true } } } });
    return user?.assignee?.active ? user.assignee.id : null;
  }
}

/**
 * A case has two dates. `date` is the day the client reported the problem: a person
 * enters it and it can be in the past. `createdAt` is the moment the ticket was
 * registered here: always set by the server, never editable.
 * The reported day cannot be after today; one day of slack covers time-zone differences.
 */
function assertReportDate(date: string | undefined, now: Date): void {
  if (!date) return;
  const limit = new Date(todayDateOnly(now).getTime() + 86_400_000);
  if (parseDateOnly(date) > limit) throw new BadRequestException('La fecha del caso no puede ser posterior a hoy');
}

/** Deadline = registration time + hours of the priority's SLA. No SLA hours, no deadline. */
function slaDueAt(createdAt: Date, slaHours: number | null): Date | null {
  return slaHours === null ? null : new Date(createdAt.getTime() + slaHours * 3_600_000);
}

function cleanReply(reply: string | null): string | null {
  return reply?.trim() || null;
}

function elapsedMinutes(since: Date, now: Date): number {
  return Math.max(1, Math.round((now.getTime() - since.getTime()) / 60_000));
}
