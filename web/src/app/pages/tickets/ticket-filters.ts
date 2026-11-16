import { ChangeDetectionStrategy, Component, computed, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { Priority, TicketFilters, TicketStatus } from '../../core/api';
import { Auth } from '../../core/auth';
import { AssigneeSelect, CompanySelect, ModuleSelect, PrioritySelect, StatusSelect, SupportTypeSelect } from '../../core/case-selects';
import { Catalogs } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { SELECT } from '../../core/select';

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
  imports: [FormsModule, ...SELECT, CompanySelect, StatusSelect, AssigneeSelect, PrioritySelect, ModuleSelect, SupportTypeSelect, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Aligned at the bottom: a label that takes two lines on a narrow screen does not push its control out of the row.
  host: { id: 'ticket-filters', role: 'group', 'aria-label': 'Filtros', class: 'grid grid-cols-2 items-end gap-x-3 gap-y-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6' },
  template: `
    @let f = filters();
    <!--
      Every entry of each catalog, active or not: the cases of an inactive one are still listed.
      Every list of options hangs from the body: inside the page it would be cut where the page scrolls.
    -->
    <div>
      <label class="label" for="tf-status">Estado</label>
      <app-status-select inputId="tf-status" placeholder="Todos" clearable [value]="f.status" (valueChange)="set('status', $event)" />
    </div>
    <div>
      <label class="label" for="tf-assignee">Responsable</label>
      <app-assignee-select inputId="tf-assignee" placeholder="Todos" [items]="catalogs.assigneeFilterOptions()" [value]="f.assignee" (valueChange)="set('assignee', $event)" />
    </div>
    <div>
      <label class="label" for="tf-company">Empresa</label>
      <app-company-select inputId="tf-company" placeholder="Todas" [items]="catalogs.companies()" [value]="f.companyId" (valueChange)="set('companyId', $event)" />
    </div>
    <div>
      <label class="label" for="tf-module">Módulo</label>
      <app-module-select inputId="tf-module" placeholder="Todos" [items]="catalogs.modules()" [value]="f.moduleId" (valueChange)="set('moduleId', $event)" />
    </div>
    <div>
      <label class="label" for="tf-priority">Prioridad</label>
      <app-priority-select inputId="tf-priority" placeholder="Todas" [value]="f.priority" (valueChange)="set('priority', $event)" />
    </div>
    <div>
      <label class="label" for="tf-type">Tipo de soporte</label>
      <app-support-type-select inputId="tf-type" placeholder="Todos" [items]="catalogs.supportTypes()" [value]="f.supportType" (valueChange)="set('supportType', $event)" />
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
      <label class="flex cursor-pointer items-center gap-1.5 py-1 text-xs" [title]="staleHint()">
        <input type="checkbox" class="accent-warning" [ngModel]="f.stale" (ngModelChange)="set('stale', $event)" />
        Olvidados
      </label>
      <button type="button" class="btn btn-ghost ml-auto px-2 py-1 text-xs" [disabled]="!canClear()" (click)="cleared.emit()">
        <app-icon name="filter-off-outline" />
        Limpiar filtros
      </button>
    </div>
  `,
})
export class TicketFiltersPanel {
  protected readonly catalogs = inject(Catalogs);
  private readonly auth = inject(Auth);

  readonly filters = model.required<ListFilters>();
  /** There is something to clear: a filter of the panel, or a text in the search box, which "Limpiar filtros" empties too. */
  readonly canClear = input(false);
  /** "Limpiar filtros" was pressed. The list clears them: the search box is its own. */
  readonly cleared = output<void>();

  protected readonly promiseOptions = PROMISE_OPTIONS;
  protected readonly archivedOptions = ARCHIVED_OPTIONS;
  /** What "Olvidados" means. Configuración > Recordatorios, where its time is set, is a tab of administrators. */
  protected readonly staleHint = computed(() =>
    this.auth.isAdmin()
      ? 'Abiertos y sin movimiento desde hace más del tiempo configurado en Configuración > Recordatorios'
      : 'Abiertos y sin movimiento desde hace más del tiempo que un administrador fija en Configuración > Recordatorios',
  );

  protected set<K extends keyof ListFilters>(field: K, value: ListFilters[K]): void {
    this.filters.update((filters) => ({ ...filters, [field]: value }));
  }
}
