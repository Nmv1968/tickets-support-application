import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../core/api';
import type { Ticket, TicketFilters, TicketPage } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { TicketEvents } from '../../core/ticket-events';
import type { TicketEvent } from '../../core/ticket-events';
import { TicketFlags } from '../../core/ticket-flags';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';
import {
  PRIORITY_CLASS,
  PRIORITY_LABEL,
  PROMISE_CLASS,
  STATUS_LABEL,
  downloadBlob,
  formatCaseDate,
  formatDateTime,
  formatDay,
  formatMinutes,
  formatMomentDay,
  pastedImages,
  promiseText,
  timeAgo,
  todayIso,
} from '../../core/ui';
import { AiDraftDialog } from './ai-draft';
import { ImportDialog } from './import-dialog';
import { NewTicketForm } from './new-ticket';
import { COLUMNS, DEFAULT_COLUMNS, TicketColumnsMenu, readColumnChoice, tableWidth } from './ticket-columns';
import type { ColumnChoice, ColumnId } from './ticket-columns';
import { NO_FILTERS, PROMISE_OPTIONS, TicketFiltersPanel, activeFilters, filterQuery } from './ticket-filters';
import type { ListFilters } from './ticket-filters';
import { TicketPanel } from './ticket-panel';
import { UserPreference } from './user-preference';

const PAGE_SIZE = 50;

/**
 * The columns a phone card writes as a line of their own ("Módulo: Ventas"). The others it
 * draws its own way: the code, the date and the status on its first line, and so on.
 */
const CARD_LINES: ReadonlySet<ColumnId> = new Set<ColumnId>(['createdAt', 'priority', 'module', 'promisedDate', 'dueAt', 'estimatedMinutes', 'spentMinutes', 'lastNote', 'createdBy', 'lastActivityAt']);

/**
 * Main screen: the support log as a table, like the spreadsheet it replaces. Its rows are read
 * only: a case is changed in its form, which a click on the row opens.
 */
@Component({
  selector: 'app-tickets',
  imports: [FormsModule, TicketFlags, TypeChip, TicketPanel, AiDraftDialog, ImportDialog, NewTicketForm, TicketFiltersPanel, TicketColumnsMenu],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tickets.html',
  host: { '(document:paste)': 'onPaste($event)', '(document:pointerdown)': 'onPointerDown($event)', '(document:keydown.escape)': 'onEscape()' },
})
export class TicketsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly catalogs = inject(Catalogs);

  protected readonly promiseClass = PROMISE_CLASS;
  protected readonly promiseText = promiseText;
  protected readonly priorityClass = PRIORITY_CLASS;
  protected readonly priorityLabel = PRIORITY_LABEL;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatDay = formatDay;
  protected readonly formatCaseDate = formatCaseDate;
  protected readonly formatDateTime = formatDateTime;
  protected readonly formatMomentDay = formatMomentDay;
  protected readonly timeAgo = timeAgo;

  // Filters
  protected readonly searchText = signal('');
  private readonly q = signal('');
  /** The filters of the panel that "Filtros" opens, as its controls hold them. */
  protected readonly panelFilters = signal<ListFilters>(NO_FILTERS);
  protected readonly page = signal(1);
  /** Rows go by ticket number. Highest first by default (newest ticket on top); the "Código" header reverses it. */
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');

  protected readonly filters = computed<TicketFilters>(() => ({ q: this.q(), ...filterQuery(this.panelFilters()) }));
  protected readonly hasFilters = computed(() => Object.values(this.filters()).some(Boolean));
  /** How many filters of the panel are on. Its button shows it: with the panel closed, nothing else says the list is filtered. */
  protected readonly filterCount = computed(() => activeFilters(this.panelFilters()));

  /**
   * Whether the person keeps the filter panel open. Theirs alone, like the columns below: each
   * is kept with their user and never shared (see UserPreference).
   */
  private readonly filtersShown = new UserPreference<boolean>('tickets.filters-open', false, (stored) => (typeof stored === 'boolean' ? stored : null));
  /** A link of the bell turned a filter on: the panel is open for it, whatever the person keeps. Not theirs to be saved. */
  private readonly filtersByLink = signal(false);
  protected readonly filtersOpen = computed(() => this.filtersShown.value() || this.filtersByLink());

  /** The columns the person chose to see. */
  private readonly columnChoice = new UserPreference<ColumnChoice>('tickets.columns', { visible: [...DEFAULT_COLUMNS] }, readColumnChoice);
  protected readonly visibleColumns = computed(() => this.columnChoice.value().visible);
  /** The same, to ask about one column. */
  protected readonly shown = computed(() => new Set(this.visibleColumns()));
  protected readonly columns = computed(() => COLUMNS.filter((column) => this.shown().has(column.id)));
  protected readonly tableWidth = computed(() => tableWidth(this.columns()));
  protected readonly cardLines = computed(() => this.columns().filter((column) => CARD_LINES.has(column.id)));
  /**
   * The table writes the promise out, in its own column or under the description. Its icon
   * among the flags of the row is for when neither is on show.
   */
  protected readonly promiseWritten = computed(() => this.shown().has('promisedDate') || this.shown().has('description'));
  /** Names of the users, for "Registrado por": a case carries only the id of who registered it. */
  private readonly userNames = computed(() => new Map(this.catalogs.users().map((user) => [user.id, user.name])));

  // Data
  private readonly data = signal<TicketPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  // Overlays
  /** The "Nuevo caso" form is open above the table. */
  protected readonly newOpen = signal(false);
  protected readonly openId = signal<number | null>(null);
  protected readonly aiOpen = signal(false);
  protected readonly aiImages = signal<File[]>([]);
  protected readonly importOpen = signal(false);
  protected readonly exportOpen = signal(false);
  protected readonly exporting = signal(false);
  /** The export button together with its menu. */
  private readonly exportMenu = viewChild<ElementRef<HTMLElement>>('exportMenu');

  private lastFilterKey = '';
  private loadSequence = 0;
  /** The latest load. After a case is registered, the list waits for the one that case started. */
  private lastLoad: Promise<void> = Promise.resolve();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Reload when filters or page change. A filter change goes back to page 1 first.
    effect(() => {
      const key = JSON.stringify([this.filters(), this.sortDir()]);
      const page = this.page();
      untracked(() => {
        if (key !== this.lastFilterKey) {
          this.lastFilterKey = key;
          if (page !== 1) {
            this.page.set(1);
            return;
          }
        }
        void this.load();
      });
    });
    // Changes to cases, made on this screen, in the case panel or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => this.onTicketEvent(event));

    // Links from the bell: `?caso=12` opens that case, `?olvidados=1` turns on the forgotten
    // filter and `?promesa=due` the delivery promise filter.
    effect(() => {
      const query = this.query();
      const caseId = Number(query?.get('caso'));
      const forgotten = query?.get('olvidados') === '1';
      const promise = PROMISE_OPTIONS.find((option) => option.id === query?.get('promesa'))?.id;
      untracked(() => {
        if (caseId) this.openId.set(caseId);
        if (forgotten || promise) {
          this.clearFilters();
          this.panelFilters.update((filters) => ({ ...filters, stale: forgotten, promise: promise ?? null }));
          this.filtersByLink.set(true);
          // The filter is now a control on screen; the URL no longer needs to carry it.
          void this.router.navigate([], { queryParams: { olvidados: null, promesa: null }, queryParamsHandling: 'merge', replaceUrl: true });
        }
      });
    });
  }

  private onTicketEvent(event: TicketEvent): void {
    if (event.kind === 'saved' && !event.created) {
      // An edited case keeps its row, as in a spreadsheet, even if it stops matching the filters.
      this.replace(event.ticket);
      // Unless it was archived or brought back: that puts the case away, or takes it out again.
      // The list is read again, and has it or not as its filter of archived cases says. The
      // save itself says so, not the rows: a case archived a moment ago from the form that is
      // still open has no row left here, and is brought back from that same form.
      // A list already on its way may have been read before this edit and would undo it.
      if (!event.archiving && !this.loading()) return;
    }
    // A new or deleted case, or cases changed elsewhere: the page is read again.
    void this.load();
  }

  protected load(): Promise<void> {
    this.lastLoad = this.fetchPage();
    return this.lastLoad;
  }

  private async fetchPage(): Promise<void> {
    const sequence = ++this.loadSequence;
    const page = this.page();
    this.loading.set(true);
    try {
      const result = await this.api.tickets({ ...this.filters(), dir: this.sortDir(), page, pageSize: PAGE_SIZE });
      if (sequence !== this.loadSequence) return;
      // A page past the end of the list: the cases it had were archived or deleted, or stopped
      // matching the filters. Shown as it came, it would say that there are no cases at all,
      // with no pager to go back with. The list goes to the last page there is, which the
      // effect of the constructor then reads.
      const lastPage = Math.ceil(result.total / PAGE_SIZE);
      if (result.items.length === 0 && lastPage >= 1 && page > lastPage) {
        this.page.set(lastPage);
        return;
      }
      this.data.set(result);
    } catch (error) {
      this.toast.error(error);
    } finally {
      if (sequence === this.loadSequence) this.loading.set(false);
    }
  }

  protected toggleSort(): void {
    this.sortDir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(text.trim()), 300);
  }

  /** "Limpiar filtros": the list goes back to every case that is not archived. The search box is emptied too. */
  protected clearFilters(): void {
    clearTimeout(this.searchTimer);
    this.searchText.set('');
    this.q.set('');
    this.panelFilters.set(NO_FILTERS);
  }

  /** The "Filtros" button. The person opening or closing the panel is what is kept for them. */
  protected toggleFilters(): void {
    const open = !this.filtersOpen();
    this.filtersByLink.set(false);
    this.filtersShown.set(open);
  }

  protected chooseColumns(visible: readonly ColumnId[]): void {
    this.columnChoice.set({ visible: [...visible] });
  }

  /**
   * What a column says of a case, in words: for the columns that are plain text in the table,
   * and for the lines of a phone card. Empty when the case has nothing there.
   */
  protected text(column: ColumnId, t: Ticket): string {
    switch (column) {
      case 'createdAt':
        return formatMomentDay(t.createdAt);
      case 'priority':
        return t.priority ? PRIORITY_LABEL[t.priority] : '';
      case 'module':
        return t.moduleName ?? '';
      case 'promisedDate':
        return t.promisedDate ? formatDay(t.promisedDate) + (t.promiseState ? ' · ' + promiseText(t.promisedDate) : '') : '';
      case 'dueAt':
        return formatDateTime(t.dueAt);
      case 'estimatedMinutes':
        return t.estimatedMinutes === null ? '' : formatMinutes(t.estimatedMinutes);
      case 'spentMinutes':
        // Zero is a case nobody has put time on: nothing to say.
        return t.spentMinutes ? formatMinutes(t.spentMinutes) : '';
      case 'lastNote':
        return t.lastNote ?? '';
      case 'createdBy':
        return (t.createdById !== null && this.userNames().get(t.createdById)) || '';
      case 'lastActivityAt':
        return formatDateTime(t.lastActivityAt);
      default:
        return '';
    }
  }

  /**
   * A click anywhere on a row opens its case. Except the click that ends a selection: the
   * person dragged over a text of the row to copy it.
   */
  protected openRow(ticket: Ticket): void {
    if (window.getSelection()?.toString()) return;
    this.openId.set(ticket.id);
  }

  protected closePanel(): void {
    this.openId.set(null);
    if (this.query()?.has('caso')) {
      void this.router.navigate([], { queryParams: { caso: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /** A case was registered with the form above the table: the list goes to the page where it landed. */
  protected async onRegistered(): Promise<void> {
    // The new case has already asked for the list again (see onTicketEvent): wait for that answer.
    await this.lastLoad;
    // The new case has the highest number.
    const target = this.sortDir() === 'asc' ? this.pageCount() : 1;
    if (this.page() !== target) this.page.set(target);
  }

  private replace(updated: Ticket): void {
    this.data.update((data) => data && { ...data, items: data.items.map((item) => (item.id === updated.id ? updated : item)) });
  }

  // The list itself is read again by the event of the new cases (see onTicketEvent).
  protected onCreated(): void {
    this.aiOpen.set(false);
  }

  // An import can add companies, responsibles and support types.
  protected onImported(): void {
    this.importOpen.set(false);
    this.catalogs.reload().catch((error: unknown) => this.toast.error(error));
  }

  protected openAi(images: File[]): void {
    this.aiImages.set(images);
    this.aiOpen.set(true);
  }

  /** Pasting a screenshot anywhere on this screen starts a new case from it. */
  protected onPaste(event: ClipboardEvent): void {
    if (this.aiOpen() || this.importOpen() || this.openId() !== null) return;
    const images = pastedImages(event);
    if (!images.length) return;
    event.preventDefault();
    this.openAi(images);
  }

  /**
   * Pressing anywhere else closes the export menu. It listens to the press and not to the
   * click: Safari on iOS sends no click for a tap on plain content.
   */
  protected onPointerDown(event: PointerEvent): void {
    if (this.exportOpen() && !this.exportMenu()?.nativeElement.contains(event.target as Node)) this.exportOpen.set(false);
  }

  /** Escape closes the export menu. The focus goes back to its button: on a menu item it would be lost with the menu. */
  protected onEscape(): void {
    if (!this.exportOpen()) return;
    this.exportOpen.set(false);
    this.exportMenu()?.nativeElement.querySelector('button')?.focus();
  }

  protected async export(format: 'xlsx' | 'pdf'): Promise<void> {
    this.exportOpen.set(false);
    this.exporting.set(true);
    try {
      downloadBlob(await this.api.exportFile(format, { ...this.filters(), dir: this.sortDir() }), `casos-soporte-${todayIso()}.${format}`);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.exporting.set(false);
    }
  }
}
