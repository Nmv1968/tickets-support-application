import { CdkDrag, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import type { CdkDragDrop } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Say } from '../core/announcer';
import { Api } from '../core/api';
import type { Ticket, TicketStatus } from '../core/api';
import { AssigneeSelect } from '../core/case-selects';
import { Catalogs } from '../core/catalogs';
import { focusAfterRender } from '../core/focus';
import { Icon } from '../core/icon';
import { liveResource } from '../core/loading';
import { Status } from '../core/status';
import { TicketEvents } from '../core/ticket-events';
import type { TicketEvent } from '../core/ticket-events';
import { StatusBadge } from '../core/status-badge';
import { TicketFlags, TicketFlagsLegend } from '../core/ticket-flags';
import { Toast } from '../core/toast';
import { TypeChip } from '../core/type-chip';
import { STATUSES, STATUS_LABEL, assigneesText, formatCaseDate } from '../core/ui';
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
  imports: [FormsModule, CdkDropListGroup, CdkDropList, CdkDrag, CdkScrollable, AssigneeSelect, StatusBadge, TicketFlags, TicketFlagsLegend, TypeChip, TicketPanel, Icon, Say, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-full flex-col gap-3 p-3 md:p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="mr-auto text-lg font-semibold">Tablero</h1>
        <input #searchBox class="input w-56" type="search" placeholder="Buscar en el tablero" aria-label="Buscar en el tablero" [(ngModel)]="search" />
        <app-assignee-select class="w-56" ariaLabel="Filtrar por responsable" placeholder="Responsable: todos" [items]="catalogs.assigneeFilterOptions()" [(value)]="assignee" />
        <button type="button" class="btn btn-soft btn-icon px-2.5" (click)="board.refresh()" aria-label="Actualizar">
          <app-icon name="refresh" class="text-base" [spin]="loading()" />
        </button>
        <!--
          With less motion asked for the icon does not turn: the eye is told in words instead, for every
          read, as the icon would have turned. Not to a screen reader, which the status below tells.
        -->
        @if (loading()) {
          <span class="hidden text-xs text-muted motion-reduce:inline" aria-hidden="true">Actualizando…</span>
        }
        <!--
          What the icon that turns says, to who does not see it. Only for a read the person asked for:
          the icon also turns when the cases are read again for a change someone else made, in silence.
        -->
        <app-status class="sr-only">{{ asked() ? 'Actualizando el tablero…' : '' }}</app-status>
      </div>
      <!--
        How to move a case without dragging it: every card points at this line (aria-describedby). Beside it, out of
        what the cards point at, the legend of the flags of a card (see TicketFlagsLegend), which has no room for their words.
      -->
      <div class="-mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted">
        <p id="board-hint">Arrastra una tarjeta a otra columna, o ábrela con Enter y cambia su Estado.</p>
        <app-ticket-flags-legend textId="board-flags-legend" />
      </div>

      <!--
        Said once, as it comes (see Say): not again when its numbers change with a read made in silence for a change someone
        else made. A status that came with its words might not have been read.
      -->
      @if (openLeftOut() > 0) {
        <p class="rounded-control bg-warning/10 px-3 py-2 text-xs" appSay>
          <app-icon name="alert-outline" class="text-warning" />
          El tablero muestra solo los {{ openLimit }} casos abiertos más recientes. Faltan {{ openLeftOut() }} más antiguos: búscalos en la lista de Casos.
        </p>
      }

      <!--
        Never lower than a few cards: a low screen scrolls to them. On a short one the page scrolls, and the columns are as high as the screen at most.
        A card dragged near an edge scrolls the columns (cdkScrollable). On a phone a column leaves the next one in sight; from md up they share the width.
      -->
      <div class="flex min-h-64 flex-1 gap-3 overflow-x-auto short:max-h-dvh short:min-h-0" cdkDropListGroup cdkScrollable [attr.aria-busy]="loading()">
        @for (column of columns(); track column.status) {
          <section class="flex w-[min(20rem,calc(100vw-3rem))] min-w-0 shrink-0 flex-col rounded-card bg-elevated md:w-auto md:flex-1" [attr.aria-label]="statusLabel[column.status]">
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
                @let card = 'board-card-' + t.id;
                <!--
                  A button to the keyboard and to who hears the page: Enter and Space open the case. Space would otherwise scroll the column.
                  Named by its code and its company; the rest of the card, and how to move it without dragging, is its description.
                -->
                <div
                  class="card cursor-grab p-2.5 active:cursor-grabbing"
                  cdkDrag
                  [cdkDragData]="t"
                  [cdkDragStartDelay]="{ touch: 200, mouse: 0 }"
                  role="button"
                  tabindex="0"
                  [attr.data-case-id]="t.id"
                  [attr.aria-labelledby]="card + '-code ' + card + '-company'"
                  [attr.aria-describedby]="card + '-date ' + card + '-flags ' + card + '-details board-hint'"
                  (click)="openId.set(t.id)"
                  (keydown.enter)="openId.set(t.id)"
                  (keydown.space)="$event.preventDefault(); openId.set(t.id)"
                >
                  <div class="flex items-center gap-1.5 text-xs">
                    <span class="font-mono text-primary" [id]="card + '-code'">{{ t.code }}</span>
                    <span class="text-muted" [id]="card + '-date'">{{ formatCaseDate(t) }}</span>
                    <app-ticket-flags class="ml-auto" [ticket]="t" [id]="card + '-flags'" />
                  </div>
                  <div class="mt-1 font-medium" [id]="card + '-company'">{{ t.company }}</div>
                  <div [id]="card + '-details'">
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
                      <span class="min-w-0">{{ assigneesText(t) || 'Sin asignar' }}</span>
                      @if (t.notesCount) {
                        <span class="ml-auto shrink-0 whitespace-nowrap"><app-icon name="comment-text-outline" /> {{ t.notesCount }}</span>
                      }
                    </div>
                  </div>
                </div>
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
  protected readonly assigneesText = assigneesText;
  protected readonly resolvedShown = RESOLVED_SHOWN;
  protected readonly openLimit = OPEN_LIMIT;

  /** The cases of the board, read again with "Actualizar" and, in silence, when cases change (see liveResource). */
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
  protected readonly asked = this.board.asked;
  protected readonly search = signal('');
  /** The responsible whose cases are shown, or `none` for the cases nobody has. Null: everyone's. */
  protected readonly assignee = signal<number | 'none' | null>(null);
  protected readonly openId = signal<number | null>(null);
  protected readonly replyOnOpen = signal(false);
  private readonly injector = inject(Injector);
  private readonly searchBox = viewChild.required<ElementRef<HTMLInputElement>>('searchBox');

  protected readonly columns = computed(() => {
    const text = this.search().trim().toLowerCase();
    const assignee = this.assignee();
    const visible = this.tickets().filter((t) => {
      // As the list: the cases of a responsible are the ones they have, alone or with others.
      if (assignee === 'none' ? t.assignees.length > 0 : assignee !== null && !t.assignees.some((person) => person.id === assignee)) return false;
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
      this.board.reread();
      return;
    }
    // Columns already on their way may have been read before this change and would undo it.
    if (this.loading()) this.board.reread();
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

  /**
   * The panel took the focus back to the card that opened it. A case whose status changed in the
   * panel has a new card, in another column, and one archived or deleted has none: the focus then
   * goes to the card of the case, or else to the search box, and not to nowhere.
   */
  protected closePanel(): void {
    const id = this.openId();
    focusAfterRender(this.injector, () => document.querySelector(`[data-case-id="${id}"]`), this.searchBox().nativeElement);
    this.openId.set(null);
    this.replyOnOpen.set(false);
  }
}
