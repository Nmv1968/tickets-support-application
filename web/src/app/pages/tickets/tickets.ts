import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../core/api';
import type { Ticket, TicketFilters, TicketPage } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { DialogPending } from '../../core/dialog-pending';
import { focusAfterRender } from '../../core/focus';
import { Hint } from '../../core/hint';
import { Icon } from '../../core/icon';
import { liveResource } from '../../core/loading';
import { popoverSide } from '../../core/popover-side';
import { SoftDisabled } from '../../core/soft-disabled';
import { Status } from '../../core/status';
import { StatusBadge } from '../../core/status-badge';
import { TicketEvents } from '../../core/ticket-events';
import type { TicketEvent } from '../../core/ticket-events';
import { TicketFlags, TicketFlagsLegend } from '../../core/ticket-flags';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';
import { downloadBlob, pastedImages, todayIso } from '../../core/ui';
import { UserPreference } from '../../core/user-preference';
import { wideScreen } from '../../core/wide-screen';
import { AiDraftDialog } from './ai-draft';
import { caseRow } from './case-row';
import { ImportDialog } from './import-dialog';
import { NewTicketForm } from './new-ticket';
import { COLUMNS, DEFAULT_COLUMNS, TicketColumnsMenu, readColumnChoice, tableWidth } from './ticket-columns';
import type { ColumnChoice, ColumnId } from './ticket-columns';
import { NO_FILTERS, PROMISE_OPTIONS, TicketFiltersPanel, activeFilters, filterQuery } from './ticket-filters';
import type { ListFilters } from './ticket-filters';
import { TicketPanel } from './ticket-panel';

const PAGE_SIZE = 50;
/** Width of the export menu, in rem: its class `w-48`. */
const EXPORT_MENU_REM = 12;

/**
 * The columns a phone card writes as a line of their own ("Módulo: Ventas"). The others it
 * draws its own way: the code, the date and the status on its first line, and so on.
 */
const CARD_LINES: ReadonlySet<ColumnId> = new Set<ColumnId>(['createdAt', 'priority', 'module', 'promisedDate', 'dueAt', 'estimatedMinutes', 'spentMinutes', 'lastNote', 'createdBy', 'lastActivityAt']);

/** Two queries of the list ask for the same cases. */
function sameQuery(a: TicketFilters, b: TicketFilters): boolean {
  const keys = Object.keys(a) as (keyof TicketFilters)[];
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/**
 * Main screen: the support log as a table, like the spreadsheet it replaces. Its rows are read
 * only: a case is changed in its form, which a click on the row opens.
 */
@Component({
  selector: 'app-tickets',
  imports: [
    FormsModule,
    NgTemplateOutlet,
    StatusBadge,
    TicketFlags,
    TicketFlagsLegend,
    TypeChip,
    TicketPanel,
    AiDraftDialog,
    ImportDialog,
    NewTicketForm,
    TicketFiltersPanel,
    TicketColumnsMenu,
    Hint,
    Icon,
    DialogPending,
    SoftDisabled,
    Status,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tickets.html',
  host: { '(document:paste)': 'onPaste($event)', '(document:pointerdown)': 'onPointerDown($event)', '(document:keydown.escape)': 'onEscape($event)' },
})
export class TicketsPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly query = toSignal(inject(ActivatedRoute).queryParamMap);
  protected readonly catalogs = inject(Catalogs);
  /** A wide screen shows the list as a table, a narrow one (a phone) as cards. Only one of them is drawn. */
  protected readonly wide = wideScreen();

  // Filters
  protected readonly searchText = signal('');
  private readonly q = signal('');
  /** The filters of the panel that "Filtros" opens, as its controls hold them. */
  protected readonly panelFilters = signal<ListFilters>(NO_FILTERS);
  /** Rows go by ticket number. Highest first by default (newest ticket on top); the "Código" header reverses it. */
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');

  /** What the list asks for. The same cases asked for again are no change: the list stays where it is. */
  protected readonly filters = computed<TicketFilters>(() => ({ q: this.q(), ...filterQuery(this.panelFilters()) }), { equal: sameQuery });
  /** Back to the first page whenever the filters or the order change. */
  protected readonly page = linkedSignal({ source: () => [this.filters(), this.sortDir()], computation: () => 1 });
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
  /** The page of the list, read again whenever the filters, the order or the page change (see liveResource). */
  private readonly list = liveResource({
    params: () => ({ ...this.filters(), dir: this.sortDir(), page: this.page(), pageSize: PAGE_SIZE }),
    load: async (query, abort, current) => {
      const answer = await this.api.tickets(query, abort);
      // With another page to be on, that one is read. This answer, for a page the list has left,
      // is then never shown: the answer to a read that is no longer the one asked is dropped.
      // An answer that came after another page or other filters were asked for, and before its
      // read was cancelled, says nothing of where the list goes now.
      if (current()) this.page.set(this.pageAfter(answer, query.page));
      return answer;
    },
    failed: (error, current) => {
      this.toast.error(error);
      // Where the new case landed is then told by the cases the list has. Not by a read asked
      // for before the case was registered: the read that follows it tells.
      if (this.toNewCase && current()) {
        this.toNewCase = false;
        this.page.set(this.newCasePage(this.total()));
      }
    },
  });
  protected readonly loading = this.list.loading;
  /** A read the person asked for is on its way: a search, a filter, a page, the order (see liveResource). */
  protected readonly asked = this.list.asked;
  /** The cases of the page, as their rows and cards show them (see CaseRow). */
  protected readonly rows = computed(() => {
    const names = this.userNames();
    return (this.list.value()?.items ?? []).map((ticket) => caseRow(ticket, names));
  });
  protected readonly total = computed(() => this.list.value()?.total ?? 0);
  /** How many cases there are is known: the first read was answered. Before, the list has not 0 of them, it is "Cargando…". */
  protected readonly counted = computed(() => this.list.value() !== undefined);
  /**
   * The count said to a screen reader (see the footer): `total` as the last read the person asked
   * for left it, once it is answered (see `asked`). Not as a read made in silence leaves it, for a
   * case registered, deleted or archived elsewhere: an idle screen-reader user heard the new count
   * each time. Null until the first answer.
   */
  protected readonly spokenTotal = linkedSignal<boolean, number | null>({
    source: this.asked,
    computation: (asking, previous) => (asking ? (previous?.value ?? null) : untracked(() => (this.counted() ? this.total() : null))),
  });
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  // Overlays
  /** The "Nuevo caso" form is open above the table. */
  protected readonly newOpen = signal(false);
  protected readonly openId = signal<number | null>(null);
  protected readonly aiOpen = signal(false);
  protected readonly aiImages = signal<File[]>([]);
  protected readonly importOpen = signal(false);
  protected readonly exportOpen = signal(false);
  /** The edge of its button the export menu lines up with, chosen each time it opens (see toggleExport). */
  protected readonly exportSide = signal<'left' | 'right'>('right');
  protected readonly exporting = signal(false);
  /** The export button together with its menu. */
  private readonly exportMenu = viewChild<ElementRef<HTMLElement>>('exportMenu');
  private readonly exportButton = viewChild<ElementRef<HTMLButtonElement>>('exportButton');
  private readonly newCaseButton = viewChild.required<ElementRef<HTMLButtonElement>>('newCaseButton');
  /** Where the focus goes when what had it leaves the screen and nothing closer is left. */
  private readonly searchBox = viewChild.required<ElementRef<HTMLInputElement>>('searchBox');

  /** A case was registered with the form above the table: the next page that arrives takes the list to it (see pageAfter). */
  private toNewCase = false;
  private searchTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Changes to cases, made on this screen, in the case panel or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => this.onTicketEvent(event));
    // A search typed just before leaving the screen has no list left to filter.
    inject(DestroyRef).onDestroy(() => clearTimeout(this.searchTimer));

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
    // A deleted case leaves its row at once, before the page read again comes: the panel that
    // deleted it closes now, and gives the focus to the row of its case while there is one.
    if (event.kind === 'removed') this.drop(event.id);
    // A new or deleted case, or cases changed elsewhere: the page is read again, in silence.
    this.list.reread();
  }

  /**
   * The page the list goes to with the answer for page `page`. Right after a case was registered
   * with the form, the page where it landed. Past the end of the list (the cases of the page were
   * archived or deleted, or stopped matching the filters), the last page there is: shown as it
   * came, the page would say that there are no cases at all, with no pager to go back with.
   * Otherwise the same page.
   */
  private pageAfter({ items, total }: TicketPage, page: number): number {
    if (this.toNewCase) {
      this.toNewCase = false;
      return this.newCasePage(total);
    }
    const last = Math.ceil(total / PAGE_SIZE);
    return items.length === 0 && last >= 1 && page > last ? last : page;
  }

  /** The page of a case just registered, in a list of `total` cases: it has the highest number. */
  private newCasePage(total: number): number {
    return this.sortDir() === 'asc' ? Math.max(1, Math.ceil(total / PAGE_SIZE)) : 1;
  }

  protected toggleSort(): void {
    this.sortDir.update((dir) => (dir === 'asc' ? 'desc' : 'asc'));
  }

  protected onSearch(text: string): void {
    this.searchText.set(text);
    clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => this.q.set(text.trim()), 300);
  }

  /**
   * "Limpiar filtros": the list goes back to every case that is not archived. The search box is
   * emptied too. The one of the empty list goes away with what it said: the focus goes to the
   * search box, where the list starts.
   */
  protected clearFilters(): void {
    clearTimeout(this.searchTimer);
    this.searchText.set('');
    this.q.set('');
    this.panelFilters.set(NO_FILTERS);
    focusAfterRender(this.injector, this.searchBox().nativeElement);
  }

  /** The "×" of "Nuevo caso": the form goes, and the focus to the button that opens it. */
  protected closeNewTicket(): void {
    this.newOpen.set(false);
    focusAfterRender(this.injector, this.newCaseButton().nativeElement);
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
   * A click anywhere on a row opens its case. Except the click that ends a selection: the
   * person dragged over a text of the row to copy it.
   */
  protected openRow(ticket: Ticket): void {
    if (window.getSelection()?.toString()) return;
    this.openId.set(ticket.id);
  }

  /**
   * The panel took the focus back to what opened it. That may be gone: the row of a case that
   * was archived or deleted, a list read again. Then the focus goes to the case on the page (its
   * code, its card), or else to the search box, and not to nowhere.
   */
  protected closePanel(): void {
    const id = this.openId();
    focusAfterRender(this.injector, () => document.querySelector(`[data-case-id="${id}"]`), this.searchBox().nativeElement);
    this.openId.set(null);
    if (this.query()?.has('caso')) {
      void this.router.navigate([], { queryParams: { caso: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  /**
   * A case was registered with the form above the table: the list goes to the page where it
   * landed. The new case has already asked for the list again (see onTicketEvent), and the
   * answer says which page that is (see pageAfter).
   */
  protected onRegistered(): void {
    this.toNewCase = true;
  }

  private drop(id: number): void {
    this.list.value.update((data) => data && (data.items.some((item) => item.id === id) ? { ...data, items: data.items.filter((item) => item.id !== id), total: data.total - 1 } : data));
  }

  private replace(updated: Ticket): void {
    this.list.value.update((data) => data && { ...data, items: data.items.map((item) => (item.id === updated.id ? updated : item)) });
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
   * The "Exportar" button opens its menu, or closes it. Under the right edge of the button, unless
   * that takes the menu off the screen: on a narrow screen the row of buttons wraps, and the button
   * can start a line of its own at the left edge (see popoverSide).
   */
  protected toggleExport(): void {
    const menu = this.exportMenu()?.nativeElement;
    if (!this.exportOpen() && menu) this.exportSide.set(popoverSide(menu, EXPORT_MENU_REM));
    this.exportOpen.update((open) => !open);
  }

  /**
   * Pressing anywhere else closes the export menu. It listens to the press and not to the
   * click: Safari on iOS sends no click for a tap on plain content.
   */
  protected onPointerDown(event: PointerEvent): void {
    if (this.exportOpen() && !this.exportMenu()?.nativeElement.contains(event.target as Node)) this.exportOpen.set(false);
  }

  /**
   * The focus left the export menu and its button: the menu closes, and leaves in view what it
   * covered ("Filtros", "Columnas"). Not when the focus goes nowhere: Safari gives a pressed button
   * no focus, and the menu has to be there for the press on one of its choices.
   */
  protected onExportFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (this.exportOpen() && next instanceof Node && !this.exportMenu()?.nativeElement.contains(next)) this.exportOpen.set(false);
  }

  /**
   * Escape closes the export menu, and takes the key (stopped): an error toast waits for the next
   * one (see Toasts). The focus goes back to its button: on a menu item it would be lost with the menu.
   */
  protected onEscape(event: Event): void {
    if (!this.exportOpen()) return;
    event.stopPropagation();
    event.preventDefault();
    this.exportOpen.set(false);
    this.exportMenu()?.nativeElement.querySelector('button')?.focus();
  }

  /** A choice of the export menu. The menu goes with it, and the focus back to "Exportar", which waits for the file. */
  protected async export(format: 'xlsx' | 'pdf'): Promise<void> {
    this.exportOpen.set(false);
    focusAfterRender(this.injector, this.exportButton()?.nativeElement);
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
