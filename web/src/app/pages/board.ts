import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Api } from '../core/api';
import type { Ticket, TicketStatus } from '../core/api';
import { Catalogs } from '../core/catalogs';
import { TicketEvents } from '../core/ticket-events';
import type { TicketEvent } from '../core/ticket-events';
import { TicketFlags } from '../core/ticket-flags';
import { Toast } from '../core/toast';
import { STATUSES, STATUS_LABEL, formatDay } from '../core/ui';
import { TicketPanel } from './tickets/ticket-panel';

const RESOLVED_SHOWN = 30;
/** Open cases asked for in one request: the largest page the API serves. */
const OPEN_LIMIT = 500;

/** Kanban: one column per status. Dragging a card changes the status of the case. */
@Component({
  selector: 'app-board',
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, TicketFlags, TicketPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col gap-3 p-3 md:p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="mr-auto text-lg font-semibold">Tablero</h1>
        <input class="input w-56" type="search" placeholder="Buscar en el tablero" aria-label="Buscar en el tablero" [(ngModel)]="search" />
        <select class="input w-auto" aria-label="Filtrar por responsable" [(ngModel)]="assignee">
          <option value="">Responsable: todos</option>
          @for (user of catalogs.users(); track user.id) {
            <option [value]="user.id">{{ user.name }}</option>
          }
          <option value="client">Cliente</option>
          <option value="none">Sin asignar</option>
        </select>
        <button type="button" class="btn btn-soft px-2.5" (click)="load()" aria-label="Actualizar">
          <i class="mdi mdi-refresh text-base" [class.mdi-spin]="loading()" aria-hidden="true"></i>
        </button>
      </div>

      @if (openLeftOut() > 0) {
        <p class="rounded-control bg-warning/10 px-3 py-2 text-xs" role="status">
          <i class="mdi mdi-alert-outline text-warning" aria-hidden="true"></i>
          El tablero muestra solo los {{ openLimit }} casos abiertos más recientes. Faltan {{ openLeftOut() }} más antiguos: búscalos en la lista de Casos.
        </p>
      }

      <div class="flex min-h-0 flex-1 gap-3 overflow-x-auto" cdkDropListGroup>
        @for (column of columns(); track column.status) {
          <section class="flex w-80 shrink-0 flex-col rounded-card bg-elevated md:w-auto md:flex-1" [attr.aria-label]="statusLabel[column.status]">
            <header class="flex items-center gap-2 px-3 py-2.5">
              <span class="badge" [class]="'st-' + column.status">{{ statusLabel[column.status] }}</span>
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
                <article
                  class="card cursor-grab p-2.5 active:cursor-grabbing"
                  cdkDrag
                  [cdkDragData]="t"
                  [cdkDragStartDelay]="{ touch: 200, mouse: 0 }"
                  tabindex="0"
                  (click)="openId.set(t.id)"
                  (keydown.enter)="openId.set(t.id)"
                >
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="font-mono text-primary">{{ t.code }}</span>
                    <span class="text-muted">{{ formatDay(t.date) }}</span>
                    <app-ticket-flags class="ml-auto" [ticket]="t" />
                  </div>
                  <div class="mt-1 font-medium">{{ t.company }}</div>
                  <p class="line-clamp-3 text-muted">{{ t.description }}</p>
                  <div class="mt-1.5 flex items-center gap-1 text-xs text-muted">
                    <i class="mdi mdi-account-outline" aria-hidden="true"></i>
                    <span class="truncate">{{ t.assigneeName ?? 'Sin asignar' }}</span>
                    @if (t.notesCount) {
                      <span class="ml-auto"><i class="mdi mdi-comment-text-outline" aria-hidden="true"></i> {{ t.notesCount }}</span>
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
      <app-ticket-panel [ticketId]="id" [autoReply]="replyOnOpen()" (closed)="closePanel()" />
    }
  `,
})
export class BoardPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatDay = formatDay;
  protected readonly resolvedShown = RESOLVED_SHOWN;
  protected readonly openLimit = OPEN_LIMIT;

  private readonly tickets = signal<Ticket[]>([]);
  /** Open cases that did not fit in one request. Above zero, the board is incomplete and says so. */
  protected readonly openLeftOut = signal(0);
  protected readonly loading = signal(true);
  protected readonly search = signal('');
  protected readonly assignee = signal('');
  protected readonly openId = signal<number | null>(null);
  protected readonly replyOnOpen = signal(false);

  protected readonly columns = computed(() => {
    const text = this.search().trim().toLowerCase();
    const assignee = this.assignee();
    const visible = this.tickets().filter((t) => {
      if (assignee === 'client' && !t.assignedToClient) return false;
      if (assignee === 'none' && (t.assigneeId !== null || t.assignedToClient)) return false;
      if (assignee && assignee !== 'client' && assignee !== 'none' && String(t.assigneeId) !== assignee) return false;
      return !text || `${t.code} ${t.company} ${t.description}`.toLowerCase().includes(text);
    });
    return STATUSES.map((status) => ({ status, tickets: visible.filter((t) => t.status === status) }));
  });

  private loadSequence = 0;

  constructor() {
    void this.load();

    // Changes to cases, made on this screen, in the case panel or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => this.onTicketEvent(event));
  }

  private onTicketEvent(event: TicketEvent): void {
    if (event.kind === 'removed') {
      this.tickets.update((tickets) => tickets.filter((t) => t.id !== event.id));
    } else if (event.kind === 'saved' && this.tickets().some((t) => t.id === event.ticket.id)) {
      this.replace(event.ticket);
    } else {
      // A case that is not on the board (new, or reopened), or cases changed elsewhere:
      // the columns are read again.
      void this.load();
      return;
    }
    // Columns already on their way may have been read before this change and would undo it.
    if (this.loading()) void this.load();
  }

  protected async load(): Promise<void> {
    // Only the answer to the latest request is shown: an older one can arrive after it.
    const sequence = ++this.loadSequence;
    this.loading.set(true);
    try {
      const [open, resolved] = await Promise.all([
        // In the API's default order, highest ticket numbers first: past the limit, the oldest are left out.
        this.api.tickets({ status: 'UNRESOLVED,PENDING', pageSize: OPEN_LIMIT }),
        // Highest ticket numbers first: the most recent resolved cases.
        this.api.tickets({ status: 'RESOLVED', pageSize: RESOLVED_SHOWN, dir: 'desc' }),
      ]);
      if (sequence !== this.loadSequence) return;
      this.tickets.set([...open.items, ...resolved.items]);
      this.openLeftOut.set(open.total - open.items.length);
    } catch (error) {
      this.toast.error(error);
    } finally {
      if (sequence === this.loadSequence) this.loading.set(false);
    }
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
    this.tickets.update((tickets) => tickets.map((t) => (t.id === updated.id ? updated : t)));
  }

  protected closePanel(): void {
    this.openId.set(null);
    this.replyOnOpen.set(false);
  }
}
