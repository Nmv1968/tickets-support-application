import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, linkedSignal, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Api } from '../../core/api';
import type { Ticket, TicketFilters, TicketInput, TicketPage, TicketStatus } from '../../core/api';
import { Autofocus } from '../../core/autofocus';
import { Catalogs, assigneeInput, assigneeValue } from '../../core/catalogs';
import { TicketEvents } from '../../core/ticket-events';
import type { TicketEvent } from '../../core/ticket-events';
import { TicketFlags } from '../../core/ticket-flags';
import { Toast } from '../../core/toast';
import { PROMISE_CLASS, STATUSES, STATUS_LABEL, downloadBlob, formatCaseDate, formatDateTime, formatDay, formatMomentDay, pastedImages, promiseText, todayIso } from '../../core/ui';
import { AiDraftDialog } from './ai-draft';
import { ImportDialog } from './import-dialog';
import { TicketPanel } from './ticket-panel';

const PAGE_SIZE = 50;

/** Main screen: the support log as an editable table, like the spreadsheet it replaces. */
@Component({
  selector: 'app-tickets',
  imports: [FormsModule, Autofocus, TicketFlags, TicketPanel, AiDraftDialog, ImportDialog],
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
  protected readonly formatMomentDay = formatMomentDay;
  /** Upper limit of the case date: a problem cannot be reported in the future. */
  protected readonly today = todayIso();
  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatDay = formatDay;
  protected readonly formatCaseDate = formatCaseDate;
  protected readonly formatDateTime = formatDateTime;
  protected readonly assigneeValue = assigneeValue;

  // Filters
  protected readonly searchText = signal('');
  private readonly q = signal('');
  protected readonly status = signal<TicketStatus | ''>('');
  protected readonly assignee = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly overdue = signal(false);
  /** Only forgotten cases: open and without activity for the time set in Configuración. */
  protected readonly stale = signal(false);
  /** Delivery promise filter: '' (off), `any`, `overdue`, `today`, `soon` or `due`. */
  protected readonly promise = signal('');
  protected readonly page = signal(1);
  /** Rows go by ticket number. Highest first by default (newest ticket on top); the "Código" header reverses it. */
  protected readonly sortDir = signal<'asc' | 'desc'>('desc');
  /** Phones only: shows the responsible, date and overdue filters. */
  protected readonly moreFilters = signal(false);

  protected readonly filters = computed<TicketFilters>(() => ({
    q: this.q(),
    status: this.status(),
    assignee: this.assignee(),
    from: this.from(),
    to: this.to(),
    overdue: this.overdue() ? '1' : undefined,
    stale: this.stale() ? '1' : undefined,
    promise: this.promise() || undefined,
  }));
  protected readonly hasFilters = computed(() => Object.values(this.filters()).some(Boolean));

  // Data
  private readonly data = signal<TicketPage | null>(null);
  protected readonly loading = signal(true);
  protected readonly items = computed(() => this.data()?.items ?? []);
  protected readonly total = computed(() => this.data()?.total ?? 0);
  protected readonly pageCount = computed(() => Math.max(1, Math.ceil(this.total() / PAGE_SIZE)));

  // Quick-add row
  protected readonly newDate = signal(todayIso());
  /** Time of the case being added. Empty: the case has only its date. */
  protected readonly newTime = signal('');
  protected readonly newCompany = signal('');
  protected readonly newDescription = signal('');
  protected readonly newStatus = signal<TicketStatus>('PENDING');
  /** Starts as the responsible the logged-in user is; follows it once the catalogs arrive. */
  protected readonly newAssignee = linkedSignal(() => this.catalogs.ownAssignee());
  protected readonly newNote = signal('');
  protected readonly adding = signal(false);
  protected readonly companyOptions = signal<string[]>([]);

  // Inline "observación" editor: id of the row being edited
  protected readonly noteRowId = signal<number | null>(null);
  protected readonly noteText = signal('');

  // Overlays
  protected readonly openId = signal<number | null>(null);
  /** The open case was just resolved from the table: its panel drafts the client reply on load. */
  protected readonly replyOnOpen = signal(false);
  protected readonly aiOpen = signal(false);
  protected readonly aiImages = signal<File[]>([]);
  protected readonly importOpen = signal(false);
  protected readonly exportOpen = signal(false);
  protected readonly exporting = signal(false);
  /** The export button together with its menu. */
  private readonly exportMenu = viewChild<ElementRef<HTMLElement>>('exportMenu');

  private lastFilterKey = '';
  private loadSequence = 0;
  /** The latest load. The quick-add row waits for the one its new case started. */
  private lastLoad: Promise<void> = Promise.resolve();
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  private companyTimer: ReturnType<typeof setTimeout> | undefined;

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
    void this.loadCompanies('');

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
      const promise = query?.get('promesa');
      untracked(() => {
        if (caseId) this.openId.set(caseId);
        if (forgotten || promise) {
          this.clearFilters();
          if (forgotten) this.stale.set(true);
          if (promise) this.promise.set(promise);
          this.moreFilters.set(true);
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
      // A list already on its way may have been read before this edit and would undo it.
      if (!this.loading()) return;
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
    this.loading.set(true);
    try {
      const result = await this.api.tickets({ ...this.filters(), dir: this.sortDir(), page: this.page(), pageSize: PAGE_SIZE });
      if (sequence === this.loadSequence) this.data.set(result);
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

  protected clearFilters(): void {
    clearTimeout(this.searchTimer);
    this.searchText.set('');
    this.q.set('');
    this.status.set('');
    this.assignee.set('');
    this.from.set('');
    this.to.set('');
    this.overdue.set(false);
    this.stale.set(false);
    this.promise.set('');
  }

  protected onCompanyInput(text: string): void {
    this.newCompany.set(text);
    clearTimeout(this.companyTimer);
    this.companyTimer = setTimeout(() => void this.loadCompanies(text), 200);
  }

  private async loadCompanies(text: string): Promise<void> {
    try {
      this.companyOptions.set(await this.api.companies(text));
    } catch {
      // Autocomplete is optional; typing still works.
    }
  }

  protected async add(): Promise<void> {
    // Enter on the add button fires both keydown and click.
    if (this.adding()) return;
    const company = this.newCompany().trim();
    const description = this.newDescription().trim();
    if (!company || !description) {
      this.toast.error('Escribe la empresa y la descripción');
      return;
    }
    this.adding.set(true);
    try {
      await this.api.createTicket({
        date: this.newDate() || todayIso(),
        time: this.newTime() || undefined,
        company,
        description,
        status: this.newStatus(),
        ...assigneeInput(this.newAssignee()),
        note: this.newNote().trim() || undefined,
      });
      this.newCompany.set('');
      this.newDescription.set('');
      this.newNote.set('');
      this.newTime.set('');
      this.newStatus.set('PENDING');
      this.toast.ok('Caso registrado');
      // The new case has already asked for the list again (see onTicketEvent): wait for that answer.
      await this.lastLoad;
      // The new case has the highest number: show the page where it landed.
      const target = this.sortDir() === 'asc' ? this.pageCount() : 1;
      if (this.page() !== target) this.page.set(target);
      void this.loadCompanies('');
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.adding.set(false);
    }
  }

  /** Saves one inline change of a row. */
  protected async patch(ticket: Ticket, input: TicketInput): Promise<void> {
    // The row shows the change before it is stored. Its selects are then bound to what is on
    // screen, so putting the row back after a rejection is a change Angular writes to them;
    // a reload that brings the same values they had rewrites nothing.
    this.replace({ ...ticket, ...input });
    try {
      // The stored case reaches the row through its "saved" event (see onTicketEvent).
      const updated = await this.api.updateTicket(ticket.id, input);
      // Resolving a case opens it so the AI can draft the message for the client.
      if (input.status === 'RESOLVED' && !updated.customerReply && this.catalogs.aiReady()) {
        this.replyOnOpen.set(true);
        this.openId.set(ticket.id);
      }
    } catch (error) {
      this.toast.error(error);
      this.replace(ticket);
      await this.load();
    }
  }

  protected closePanel(): void {
    this.openId.set(null);
    this.replyOnOpen.set(false);
    if (this.query()?.has('caso')) {
      void this.router.navigate([], { queryParams: { caso: null }, queryParamsHandling: 'merge', replaceUrl: true });
    }
  }

  protected patchAssignee(ticket: Ticket, value: string): Promise<void> {
    return this.patch(ticket, assigneeInput(value));
  }

  protected startNote(ticket: Ticket): void {
    this.noteText.set('');
    this.noteRowId.set(ticket.id);
  }

  protected async saveNote(ticket: Ticket): Promise<void> {
    // Enter removes the input, which then fires blur: only the first call saves.
    if (this.noteRowId() !== ticket.id) return;
    const text = this.noteText().trim();
    this.noteRowId.set(null);
    if (!text) return;
    try {
      await this.api.addNote(ticket.id, text);
    } catch (error) {
      this.toast.error(error);
    }
  }

  private replace(updated: Ticket): void {
    this.data.update((data) => data && { ...data, items: data.items.map((item) => (item.id === updated.id ? updated : item)) });
  }

  // The list itself is read again by the event of the new cases (see onTicketEvent).
  protected onCreated(): void {
    this.aiOpen.set(false);
    void this.loadCompanies('');
  }

  protected onImported(): void {
    this.importOpen.set(false);
    this.catalogs.reload().catch((error: unknown) => this.toast.error(error));
    void this.loadCompanies('');
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
