import { day } from '../common/testing';
import type { StoredTicket } from './ticket-mappers';

// What the tests of the cases share. Only tests load this file: the build leaves it out
// (tsconfig.build.json).

/** Built from local time, so "today" is 11/11/2026 whatever time zone the tests run in. */
export const NOW = new Date(2026, 10, 11, 10, 0, 0);
export const TODAY = day('2026-11-11');

// Three support types of the catalog. By name they go: Capacitación, Error de usuario, Falla del sistema.
export const TRAINING = { id: 1, name: 'Capacitación', color: '#0c7beb' };
export const FAILURE = { id: 2, name: 'Falla del sistema', color: '#e5484d' };
export const USER_ERROR = { id: 3, name: 'Error de usuario', color: '#b97a00' };
export type SupportTypeRow = typeof TRAINING;
/** The support types of a case as the database returns them: one row per type the case carries. */
export const carrying = (...types: SupportTypeRow[]): StoredTicket['supportTypes'] => types.map((supportType) => ({ supportType }));

/** A case as stored. */
export const stored = (changes: Partial<StoredTicket> = {}): StoredTicket => ({
  id: 7,
  date: day('2026-11-02'),
  time: null,
  companyId: 2,
  company: { id: 2, name: 'ACME' },
  description: 'No abre la factura',
  searchText: 'acme no abre la factura',
  status: 'PENDING',
  assigneeId: 3,
  assignee: { id: 3, name: 'Ana' },
  supportTypes: [],
  priority: null,
  estimatedMinutes: null,
  spentMinutes: 10,
  timerStartedAt: null,
  moduleId: null,
  module: null,
  dueAt: null,
  promisedDate: null,
  resolvedAt: null,
  aiGenerated: false,
  customerReply: null,
  createdById: 3,
  createdAt: new Date('2026-11-02T14:00:00.000Z'),
  lastActivityAt: new Date('2026-11-03T09:00:00.000Z'),
  updatedAt: new Date('2026-11-03T09:00:00.000Z'),
  archivedAt: null,
  ...changes,
});
