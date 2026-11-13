import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Priority, TicketFilters, TicketStatus } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { SELECT } from '../../core/select';
import { TypeChip } from '../../core/type-chip';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL } from '../../core/ui';

/** Delivery promise filter: any promise, or the open cases whose promise stands at that point. */
export type PromiseFilter = 'any' | 'due' | 'overdue' | 'today' | 'soon';
/** Which cases are listed as to being archived: the ones that are not, only the ones that are, or all. */
export type ArchivedFilter = 'active' | 'only' | 'all';

/** The filters of the case list, each as its control holds it. Null, empty or false: that filter is off. */
export interface ListFilters {
  status: TicketStatus | null;
  /** A responsible, or `none` for the cases nobody has. */
  assignee: number | 'none' | null;
  companyId: number | null;
  moduleId: number | null;
  priority: Priority | null;
  supportType: number | null;
  /** The user who registered the case. */
  createdBy: number | null;
  /** Range of the case date, `YYYY-MM-DD`. */
  from: string;
  to: string;
  promise: PromiseFilter | null;
  overdue: boolean;
  /** Forgotten cases: open and without activity for the time set in Configuración. */
  stale: boolean;
  archived: ArchivedFilter;
}

/** The list as it opens: every case that is not archived. */
export const NO_FILTERS: ListFilters = {
  status: null,
  assignee: null,
  companyId: null,
  moduleId: null,
  priority: null,
  supportType: null,
  createdBy: null,
  from: '',
  to: '',
  promise: null,
  overdue: false,
  stale: false,
  archived: 'active',
};

export const PROMISE_OPTIONS: readonly { id: PromiseFilter; label: string }[] = [
  { id: 'any', label: 'Con promesa de entrega' },
  { id: 'due', label: 'Por atender (vencidas, hoy y próximas)' },
  { id: 'overdue', label: 'Vencida' },
  { id: 'today', label: 'Para hoy' },
  { id: 'soon', label: 'Próxima' },
];

const ARCHIVED_OPTIONS: readonly { id: ArchivedFilter; label: string }[] = [
  { id: 'active', label: 'Activos' },
  { id: 'only', label: 'Archivados' },
  { id: 'all', label: 'Todos' },
];

/** The filters as the API takes them. One that is off is not sent. */
export function filterQuery(filters: ListFilters): TicketFilters {
  return {
    status: filters.status ?? undefined,
    assignee: filters.assignee,
    companyId: filters.companyId,
    moduleId: filters.moduleId,
    priority: filters.priority,
    supportType: filters.supportType,
    createdBy: filters.createdBy,
    from: filters.from || undefined,
    to: filters.to || undefined,
    promise: filters.promise ?? undefined,
    overdue: filters.overdue ? '1' : undefined,
    stale: filters.stale ? '1' : undefined,
    // Without the parameter the API lists the cases that are not archived.
    archived: filters.archived === 'active' ? undefined : filters.archived,
  };
}

/** How many filters are on. The two ends of the date range are one filter. */
export function activeFilters(filters: ListFilters): number {
  const on = [
    filters.status,
    filters.assignee,
    filters.companyId,
    filters.moduleId,
    filters.priority,
    filters.supportType,
    filters.createdBy,
    filters.from || filters.to,
    filters.promise,
    filters.overdue,
    filters.stale,
    filters.archived !== 'active',
  ];
  return on.filter(Boolean).length;
}

/**
 * The filters of the case list, shown and hidden with its "Filtros" button. Each control changes
 * the list at once. The search box is not here: it is always in view.
 */
@Component({
  selector: 'app-ticket-filters',
  imports: [FormsModule, ...SELECT, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Aligned at the bottom: a label that takes two lines on a narrow screen does not push its control out of the row.
  host: { id: 'ticket-filters', role: 'group', 'aria-label': 'Filtros', class: 'grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6' },
  template: `
    @let f = filters();
    <!-- Every list of options hangs from the body: inside the page it would be cut where the page scrolls. -->
    <div>
      <label class="label" for="tf-status">Estado</label>
      <ng-select
        labelForId="tf-status"
        bindValue="id"
        bindLabel="label"
        placeholder="Todos"
        appendTo="body"
        [items]="statusOptions"
        [searchable]="false"
        [ngModel]="f.status"
        (ngModelChange)="set('status', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-assignee">Responsable</label>
      <ng-select
        labelForId="tf-assignee"
        bindValue="id"
        bindLabel="name"
        placeholder="Todos"
        appendTo="body"
        [items]="assigneeOptions()"
        [ngModel]="f.assignee"
        (ngModelChange)="set('assignee', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-company">Empresa</label>
      <ng-select
        labelForId="tf-company"
        bindValue="id"
        bindLabel="name"
        placeholder="Todas"
        appendTo="body"
        [items]="catalogs.companies()"
        [ngModel]="f.companyId"
        (ngModelChange)="set('companyId', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-module">Módulo</label>
      <ng-select
        labelForId="tf-module"
        bindValue="id"
        bindLabel="fullName"
        placeholder="Todos"
        appendTo="body"
        [items]="catalogs.modules()"
        [ngModel]="f.moduleId"
        (ngModelChange)="set('moduleId', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-priority">Prioridad</label>
      <ng-select
        labelForId="tf-priority"
        bindValue="id"
        bindLabel="label"
        placeholder="Todas"
        appendTo="body"
        [items]="priorityOptions"
        [searchable]="false"
        [ngModel]="f.priority"
        (ngModelChange)="set('priority', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-type">Tipo de soporte</label>
      <ng-select
        labelForId="tf-type"
        bindValue="id"
        bindLabel="name"
        placeholder="Todos"
        appendTo="body"
        [items]="catalogs.supportTypes()"
        [ngModel]="f.supportType"
        (ngModelChange)="set('supportType', $event)"
      >
        <ng-template ng-label-tmp let-item="item">
          <app-type-chip [type]="item" />
        </ng-template>
        <ng-template ng-option-tmp let-item="item">
          <app-type-chip [type]="item" />
        </ng-template>
      </ng-select>
    </div>
    <div>
      <label class="label" for="tf-created-by" title="El usuario que registró el caso">Registrado por</label>
      <ng-select
        labelForId="tf-created-by"
        bindValue="id"
        bindLabel="name"
        placeholder="Todos"
        appendTo="body"
        [items]="catalogs.users()"
        [ngModel]="f.createdBy"
        (ngModelChange)="set('createdBy', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-from" title="Fecha del caso desde">Desde</label>
      <input id="tf-from" class="input" type="date" [ngModel]="f.from" (ngModelChange)="set('from', $event)" />
    </div>
    <div>
      <label class="label" for="tf-to" title="Fecha del caso hasta">Hasta</label>
      <input id="tf-to" class="input" type="date" [ngModel]="f.to" (ngModelChange)="set('to', $event)" />
    </div>
    <div>
      <label class="label" for="tf-promise" title="Promesa de entrega al cliente">Promesa de entrega</label>
      <ng-select
        labelForId="tf-promise"
        bindValue="id"
        bindLabel="label"
        placeholder="Todas"
        appendTo="body"
        [items]="promiseOptions"
        [searchable]="false"
        [ngModel]="f.promise"
        (ngModelChange)="set('promise', $event)"
      />
    </div>
    <div>
      <label class="label" for="tf-archived">Archivados</label>
      <!-- Always one of the three: the list starts on the cases that are not archived. -->
      <ng-select
        labelForId="tf-archived"
        bindValue="id"
        bindLabel="label"
        appendTo="body"
        [items]="archivedOptions"
        [clearable]="false"
        [searchable]="false"
        [ngModel]="f.archived"
        (ngModelChange)="set('archived', $event)"
      />
    </div>
    <div class="col-span-full flex flex-wrap items-center gap-x-4 gap-y-1">
      <label class="flex cursor-pointer items-center gap-1.5 py-1 text-xs" title="Abiertos y con la fecha límite de su prioridad ya pasada">
        <input type="checkbox" class="accent-danger" [ngModel]="f.overdue" (ngModelChange)="set('overdue', $event)" />
        Vencidos
      </label>
      <label class="flex cursor-pointer items-center gap-1.5 py-1 text-xs" title="Abiertos y sin movimiento desde hace más del tiempo configurado en Recordatorios">
        <input type="checkbox" class="accent-warning" [ngModel]="f.stale" (ngModelChange)="set('stale', $event)" />
        Olvidados
      </label>
      <button type="button" class="btn btn-ghost ml-auto px-2 py-1 text-xs" [disabled]="!canClear()" (click)="cleared.emit()">
        <i class="mdi mdi-filter-off-outline" aria-hidden="true"></i>
        Limpiar filtros
      </button>
    </div>
  `,
})
export class TicketFiltersPanel {
  protected readonly catalogs = inject(Catalogs);

  readonly filters = model.required<ListFilters>();
  /** There is something to clear: a filter of the panel, or a text in the search box, which "Limpiar filtros" empties too. */
  readonly canClear = input(false);
  /** "Limpiar filtros" was pressed. The list clears them: the search box is its own. */
  readonly cleared = output<void>();

  protected readonly statusOptions = STATUSES.map((id) => ({ id, label: STATUS_LABEL[id] }));
  protected readonly priorityOptions = PRIORITIES.map((id) => ({ id, label: PRIORITY_LABEL[id] }));
  protected readonly promiseOptions = PROMISE_OPTIONS;
  protected readonly archivedOptions = ARCHIVED_OPTIONS;
  /** Everyone of the catalog, active or not (their cases are still theirs), and the cases nobody has. */
  protected readonly assigneeOptions = computed<{ id: number | 'none'; name: string }[]>(() => [{ id: 'none', name: 'Sin asignar' }, ...this.catalogs.assignees()]);

  protected set<K extends keyof ListFilters>(field: K, value: ListFilters[K]): void {
    this.filters.update((filters) => ({ ...filters, [field]: value }));
  }
}
