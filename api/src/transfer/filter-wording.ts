import { PRIORITY_LABEL, STATUS_LABEL, formatDateEs, parseDateOnly } from '../common/labels';
import type { ArchivedFilter, PromiseFilter, TicketFilters } from '../tickets/ticket-filters';

// How the PDF of the list says which cases it holds, worded from the filters its query runs with.

/** Names the description of the filters needs and the filters only carry as ids. Null when the id points to nothing. */
export interface FilterNames {
  assignee: string | null;
  company: string | null;
  /** With its parent, as the list shows it: "Ventas > Facturas". */
  module: string | null;
  supportType: string | null;
  /** The user of the "registered by" filter. */
  createdBy: string | null;
}

/** The fields of `TicketFilters` that choose which cases are listed. The others only order and page them. */
type FilterKey = Exclude<keyof TicketFilters, 'sort' | 'dir' | 'page' | 'pageSize'>;

const PROMISE_TEXT: Record<PromiseFilter, string> = {
  any: 'con promesa de entrega',
  overdue: 'promesa de entrega vencida',
  today: 'promesa de entrega para hoy',
  soon: 'promesa de entrega próxima',
  due: 'promesa de entrega vencida, para hoy o próxima',
};

const ARCHIVED_TEXT: Record<ArchivedFilter, string> = {
  only: 'Solo archivados',
  all: 'Incluye archivados',
};

/** A filter by the id of a record, worded with its name. An id that points to nothing says so. */
const named = (label: string, id: number, name: string | null): string => `${label}: ${name ?? `id ${id} (no existe)`}`;

/**
 * How the PDF header words each filter, in the order it prints them. The type asks for one entry per
 * filter of `TicketFilters`: a filter added to the list does not compile until it is worded here,
 * so a filtered PDF cannot be headed "Sin filtros".
 */
const FILTER_TEXT: { [K in FilterKey]: (value: NonNullable<TicketFilters[K]>, names: FilterNames) => string } = {
  status: (statuses) => `Estado: ${statuses.map((status) => STATUS_LABEL[status]).join(', ')}`,
  assignee: (assignee, names) => (assignee === 'none' ? 'Responsable: sin asignar' : named('Responsable', assignee, names.assignee)),
  companyId: (id, names) => named('Empresa', id, names.company),
  priority: (priority) => `Prioridad: ${PRIORITY_LABEL[priority]}`,
  moduleId: (id, names) => named('Módulo', id, names.module),
  supportType: (id, names) => named('Tipo de soporte', id, names.supportType),
  createdBy: (id, names) => named('Registrado por', id, names.createdBy),
  from: (day) => `Desde: ${formatDateEs(parseDateOnly(day))}`,
  to: (day) => `Hasta: ${formatDateEs(parseDateOnly(day))}`,
  overdue: () => 'Solo vencidos',
  stale: () => 'Solo olvidados',
  promise: (promise) => `Solo ${PROMISE_TEXT[promise]}`,
  archived: (archived) => ARCHIVED_TEXT[archived],
  q: (text) => `Búsqueda: "${text}"`,
};

/** As in `buildWhere`, a field that is switched off or empty does not filter, the same as an absent one. */
function filtersNothing(value: unknown): boolean {
  return value === false || value === '' || (Array.isArray(value) && !value.length);
}

/**
 * The "Filtros" line of the PDF, worded from the same filters its query runs with.
 * Empty when nothing filters.
 */
export function describeFilters(filters: TicketFilters, names: FilterNames): string {
  const text = <K extends FilterKey>(key: K): string | null => {
    const value = filters[key];
    return value == null || filtersNothing(value) ? null : FILTER_TEXT[key](value, names);
  };
  return (Object.keys(FILTER_TEXT) as FilterKey[])
    .map(text)
    .filter((part) => part !== null)
    .join('  ·  ');
}

/**
 * First line of the PDF: which cases it lists. Unless the filter of archived cases asks for them,
 * they are not in the file, and the line says so: "todos los casos" alone would promise them too.
 */
export function describeSelection(filters: TicketFilters, names: FilterNames): string {
  const line = describeFilters(filters, names);
  if (filters.archived) return `Filtros: ${line}`;
  return line ? `Filtros: ${line}  ·  Sin archivados` : 'Sin filtros: todos los casos sin archivar';
}
