import type { Assignee, Company, SupportType, SystemModule, Ticket, TicketDetail, TicketPage } from '../core/api';

/**
 * For specs: a case as the server answers it, whole. Case 7 of Acme, pending, reported on
 * 5 November 2026, with nothing else filled in: a spec gives only what its test is about.
 */
export function ticket(overrides: Partial<TicketDetail> = {}): TicketDetail {
  return {
    id: 7,
    code: 'SOP-00007',
    date: '2026-11-05',
    time: null,
    companyId: 1,
    company: 'Acme',
    description: 'No imprime',
    status: 'PENDING',
    assignees: [],
    supportTypes: [],
    priority: null,
    estimatedMinutes: null,
    spentMinutes: 0,
    timerStartedAt: null,
    moduleId: null,
    moduleName: null,
    dueAt: null,
    promisedDate: null,
    promiseState: null,
    resolvedAt: null,
    overdue: false,
    lastActivityAt: '2026-11-05T10:00:00.000Z',
    stale: false,
    aiGenerated: false,
    customerReply: null,
    createdAt: '2026-11-05T10:00:00.000Z',
    createdById: null,
    archivedAt: null,
    lastNote: null,
    notesCount: 0,
    attachmentsCount: 0,
    createdByName: null,
    notes: [],
    attachments: [],
    history: [],
    ...overrides,
  };
}

/** For specs: the first page of a list of cases that has these and no more. */
export function ticketPage(items: Ticket[], pageSize: number): TicketPage {
  return { items, total: items.length, page: 1, pageSize };
}

// The catalogs of the specs of the screens of cases: what their selects offer. One entry of each
// is deactivated: it keeps its cases and takes no new ones.
export const COMPANIES: Company[] = [
  { id: 1, name: 'Acme', active: true, tickets: 3 },
  { id: 5, name: 'Bodega Sur', active: true, tickets: 1 },
  { id: 6, name: 'Taller Viejo', active: false, tickets: 2 },
];
export const ASSIGNEES: Assignee[] = [
  { id: 4, name: 'Ana', active: true, tickets: 1 },
  { id: 5, name: 'Luis', active: true, tickets: 0 },
  { id: 6, name: 'Zoe', active: false, tickets: 2 },
];
/** The support types as a case carries them. */
export const TRAINING = { id: 1, name: 'Capacitación', color: '#12b76a' };
export const FAILURE = { id: 2, name: 'Falla del sistema', color: '#b91c1c' };
export const WARRANTY = { id: 3, name: 'Garantía', color: '#64748b' };
export const SUPPORT_TYPES: SupportType[] = [
  { ...TRAINING, active: true, tickets: 0 },
  { ...FAILURE, active: true, tickets: 4 },
  { ...WARRANTY, active: false, tickets: 1 },
];
export const MODULES: SystemModule[] = [
  { id: 1, name: 'Ventas', parentId: null, active: true, fullName: 'Ventas' },
  { id: 2, name: 'Facturas', parentId: 1, active: true, fullName: 'Ventas / Facturas' },
  { id: 8, name: 'Bodega vieja', parentId: null, active: false, fullName: 'Bodega vieja' },
];
