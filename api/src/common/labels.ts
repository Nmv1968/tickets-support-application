import { Priority, TicketStatus } from '@prisma/client';

export const STATUS_LABEL: Record<TicketStatus, string> = {
  UNRESOLVED: 'Sin resolver',
  PENDING: 'Pendiente',
  RESOLVED: 'Resuelto',
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  LOW: 'Baja',
  MEDIUM: 'Media',
  HIGH: 'Alta',
  CRITICAL: 'Crítica',
};

export const PRIORITIES: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const STATUSES: TicketStatus[] = ['UNRESOLVED', 'PENDING', 'RESOLVED'];

/**
 * Lowercase, no accents, single spaces. Stored next to searchable text and applied
 * to the query, so "corporacion" finds "CORPORACIÓN" whatever the database locale is.
 */
export function searchKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Value of `Ticket.searchText`. Every write of a case's company or description stores this next
 * to them: a case saved without it never shows up in the search box.
 */
export function ticketSearchKey(company: string, description: string): string {
  return searchKey(`${company} ${description}`);
}

/** Value of `TicketNote.searchText`. Every write of an observation's text stores this next to it. */
export function noteSearchKey(text: string): string {
  return searchKey(text);
}

/** Name of a module as people read it everywhere: "Ventas > Facturas" for a submodule, "Ventas" for a top one. */
export function moduleFullName(module: { name: string; parent?: { name: string } | null }): string {
  return module.parent ? `${module.parent.name} > ${module.name}` : module.name;
}

export function ticketCode(id: number): string {
  return `SOP-${String(id).padStart(5, '0')}`;
}

/** Case dates are calendar dates: stored at UTC midnight and exchanged as `YYYY-MM-DD`. */
export function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

export function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

/**
 * True only for a day that exists, written `YYYY-MM-DD`. The shape alone is not enough:
 * "2026-13-45" has it, and JavaScript quietly reads "2026-02-30" as March 2nd.
 */
export function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseDateOnly(value);
  return !Number.isNaN(date.getTime()) && formatDateOnly(date) === value;
}

/** True for a time of day written `HH:mm` on the 24-hour clock, from 00:00 to 23:59. */
export function isTimeOnly(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** `DD/MM/YYYY` for exports. */
export function formatDateEs(value: Date | null | undefined): string {
  if (!value) return '';
  const [y, m, d] = formatDateOnly(value).split('-');
  return `${d}/${m}/${y}`;
}

/** `DD/MM/YYYY` of a moment in time, in the server's time zone. For timestamps, not for case dates. */
export function formatMomentEs(value: Date | null | undefined): string {
  if (!value) return '';
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}`;
}

export function todayDateOnly(now: Date = new Date()): Date {
  // Local calendar day of the server (TZ env), kept as a UTC-midnight date.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
