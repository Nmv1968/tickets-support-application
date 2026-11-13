import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, model, signal } from '@angular/core';

export type ColumnId =
  | 'code'
  | 'date'
  | 'createdAt'
  | 'company'
  | 'description'
  | 'status'
  | 'assignee'
  | 'priority'
  | 'module'
  | 'supportTypes'
  | 'promisedDate'
  | 'dueAt'
  | 'estimatedMinutes'
  | 'spentMinutes'
  | 'lastNote'
  | 'createdBy'
  | 'lastActivityAt';

export interface Column {
  id: ColumnId;
  /** Its header in the table, and its name where the columns are chosen. */
  label: string;
  /** What the header says of the column when the pointer is on it. */
  hint?: string;
  /** Width in the table, in px. Null: it shares with the other such columns the room the rest leave. */
  width: number | null;
}

/** The least a column without a width of its own gets. Below that the table scrolls sideways. */
const SHARED_MIN_WIDTH = 160;

/**
 * Every column the case list can show, in the order the table has them. The widths are as tight
 * as their content allows, cells padded 8 px a side: the columns a person starts with have to
 * fit a laptop screen without scrolling sideways (1366 px wide, with the menu at its side), and
 * still leave Descripción and Observación room to be read.
 *
 * What sets each one: the "Archivado" badge under the code, a date, the widest status badge, a
 * support type of some twenty letters, and the header itself for the ones with little to say.
 * Names (company, responsible, module) wrap, so theirs is a matter of how many lines they take.
 */
export const COLUMNS: readonly Column[] = [
  { id: 'code', label: 'Código', width: 88 },
  { id: 'date', label: 'Fecha del caso', hint: 'Día en que el cliente reportó el problema', width: 100 },
  { id: 'createdAt', label: 'Registro', hint: 'Día en que se registró el ticket en este sistema. Automática', width: 88 },
  { id: 'company', label: 'Empresa', width: 136 },
  { id: 'description', label: 'Descripción', width: null },
  { id: 'status', label: 'Estado', width: 96 },
  { id: 'assignee', label: 'Responsable', width: 116 },
  { id: 'priority', label: 'Prioridad', width: 92 },
  { id: 'module', label: 'Módulo', width: 142 },
  { id: 'supportTypes', label: 'Tipos de soporte', width: 128 },
  { id: 'promisedDate', label: 'Promesa de entrega', hint: 'Día en que se le prometió al cliente tener el caso resuelto', width: 140 },
  { id: 'dueAt', label: 'Fecha límite', hint: 'Fecha límite del caso según el SLA de su prioridad', width: 124 },
  { id: 'estimatedMinutes', label: 'Tiempo estimado', width: 120 },
  { id: 'spentMinutes', label: 'Tiempo real', width: 96 },
  { id: 'lastNote', label: 'Observación', hint: 'La última observación del caso', width: null },
  { id: 'createdBy', label: 'Registrado por', width: 132 },
  { id: 'lastActivityAt', label: 'Última actividad', hint: 'Último cambio, observación o adjunto del caso', width: 124 },
];

/** The column that says which case a row is: it cannot be hidden. */
export const FIXED_COLUMN: ColumnId = 'code';

/** What a person who never chose sees: the columns the list always had, and the support types. */
export const DEFAULT_COLUMNS: readonly ColumnId[] = ['code', 'date', 'createdAt', 'company', 'description', 'status', 'assignee', 'supportTypes', 'lastNote'];

/** The columns a person chose to see, as their preference `tickets.columns` keeps them. */
export interface ColumnChoice {
  visible: ColumnId[];
}

/** These columns as a choice: in the order of the table, each once, and never without the fixed one. */
export function choiceOf(ids: readonly unknown[]): ColumnChoice {
  return { visible: COLUMNS.filter((column) => column.id === FIXED_COLUMN || ids.includes(column.id)).map((column) => column.id) };
}

/**
 * Reads a stored choice of columns. A column this version does not have (one that was renamed
 * or removed, or anything else that got in there) is left out. Null for what is not a choice at all.
 */
export function readColumnChoice(stored: unknown): ColumnChoice | null {
  const ids = (stored as { visible?: unknown } | null)?.visible;
  return Array.isArray(ids) ? choiceOf(ids) : null;
}

/** Width the table needs to show these columns without squeezing them. */
export function tableWidth(columns: readonly Column[]): number {
  return columns.reduce((width, column) => width + (column.width ?? SHARED_MIN_WIDTH), 0);
}

/**
 * The "Columnas" button of the case list and what it opens: a checkbox per column and
 * "Restablecer". It only says which columns the person wants. Keeping that choice, for them
 * alone, is up to the list.
 */
@Component({
  selector: 'app-ticket-columns',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative', '(document:pointerdown)': 'onPointerDown($event)', '(document:keydown.escape)': 'onEscape()' },
  template: `
    <!-- On a phone it shows only its icon, so it carries its name apart from the text. -->
    <button type="button" class="btn btn-soft" aria-label="Columnas" title="Elegir qué columnas ver" aria-controls="ticket-columns" [attr.aria-expanded]="open()" (click)="open.set(!open())">
      <i class="mdi mdi-view-column-outline text-base" aria-hidden="true"></i>
      <span class="hidden sm:inline">Columnas</span>
    </button>
    @if (open()) {
      <div id="ticket-columns" class="card absolute right-0 z-30 mt-1 w-64 max-w-[calc(100vw-2rem)] p-1.5" role="group" aria-label="Columnas de la lista">
        <!-- Its own scroll: the list is longer than a small screen is tall. -->
        <div class="max-h-[55dvh] overflow-y-auto">
          @for (column of columns; track column.id) {
            <label class="flex items-center gap-2 rounded-lg px-2 py-1.5" [class]="column.id === fixed ? 'text-muted' : 'cursor-pointer hover:bg-elevated'">
              <input type="checkbox" class="accent-primary" [checked]="shown().has(column.id)" [disabled]="column.id === fixed" (change)="toggle(column.id)" />
              <span class="flex-1">{{ column.label }}</span>
              @if (column.id === fixed) {
                <span class="text-2xs">Siempre visible</span>
              }
            </label>
          }
        </div>
        <div class="mt-1 flex items-center gap-2 border-t border-line px-2 pt-1.5">
          <p class="flex-1 text-2xs text-muted">Se guarda solo para tu usuario.</p>
          <button type="button" class="btn btn-ghost px-2 py-1 text-xs" [disabled]="isDefault()" title="Volver a las columnas iniciales" (click)="reset()">
            <i class="mdi mdi-restore" aria-hidden="true"></i>
            Restablecer
          </button>
        </div>
      </div>
    }
  `,
})
export class TicketColumnsMenu {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  /** The columns on show, in the order of the table. */
  readonly visible = model.required<readonly ColumnId[]>();

  protected readonly columns = COLUMNS;
  protected readonly fixed = FIXED_COLUMN;
  protected readonly open = signal(false);
  protected readonly shown = computed(() => new Set(this.visible()));
  protected readonly isDefault = computed(() => this.visible().join() === DEFAULT_COLUMNS.join());

  protected toggle(id: ColumnId): void {
    const shown = new Set(this.visible());
    // Taken out when it was there, put in when it was not.
    if (!shown.delete(id)) shown.add(id);
    this.visible.set(choiceOf([...shown]).visible);
  }

  protected reset(): void {
    this.visible.set([...DEFAULT_COLUMNS]);
  }

  /** A press anywhere else closes it. The press and not the click: Safari on iOS sends no click for a tap on plain content. */
  protected onPointerDown(event: PointerEvent): void {
    if (this.open() && !this.host.contains(event.target as Node)) this.open.set(false);
  }

  /** Escape closes it. The focus goes back to its button: on a checkbox it would be lost with the list. */
  protected onEscape(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.host.querySelector('button')?.focus();
  }
}
