import { BadRequestException } from '@nestjs/common';
import type { Priority, Prisma, TicketStatus } from '@prisma/client';
import { PRIORITIES, STATUSES, isDateOnly, parseDateOnly, searchKey, todayDateOnly } from '../common/labels';
import type { ReminderRules } from '../settings/settings.service';

// Which cases a list shows and in what order: the query string read into `TicketFilters`, and the
// filters turned into a query. The list, the exports, the reminders and the dashboard all go
// through here.

/** Query string of a list of cases as it arrives: untrusted, and a repeated parameter is an array. */
export type TicketQuery = Record<string, unknown>;

/** Promised delivery date. `due` is what the bell shows: overdue, today and, when configured, soon. */
export type PromiseFilter = 'any' | 'overdue' | 'today' | 'soon' | 'due';
export type ArchivedFilter = 'only' | 'all';
export type TicketSort = 'date' | 'company' | 'status';

/**
 * Filters, order and page of a list of cases, already validated: the list, the exports and the
 * dashboard all read this, never the query string. Each field is named after its query parameter;
 * an absent field does not filter, except `archived`. Comes from `parseTicketFilters`, or is
 * written by hand in code.
 */
export type TicketFilters = {
  status?: TicketStatus[];
  /** Cases this person is responsible for, alone or with others. `none` for the cases nobody is responsible for. */
  assignee?: number | 'none';
  companyId?: number;
  priority?: Priority;
  moduleId?: number;
  /** Cases that carry this support type, alone or with others. */
  supportType?: number;
  /** Cases registered by this user. */
  createdBy?: number;
  /** Absent, only the cases that are not archived. `only` the archived ones, `all` both. */
  archived?: ArchivedFilter;
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
const ARCHIVED_FILTERS: ArchivedFilter[] = ['only', 'all'];
const SORTS: TicketSort[] = ['date', 'company', 'status'];
const DIRECTIONS: Prisma.SortOrder[] = ['asc', 'desc'];
export const DEFAULT_PAGE_SIZE = 50;
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
    assignee: oneOf('assignee', ['none'] as const) ?? int('assignee'),
    companyId: int('companyId'),
    priority: oneOf('priority', PRIORITIES),
    moduleId: int('moduleId'),
    supportType: int('supportType'),
    createdBy: int('createdBy'),
    archived: oneOf('archived', ARCHIVED_FILTERS),
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

/** `rules` (see SettingsService.reminderRules) are needed only for the `stale` and `promise` filters. */
export function buildWhere(filters: TicketFilters, rules: ReminderRules = { staleBefore: null, promiseSoonDays: 0 }): Prisma.TicketWhereInput {
  const and: Prisma.TicketWhereInput[] = [];
  const none: Prisma.TicketWhereInput = { id: -1 };
  const open: Prisma.TicketWhereInput = { status: { not: 'RESOLVED' } };

  // An archived case is out of every list, export and reminder unless the filter asks for it.
  if (filters.archived === 'only') and.push({ archivedAt: { not: null } });
  else if (filters.archived !== 'all') and.push({ archivedAt: null });

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

  if (filters.assignee === 'none') and.push({ assignees: { none: {} } });
  else if (filters.assignee !== undefined) and.push({ assignees: { some: { assigneeId: filters.assignee } } });

  if (filters.companyId !== undefined) and.push({ companyId: filters.companyId });
  if (filters.priority) and.push({ priority: filters.priority });
  if (filters.moduleId !== undefined) and.push({ moduleId: filters.moduleId });
  if (filters.supportType !== undefined) and.push({ supportTypes: { some: { supportTypeId: filters.supportType } } });
  if (filters.createdBy !== undefined) and.push({ createdById: filters.createdBy });
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

/**
 * Order of a list of cases. By default the ticket number, highest first: the newest ticket on top.
 * `dir=asc` reverses it; `sort=date|company|status` orders by that field instead.
 */
export function ticketOrder(filters: TicketFilters): Prisma.TicketOrderByWithRelationInput[] {
  const dir = filters.dir ?? 'desc';
  if (!filters.sort) return [{ id: dir }];
  // Within a day, the cases that have a time go by it; the ones without it come after them.
  if (filters.sort === 'date') return [{ date: dir }, { time: { sort: dir, nulls: 'last' } }, { id: 'asc' }];
  // By the name of the company, which is what the list shows; its id says nothing to a person. By
  // its key, not by the name itself: the database compares text by code point, and would put
  // "Óptica" and "acme" after "Zapatería". See `Company.sortKey`.
  if (filters.sort === 'company') return [{ company: { sortKey: dir } }, { id: 'asc' }];
  return [{ [filters.sort]: dir }, { id: 'asc' }];
}
