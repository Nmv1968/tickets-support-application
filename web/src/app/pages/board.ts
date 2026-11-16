import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import type { Ticket, TicketStatus } from '../core/api';
import { AssigneeSelect } from '../core/case-selects';
import { Catalogs } from '../core/catalogs';
import { Icon } from '../core/icon';
import { liveResource } from '../core/loading';
import { TicketEvents } from '../core/ticket-events';
import type { TicketEvent } from '../core/ticket-events';
import { StatusBadge } from '../core/status-badge';
import { TicketFlags } from '../core/ticket-flags';
import { Toast } from '../core/toast';
import { TypeChip } from '../core/type-chip';
import { STATUSES, STATUS_LABEL, formatCaseDate } from '../core/ui';
import { TicketPanel } from './tickets/ticket-panel';

const RESOLVED_SHOWN = 30;
/** Open cases asked for in one request: the largest page the API serves. */
const OPEN_LIMIT = 500;

/**
 * Kanban: one column per status. Dragging a card changes the status of the case, at once: it is
 * the one change made outside the form of the case. Archived cases are never on the board.
 */
@Component({
  selector: 'app-board',
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, AssigneeSelect, StatusBadge, TicketFlags, TypeChip, TicketPanel, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col gap-3 p-3 md:p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="mr-auto text-lg font-semibold">Tablero</h1>
        <input class="input w-56" type="search" placeholder="Buscar en el tablero" aria-label="Buscar en el tablero" [(ngModel)]="search" />
        <app-assignee-select class="w-56" ariaLabel="Filtrar por responsable" placeholder="Responsable: todos" [items]="catalogs.assigneeFilterOptions()" [(value)]="assignee" />
        <button type="button" class="btn btn-soft px-2.5" (click)="board.refresh()" aria-label="Actualizar">
          <app-icon name="refresh" class="text-base" [spin]="loading()" />
        </button>
      </div>

      @if (openLeftOut() > 0) {
        <p class="rounded-control bg-warning/10 px-3 py-2 text-xs" role="status">
          <app-icon name="alert-outline" class="text-warning" />
          El tablero muestra solo los {{ openLimit }} casos abiertos más recientes. Faltan {{ openLeftOut() }} más antiguos: búscalos en la lista de Casos.
        </p>
      }

      <div class="flex min-h-0 flex-1 gap-3 overflow-x-auto" cdkDropListGroup>
        @for (column of columns(); track column.status) {
          <section class="flex w-80 shrink-0 flex-col rounded-card bg-elevated md:w-auto md:flex-1" [attr.aria-label]="statusLabel[column.status]">
            <header class="flex items-center gap-2 px-3 py-2.5">
              <span appStatusBadge [status]="column.status"></span>
              <span class="text-xs text-muted">{{ column.tickets.length }}</span>
              @if (column.status === 'RESOLVED') {
                <span class="ml-auto text-2xs text-muted">últimos {{ resolvedShown }}</span>
              }
            </header>
            <div
              class="min-h-24 flex-1 space-y-2 overflow-y-auto rounded-card p-2"
              cdkDropList
              cdkDropListSortingDisabled
              [cdkDropListData]="column.status"
              (cdkDropListDropped)="drop($event)"
            >
              @for (t of column.tickets; track t.id) {
                <!-- A button to the keyboard and to who hears the page: Enter and Space open the case. Space would otherwise scroll the column. -->
                <article
                  class="card cursor-grab p-2.5 active:cursor-grabbing"
                  cdkDrag
                  [cdkDragData]="t"
                  [cdkDragStartDelay]="{ touch: 200, mouse: 0 }"
                  role="button"
                  tabindex="0"
                  (click)="openId.set(t.id)"
                  (keydown.enter)="openId.set(t.id)"
                  (keydown.space)="$event.preventDefault(); openId.set(t.id)"
                >
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="font-mono text-primary">{{ t.code }}</span>
                    <span class="text-muted">{{ formatCaseDate(t) }}</span>
                    <app-ticket-flags class="ml-auto" [ticket]="t" />
                  </div>
                  <div class="mt-1 font-medium">{{ t.company }}</div>
                  <p class="line-clamp-3 text-muted">{{ t.description }}</p>
                  @if (t.supportTypes.length) {
                    <div class="mt-1.5 flex flex-wrap gap-1">
                      @for (type of t.supportTypes; track type.id) {
                        <app-type-chip [type]="type" />
                      }
                    </div>
                  }
                  <div class="mt-1.5 flex items-center gap-1 text-xs text-muted">
                    <app-icon name="account-outline" />
                    <span class="truncate">{{ t.assigneeName ?? 'Sin asignar' }}</span>
                    @if (t.notesCount) {
                      <span class="ml-auto"><app-icon name="comment-text-outline" /> {{ t.notesCount }}</span>
                    }
                  </div>
                </article>
              } @empty {
                <p class="py-6 text-center text-xs text-muted">{{ loading() ? 'Cargando…' : 'Sin casos' }}</p>
              }
            </div>
          </section>
        }
      </div>
    </div>

    @if (openId(); as id) {
      <!-- Given another case with unsaved changes, the panel may stay on the one it has: it says which through ticketIdChange. -->
      <app-ticket-panel [ticketId]="id" [autoReply]="replyOnOpen()" (ticketIdChange)="openId.set($event)" (closed)="closePanel()" />
    }
  `,
})
export class BoardPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatCaseDate = formatCaseDate;
  protected readonly resolvedShown = RESOLVED_SHOWN;
  protected readonly openLimit = OPEN_LIMIT;

  /** The cases of the board, read again with "Actualizar" and when cases change (see liveResource). */
  protected readonly board = liveResource({
    load: async (_, abort) => {
      // Neither request asks for archived cases, and the API lists none unless asked.
      const [open, resolved] = await Promise.all([
        // In the API's default order, highest ticket numbers first: past the limit, the oldest are left out.
        this.api.tickets({ status: 'UNRESOLVED,PENDING', pageSize: OPEN_LIMIT }, abort),
        // Highest ticket numbers first: the most recent resolved cases.
        this.api.tickets({ status: 'RESOLVED', pageSize: RESOLVED_SHOWN, dir: 'desc' }, abort),
      ]);
      return { tickets: [...open.items, ...resolved.items], openLeftOut: open.total - open.items.length };
    },
    failed: (error) => this.toast.error(error),
  });
  private readonly tickets = computed(() => this.board.value()?.tickets ?? []);
  /** Open cases that did not fit in one request. Above zero, the board is incomplete and says so. */
  protected readonly openLeftOut = computed(() => this.board.value()?.openLeftOut ?? 0);
  protected readonly loading = this.board.loading;
  protected readonly search = signal('');
  /** The responsible whose cases are shown, or `none` for the cases nobody has. Null: everyone's. */
  protected readonly assignee = signal<number | 'none' | null>(null);
  protected readonly openId = signal<number | null>(null);
  protected readonly replyOnOpen = signal(false);

  protected readonly columns = computed(() => {
    const text = this.search().trim().toLowerCase();
    const assignee = this.assignee();
    const visible = this.tickets().filter((t) => {
      if (assignee !== null && t.assigneeId !== (assignee === 'none' ? null : assignee)) return false;
      return !text || `${t.code} ${t.company} ${t.description}`.toLowerCase().includes(text);
    });
    return STATUSES.map((status) => ({ status, tickets: visible.filter((t) => t.status === status) }));
  });

  constructor() {
    // Changes to cases, made on this screen, in the case panel or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => this.onTicketEvent(event));
  }

  private onTicketEvent(event: TicketEvent): void {
    if (event.kind === 'removed') {
      this.remove(event.id);
    } else if (event.kind === 'saved' && event.ticket.archivedAt) {
      // An archived case is put away: its card leaves the board, like the one of a deleted case.
      this.remove(event.ticket.id);
    } else if (event.kind === 'saved' && this.tickets().some((t) => t.id === event.ticket.id)) {
      this.replace(event.ticket);
    } else {
      // A case that is not on the board (new, reopened, or brought back from the archive), or
      // cases changed elsewhere: the columns are read again.
      this.board.refresh();
      return;
    }
    // Columns already on their way may have been read before this change and would undo it.
    if (this.loading()) this.board.refresh();
  }

  protected async drop(event: CdkDragDrop<TicketStatus, TicketStatus, Ticket>): Promise<void> {
    const ticket = event.item.data;
    const status = event.container.data;
    if (ticket.status === status) return;

    // Move the card right away; undo if the server rejects the change.
    this.replace({ ...ticket, status });
    try {
      // The stored case reaches the card through its "saved" event (see onTicketEvent).
      const updated = await this.api.updateTicket(ticket.id, { status });
      // Dropping a card on "Resuelto" opens it so the AI can draft the message for the client.
      if (status === 'RESOLVED' && !updated.customerReply && this.catalogs.aiReady()) {
        this.replyOnOpen.set(true);
        this.openId.set(ticket.id);
      }
    } catch (error) {
      this.replace(ticket);
      this.toast.error(error);
    }
  }

  private replace(updated: Ticket): void {
    this.board.value.update((board) => board && { ...board, tickets: board.tickets.map((t) => (t.id === updated.id ? updated : t)) });
  }

  private remove(id: number): void {
    this.board.value.update((board) => board && { ...board, tickets: board.tickets.filter((t) => t.id !== id) });
  }

  protected closePanel(): void {
    this.openId.set(null);
    this.replyOnOpen.set(false);
  }
}
