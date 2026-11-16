import { A11yModule } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { TicketDetail, TicketInput, TicketSupportType } from '../../core/api';
import { AssigneeSelect, CompanySelect, ModuleSelect, PrioritySelect, StatusSelect, SupportTypeSelect } from '../../core/case-selects';
import { Catalogs, offered } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { Icon } from '../../core/icon';
import { latest } from '../../core/loading';
import { StatusBadge } from '../../core/status-badge';
import { TicketEvents } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { PROMISE_CLASS, errorMessage, formatDateTime, promiseText, todayIso } from '../../core/ui';
import { UnsavedChanges } from '../../core/unsaved-changes';
import { TicketAttachments } from './ticket-attachments';
import { NO_NOT_NUMBER, afterSave, changed, changesOf, draftOf, isDirty, problemsOf, tidied, withVersion } from './ticket-form';
import type { Draft, NotNumber, Problems, Unreadable } from './ticket-form';
import { TicketHistory } from './ticket-history';
import { TicketNotes } from './ticket-notes';
import { TicketReply } from './ticket-reply';
import { TicketTimes } from './ticket-times';

/**
 * Side panel with every field of one case. The form edits a draft: nothing is sent while the
 * person types or chooses, and "Actualizar" saves what they changed in one go. What is not a
 * field of the case (observations, attachments, the timer, the AI reply, archiving, deleting)
 * has its own button and acts at once. An observation typed and not added with its button is
 * the one thing "Actualizar" saves besides the draft: it would otherwise be lost on the way out.
 */
@Component({
  selector: 'app-ticket-panel',
  imports: [FormsModule, A11yModule, CompanySelect, StatusSelect, AssigneeSelect, PrioritySelect, ModuleSelect, SupportTypeSelect, StatusBadge, TicketTimes, TicketNotes, TicketReply, TicketAttachments, TicketHistory, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()', '(window:beforeunload)': 'onBeforeUnload($event)' },
  template: `
    <div class="panel-backdrop" (click)="close()" aria-hidden="true"></div>
    <aside
      class="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-line bg-surface shadow-2xl"
      role="dialog"
      aria-modal="true"
      aria-label="Detalle del caso"
      cdkTrapFocus
      [cdkTrapFocusAutoCapture]="true"
      (dragover)="$event.preventDefault()"
      (drop)="onDrop($event)"
    >
      <header class="flex items-start gap-2 border-b border-line px-4 py-3">
        <!-- The badges go on to a second line on a narrow screen; the button that closes stays in its corner. -->
        <div class="flex min-h-9 min-w-0 flex-1 flex-wrap items-center gap-2">
          @if (stored(); as t) {
            <span class="font-mono text-sm font-semibold text-primary">{{ t.code }}</span>
            <span appStatusBadge [status]="t.status"></span>
            @if (t.overdue) {
              <span class="badge bg-danger/10 text-danger"><app-icon name="clock-alert-outline" /> Vencido</span>
            }
            @if (t.stale) {
              <span class="badge st-PENDING" [title]="'Último movimiento: ' + formatDateTime(t.lastActivityAt) + '. Agrega una observación o actualiza el caso para quitar el aviso.'">
                <app-icon name="bell-ring-outline" /> Olvidado
              </span>
            }
            @if (t.aiGenerated) {
              <span class="badge bg-elevated text-muted" title="El borrador de este caso lo redactó la IA"><app-icon name="creation-outline" /> IA</span>
            }
            @if (t.archivedAt) {
              <span class="badge bg-elevated text-muted" [title]="'Archivado el ' + formatDateTime(t.archivedAt) + '. No aparece en las listas salvo que se filtre por archivados.'">
                <app-icon name="archive-outline" /> Archivado
              </span>
            }
          }
        </div>
        <button type="button" class="btn btn-ghost px-2" (click)="close()" aria-label="Cerrar" cdkFocusInitial>
          <app-icon name="close" class="text-lg" />
        </button>
      </header>

      @if (stored(); as t) {
        @if (draft(); as d) {
          <div class="min-h-0 flex-1 space-y-5 overflow-auto p-4">
            <section class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="tp-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
                <input
                  id="tp-date"
                  class="input aria-[invalid=true]:border-danger"
                  type="date"
                  [max]="today"
                  [ngModel]="d.date"
                  (ngModelChange)="set('date', $event)"
                  [attr.aria-invalid]="problems().date ? 'true' : null"
                  [attr.aria-describedby]="problems().date ? 'tp-date-error' : null"
                />
                @if (problems().date; as problem) {
                  <p class="field-error" id="tp-date-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
              </div>
              <div>
                <label class="label" for="tp-time" title="Hora en que el cliente reportó el problema. Opcional">Hora del caso</label>
                <div class="flex gap-1.5">
                  <input
                    #caseTime
                    id="tp-time"
                    class="input min-w-0 flex-1 aria-[invalid=true]:border-danger"
                    type="time"
                    [ngModel]="d.time"
                    (ngModelChange)="set('time', $event)"
                    (input)="watchTime(caseTime)"
                    (keyup)="watchTime(caseTime)"
                    [attr.aria-invalid]="problems().time ? 'true' : null"
                    [attr.aria-describedby]="problems().time ? 'tp-time-error' : null"
                  />
                  @if (d.time || timeHalfTyped()) {
                    <button type="button" class="btn btn-ghost px-2" aria-label="Quitar la hora del caso" title="Quitar la hora" (click)="clearTime()">
                      <app-icon name="close" />
                    </button>
                  }
                </div>
                @if (problems().time; as problem) {
                  <p class="field-error" id="tp-time-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
              </div>
              <div class="col-span-2">
                <span class="label" id="tp-registered-label" title="Momento en que se registró el ticket. La pone el sistema y no se edita">Fecha de registro</span>
                <div class="input truncate bg-elevated text-muted" aria-labelledby="tp-registered-label" [title]="t.createdByName ? 'Registrado por ' + t.createdByName : ''">
                  {{ formatDateTime(t.createdAt) }}{{ t.createdByName ? ' · ' + t.createdByName : '' }}
                </div>
              </div>
              <div class="col-span-2">
                <label class="label" for="tp-company">Empresa</label>
                <!--
                  A case always has a company: the select cannot be emptied. "Crear empresa «X»" adds it
                  to the catalog at once and chooses it in the draft: the case gets it with "Actualizar".
                -->
                <app-company-select
                  inputId="tp-company"
                  creatable
                  [clearable]="false"
                  [items]="companyOptions()"
                  [value]="d.companyId"
                  (valueChange)="set('companyId', $event)"
                />
              </div>
              <div class="col-span-2">
                <label class="label" for="tp-description">Descripción</label>
                <textarea
                  id="tp-description"
                  class="input min-h-24 resize-y aria-[invalid=true]:border-danger"
                  maxlength="5000"
                  [ngModel]="d.description"
                  (ngModelChange)="set('description', $event)"
                  [attr.aria-invalid]="problems().description ? 'true' : null"
                  [attr.aria-describedby]="problems().description ? 'tp-description-error' : null"
                ></textarea>
                @if (problems().description; as problem) {
                  <p class="field-error" id="tp-description-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
              </div>
              <div>
                <label class="label" for="tp-status">Estado</label>
                <app-status-select inputId="tp-status" [value]="d.status" (valueChange)="set('status', $event)" />
              </div>
              <div>
                <label class="label" for="tp-assignee">Responsable</label>
                <app-assignee-select inputId="tp-assignee" [items]="assigneeOptions()" [value]="d.assigneeId" (valueChange)="set('assigneeId', $event)" />
              </div>
              <div>
                <label class="label" for="tp-priority">Prioridad</label>
                <app-priority-select inputId="tp-priority" [value]="d.priority" (valueChange)="set('priority', $event)" />
              </div>
              <div>
                <label class="label" for="tp-module">Módulo</label>
                <app-module-select inputId="tp-module" [items]="moduleOptions()" [value]="d.moduleId" (valueChange)="set('moduleId', $event)" />
              </div>
              <div class="col-span-2">
                <label class="label" for="tp-types">Tipos de soporte</label>
                <app-support-type-select inputId="tp-types" multiple [items]="typeOptions()" [value]="d.supportTypeIds" (valueChange)="set('supportTypeIds', $event)" />
              </div>
              <div class="col-span-2 rounded-control border border-line px-3 py-2.5">
                <div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
                  <label class="flex cursor-pointer items-center gap-2 font-medium" title="Día en que se le prometió al cliente tener el caso resuelto">
                    <input type="checkbox" role="switch" class="sr-only" [ngModel]="d.promiseOn" (ngModelChange)="set('promiseOn', $event)" />
                    <span class="toggle" aria-hidden="true"></span>
                    Promesa de entrega
                  </label>
                  @if (d.promiseOn) {
                    <input
                      class="input w-auto py-1.5 aria-[invalid=true]:border-danger"
                      type="date"
                      aria-label="Fecha prometida de entrega"
                      [ngModel]="d.promisedDate"
                      (ngModelChange)="set('promisedDate', $event)"
                      [attr.aria-invalid]="problems().promisedDate ? 'true' : null"
                      [attr.aria-describedby]="problems().promisedDate ? 'tp-promise-error' : null"
                    />
                    @if (problems().promisedDate; as problem) {
                      <span class="text-xs text-muted" id="tp-promise-error">{{ problem }}</span>
                    } @else if (t.promiseState && d.promisedDate === t.promisedDate) {
                      <!-- Where the promise of the case stands. A date not saved yet is no promise of the case. -->
                      <span class="text-xs font-medium" [class]="promiseClass[t.promiseState]">{{ promiseText(t.promisedDate) }}</span>
                    }
                  } @else {
                    <span class="text-xs text-muted">Sin fecha prometida al cliente</span>
                  }
                </div>
              </div>
            </section>

            <app-ticket-times
              [ticket]="t"
              [estimated]="d.estimatedMinutes"
              (estimatedChange)="set('estimatedMinutes', $event)"
              [spent]="d.spentMinutes"
              (spentChange)="set('spentMinutes', $event)"
              [(notNumber)]="notNumber"
              [problems]="problems()"
              [spentUnsaved]="spentUnsaved()"
              (tidy)="tidyMinutes()"
              (timer)="timer($event)"
            />

            <app-ticket-notes [notes]="t.notes" [(text)]="noteText" (add)="addNote()" (remove)="removeNote($event)" />

            <app-ticket-reply
              [reply]="d.customerReply"
              (replyChange)="set('customerReply', $event)"
              [storedReply]="t.customerReply"
              [replying]="replying()"
              [aiReady]="catalogs.aiReady()"
              [unsaved]="unsaved()"
              (generate)="generateReply(true)"
            />

            <app-ticket-attachments [ticketId]="t.id" [attachments]="t.attachments" />

            <app-ticket-history [history]="t.history" />

            <div class="flex flex-wrap gap-2">
              <!-- No question asked: a case that was archived is brought back with the same button. -->
              <button type="button" class="btn btn-soft" [disabled]="archiving()" (click)="archive(!t.archivedAt, $event)">
                <app-icon [name]="t.archivedAt ? 'archive-arrow-up-outline' : 'archive-arrow-down-outline'" />
                {{ t.archivedAt ? 'Desarchivar' : 'Archivar' }}
              </button>
              <button type="button" class="btn btn-danger" (click)="remove()">
                <app-icon name="trash-can-outline" /> Eliminar caso
              </button>
            </div>
          </div>

          @if (behind()) {
            <p class="flex flex-wrap items-center gap-x-3 border-t border-line bg-warning/10 px-4 py-1.5 text-xs" role="status">
              <span><app-icon name="alert-outline" class="text-warning" /> Este caso cambió en otra pantalla.</span>
              <button type="button" class="py-1 font-medium underline underline-offset-2 disabled:cursor-not-allowed disabled:opacity-50" [disabled]="saving()" (click)="reset()">
                Ver la versión actual
              </button>
            </p>
          }
          <!--
            Outside the part that scrolls: always in view, wherever the person is in the form.
            Its buttons start from the left: the toasts of the app come up over the right corner,
            and would cover "Actualizar" right when a save that failed has to be sent again.
          -->
          <footer class="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3">
            <button type="button" class="btn btn-primary" [disabled]="!canSave()" (click)="update()">
              <app-icon [name]="saving() ? 'loading' : 'content-save-outline'" />
              {{ saving() ? 'Guardando…' : 'Actualizar' }}
            </button>
            @if (unsaved()) {
              <button type="button" class="btn btn-ghost" [disabled]="saving()" (click)="discard()">Descartar cambios</button>
            }
            <p class="ml-auto text-xs text-muted" role="status">
              @if (unsaved()) {
                <app-icon name="circle-medium" class="text-warning" /> Cambios sin guardar
              }
            </p>
          </footer>
        }
      } @else {
        <p class="p-6 text-muted">Cargando…</p>
      }
    </aside>
  `,
})
export class TicketPanel {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  /** Given with every question the panel asks: closed with one on screen, the question goes with it. */
  private readonly destroyRef = inject(DestroyRef);
  protected readonly catalogs = inject(Catalogs);

  /**
   * The case to show. Two-way: given another case with unsaved changes on screen, the person may
   * rather keep editing, and the panel then puts here the case it stayed on (see go).
   */
  readonly ticketId = model.required<number>();
  /** Draft the client reply as soon as the case loads (the case was just resolved from a list). */
  readonly autoReply = input(false);
  readonly closed = output<void>();

  /** The case the panel is on. It is behind `ticketId` only while the person is asked whether to leave it. */
  private readonly caseId = signal<number | null>(null);
  /** The case as the server has it. What is not a field of the form is shown from here. */
  protected readonly stored = signal<TicketDetail | null>(null);
  /** The fields of the form as the person has them. */
  protected readonly draft = signal<Draft | null>(null);
  /**
   * The fields as the case had them when the form last took them: what the draft is compared
   * with to tell what the person changed. It is the stored case, except while the form is
   * `behind` it.
   */
  private readonly base = signal<Draft | null>(null);
  /** The reads of the case, of which only the latest counts, and how many saves of the case were shown (see read). */
  private readonly reads = latest();
  private saves = 0;
  /** No read of the case the panel was given has been shown yet. */
  private unread = true;
  /**
   * A turn for each case the panel was given. What is asked for one of them (a save, a question to
   * the person) keeps its turn: answered under another one, the form on screen is not the one it
   * left. Not the id of the case: the panel can be back on the same case, with its form made again.
   */
  private readonly visits = latest();
  /** The question about leaving the case that is on screen, so that it is asked once (see mayLeave). */
  private leaving: Promise<boolean> | null = null;

  /**
   * The time field holds a time that is half typed. The browser reports such a field as empty,
   * which in the draft is a case without a time: saved like that, it would take the time off.
   */
  protected readonly timeHalfTyped = signal(false);
  private readonly timeBox = viewChild<ElementRef<HTMLInputElement>>('caseTime');
  /** The fields of minutes that hold a text that is not a number, as the "Tiempos" block tells (see NotNumber). */
  protected readonly notNumber = signal<NotNumber>(NO_NOT_NUMBER);
  private readonly times = viewChild(TicketTimes);
  /** What the fields hold besides the draft. */
  private readonly unreadable = computed<Unreadable>(() => ({ timeHalfTyped: this.timeHalfTyped(), notNumber: this.notNumber() }));

  /** What "Actualizar" would send of the case: the fields the draft changes, and nothing else. */
  private readonly changes = computed<TicketInput>(() => {
    const draft = this.draft();
    const base = this.base();
    return draft && base ? changesOf(draft, base) : {};
  });
  /** The fields of the form hold something the case does not have (see isDirty). */
  private readonly dirty = computed(() => {
    const draft = this.draft();
    const base = this.base();
    return !!draft && !!base && isDirty(draft, base, this.unreadable());
  });
  /** What keeps the draft from being saved as it stands. Each is said next to its field. */
  protected readonly problems = computed<Problems>(() => {
    const draft = this.draft();
    return draft ? problemsOf(draft, this.unreadable()) : {};
  });

  /** "Nueva observación": what is typed there is added with its button, or with "Actualizar". */
  protected readonly noteText = signal('');
  private readonly noteTyped = computed(() => !!this.noteText().trim());
  /**
   * The form holds something that is not saved: in its fields, or an observation typed and not
   * added. Said at the foot of the form, and asked about on every way out.
   */
  protected readonly unsaved = computed(() => this.dirty() || this.noteTyped());
  protected readonly saving = signal(false);
  protected readonly canSave = computed(() => (Object.keys(this.changes()).length > 0 || this.noteTyped()) && Object.keys(this.problems()).length === 0 && !this.saving());
  /**
   * The case changed somewhere else while the draft had changes, and the form does not show it:
   * the draft was left as the person has it (see take). Said in the form, with the way to see
   * the case as it is now.
   */
  protected readonly behind = computed(() => {
    const stored = this.stored();
    const base = this.base();
    return !!stored && !!base && changed(draftOf(stored), base).length > 0;
  });
  /** "Real (minutos)" has a change that is not saved (see timer). */
  protected readonly spentUnsaved = computed(() => 'spentMinutes' in this.changes());
  protected readonly archiving = signal(false);

  /**
   * The case whose client reply the AI is writing. Kept by case, not as a yes or no: the answer
   * can arrive when the panel shows another case, which must not look busy because of it.
   */
  private readonly replyingFor = signal<number | null>(null);
  protected readonly replying = computed(() => this.replyingFor() !== null && this.replyingFor() === this.caseId());

  private readonly attachments = viewChild(TicketAttachments);

  // What each select offers: see offered.
  protected readonly companyOptions = computed(() => {
    const ticket = this.stored();
    return offered<{ id: number; name: string }>(this.catalogs.companies(), ticket ? [{ id: ticket.companyId, name: ticket.company }] : []);
  });
  protected readonly assigneeOptions = computed(() => {
    const ticket = this.stored();
    return offered<{ id: number; name: string }>(this.catalogs.assignees(), ticket?.assigneeId ? [{ id: ticket.assigneeId, name: ticket.assigneeName ?? '' }] : []);
  });
  protected readonly moduleOptions = computed(() => {
    const ticket = this.stored();
    return offered<{ id: number; fullName: string }>(this.catalogs.modules(), ticket?.moduleId ? [{ id: ticket.moduleId, fullName: ticket.moduleName ?? '' }] : []);
  });
  protected readonly typeOptions = computed(() => offered<TicketSupportType>(this.catalogs.supportTypes(), this.stored()?.supportTypes ?? []));
  /** Upper limit of the case date: a problem cannot be reported in the future. */
  protected readonly today = todayIso();
  protected readonly promiseClass = PROMISE_CLASS;
  protected readonly promiseText = promiseText;
  protected readonly formatDateTime = formatDateTime;

  constructor() {
    effect(() => {
      const id = this.ticketId();
      untracked(() => void this.go(id));
    });

    // The Back button takes away the whole screen the panel is on: it asks through here.
    const unwatch = inject(UnsavedChanges).watch(() => this.mayLeave());
    this.destroyRef.onDestroy(() => {
      unwatch();
      // What is still unanswered when the panel goes away has no form to come back to.
      this.leave();
    });

    // The case is followed wherever it changes: in this panel, on another screen of this tab
    // or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        const id = this.caseId();
        if (event.kind === 'saved') {
          if (event.ticket.id === id) {
            this.saves++;
            this.take(event.ticket, true);
          }
        } else if (event.kind === 'removed') {
          // Nothing is asked about the draft: there is no case left to save it to.
          if (event.id === id) this.closed.emit();
        } else if (id !== null && (event.id === null || event.id === id)) {
          void this.read(id);
        }
      });
  }

  /**
   * Takes the panel to the case it was given. With unsaved changes the person is asked first, as
   * on every other way out. When they would rather keep editing, the panel stays on its case
   * and says so through `ticketId`, so that whoever sent the other one knows which case is open.
   */
  private async go(id: number): Promise<void> {
    const shown = this.caseId();
    if (id === shown) return;
    if (shown !== null && this.unsaved() && !(await this.mayLeave())) {
      this.ticketId.set(shown);
      return;
    }
    // The question may have been on screen for a while: the case wanted is the last one given.
    const wanted = this.ticketId();
    if (wanted !== this.caseId()) this.open(wanted);
  }

  /** Starts on a case. Nothing of the one shown until now is kept. */
  private open(id: number): void {
    this.leave();
    this.caseId.set(id);
    this.unread = true;
    // An observation typed and not added belongs to the case that is left: carried along,
    // it would be added to another one.
    this.noteText.set('');
    this.timeHalfTyped.set(false);
    this.notNumber.set(NO_NOT_NUMBER);
    this.stored.set(null);
    this.draft.set(null);
    this.base.set(null);
    void this.read(id);
  }

  /** The form on screen is about to go, with the case or with the panel: nothing answered later is its own. */
  private leave(): void {
    this.visits.next();
    this.saving.set(false);
    this.archiving.set(false);
  }

  /**
   * Takes a version of the case from the server. `own`: it answers something done in this tab
   * (a save, an observation, the timer…). Otherwise it was read because the case changed
   * somewhere else.
   *
   * The draft is the person's: a field they changed is never written here. The rest of the
   * form follows the case, with one exception. When the case changes elsewhere while the draft
   * has changes, the whole form stays as the person sees it, and says so (see `behind`): they
   * decide whether to look at the case as it is now, which drops the draft.
   */
  private take(next: TicketDetail, own: boolean): void {
    const before = this.stored();
    const draft = this.draft();
    const base = this.base();
    const fields = draftOf(next);
    this.stored.set(next);
    if (!before || !draft || !base) {
      // The first version of the case the panel sees: the form starts from it.
      this.draft.set(fields);
      this.base.set(fields);
      return;
    }
    // Changed elsewhere, with unsaved changes in the form: the form stays as it is. Unless the
    // case arrives with what the form holds (stored although its answer got lost, or written the
    // same by someone else): nothing of the draft is then left to save. An observation typed
    // and not added holds no field back: with only that unsaved, the form follows the case.
    if (!own && this.dirty() && changed(fields, draft).length > 0) return;
    // What this version brings to the form. For something done here, what it changed in the
    // stored case: a form that is behind stays behind in everything else. Read from elsewhere
    // with nothing unsaved in the form, all that the form does not have yet.
    const form = withVersion({ draft, base }, fields, own ? draftOf(before) : base);
    this.base.set(form.base);
    this.draft.set(form.draft);
  }

  /**
   * Reads the case: when the panel is given it, and again after someone else (or an assistant)
   * changed it. All the reads take turns together, the first one too: it can be answered after
   * a newer read, or after a save, and must not put the older case back on screen. A newer read
   * cancels the one before.
   */
  private async read(id: number): Promise<void> {
    const read = this.reads.next();
    const saves = this.saves;
    // The answer counts only while the panel shows the same case and no newer read started.
    const current = (): boolean => id === this.caseId() && read.current();
    try {
      const ticket = await this.api.ticket(id, read.signal);
      if (!current()) return;
      // A save answered meanwhile may be newer than this read, which would undo it on screen.
      // Dropping the read is not enough: that save may in turn be older than the change that
      // asked for the read. So the case is read once more.
      if (saves !== this.saves) return this.read(id);
      const first = this.unread;
      this.unread = false;
      this.take(ticket, false);
      if (first && this.autoReply() && !ticket.customerReply) void this.generateReply(false);
    } catch (error) {
      if (!current()) return;
      if (!this.stored()) {
        // The case could not be read at all and nothing else put it on screen (a save of it
        // answered meanwhile would have): there is nothing to show.
        this.toast.error(error);
        this.closed.emit();
      } else if (error instanceof HttpErrorResponse && error.status === 404) {
        // Only "not found" means the case is gone. Any other failure (connection, server
        // restart) says nothing about the case, which stays open.
        this.toast.error('Este caso fue eliminado desde otra sesión');
        this.closed.emit();
      } else {
        this.toast.error(error);
      }
    }
  }

  /** One field of the form changed by the person. Nothing is sent: the draft takes it. */
  protected set<K extends keyof Draft>(field: K, value: Draft[K]): void {
    this.draft.update((draft) => draft && { ...draft, [field]: value });
  }

  /**
   * Called with what the person does in the time field, to tell whether it is left half typed.
   * With every key too: for a time started in an empty field the browser reports no change,
   * since the field was empty and, to it, still is.
   */
  protected watchTime(box: HTMLInputElement): void {
    this.timeHalfTyped.set(box.validity.badInput);
  }

  /**
   * Takes the time off the draft, which then has only its date. A button and not the emptied
   * field: a time field is also empty while a time is being typed in it.
   */
  protected clearTime(): void {
    this.emptyHalfTypedTime();
    this.set('time', '');
  }

  /** A time left half typed is in its field alone, which reported it as empty: the draft never had it to give up. */
  private emptyHalfTypedTime(): void {
    if (!this.timeHalfTyped()) return;
    const box = this.timeBox()?.nativeElement;
    if (box) box.value = '';
    this.timeHalfTyped.set(false);
  }

  /**
   * On leaving a field of minutes: it shows them as they would be stored (see tidied), so that what
   * the field shows is what is saved.
   */
  protected tidyMinutes(): void {
    const notNumber = this.notNumber();
    this.draft.update((draft) => draft && tidied(draft, notNumber));
  }

  /**
   * "Actualizar": saves what the form holds. First the draft, as one save with only the fields
   * it changes. Stored, the form shows the case as the server has it; refused or failed, the
   * draft stays as it is, to be corrected or sent again, and nothing else is sent.
   *
   * Then the observation typed and not added, as "Agregar" would add it: the person who presses
   * "Actualizar" takes the whole form for saved. When it cannot be added the fields stay
   * stored, and its text goes back into its box, still to be saved.
   */
  protected async update(): Promise<void> {
    const id = this.caseId();
    const sent = this.draft();
    // Also a second press that arrives before the button is drawn disabled.
    if (id === null || !sent || !this.canSave()) return;
    const input = this.changes();
    const fields = Object.keys(input).length > 0;
    const note = this.noteText().trim();
    const visit = this.visits.now();
    this.saving.set(true);
    try {
      let resolved = false;
      if (fields) {
        // The stored case comes back through its "saved" event (see the constructor).
        const updated = await this.api.updateTicket(id, input);
        this.toast.ok('Caso actualizado');
        if (visit.current()) this.showSaved(sent);
        resolved = input.status === 'RESOLVED' && !updated.customerReply;
      }
      // The observation as it was when the button was pressed. Not once its box holds something
      // else: the person went on writing it, or added it with its own button meanwhile. Nor
      // once the form is gone, with what they chose to leave unsaved.
      if (note && visit.current() && this.noteText().trim() === note) {
        try {
          await this.postNote(id, note);
          // With no field to save, this is all "Actualizar" did.
          if (!fields) this.toast.ok('Caso actualizado');
        } catch (error) {
          // Said as what it is: the fields sent before it were stored, and the form has just said so.
          this.toast.error(`No se pudo agregar la observación: ${errorMessage(error)}`);
        }
      }
      // Resolving a case drafts the message for the client, once the case is stored as resolved.
      // After the observation: it often says what was done, and the AI reads it.
      if (resolved) void this.generateReply(false, id);
    } catch (error) {
      this.toast.error(error);
    } finally {
      if (visit.current()) this.saving.set(false);
    }
  }

  /**
   * After a save: the whole form shows the stored case. Except what the person changed while
   * the save was on its way, after `sent`: that is theirs, and stays as a change still to save.
   */
  private showSaved(sent: Draft): void {
    const stored = this.stored();
    const draft = this.draft();
    if (!stored || !draft) return;
    const form = afterSave(draftOf(stored), draft, sent);
    this.base.set(form.base);
    this.draft.set(form.draft);
  }

  /**
   * Puts the stored case in the form, over whatever the draft holds: "Ver la versión actual"
   * when the case changed elsewhere meanwhile, and part of "Descartar cambios". Not while a
   * save is on its way (both are shown disabled): its answer would find a draft that is not the
   * one sent.
   */
  protected reset(): void {
    const stored = this.stored();
    if (!stored || this.saving()) return;
    const fields = draftOf(stored);
    this.emptyHalfTypedTime();
    this.times()?.emptyNotNumbers();
    this.draft.set(fields);
    this.base.set(fields);
  }

  /**
   * "Descartar cambios": nothing unsaved is left in the form. The fields go back to the stored
   * case, and the observation typed and not added is emptied too. ("Ver la versión actual"
   * keeps that one: it is about the fields of the case, and the observation is still to add.)
   */
  protected discard(): void {
    if (this.saving()) return;
    this.reset();
    this.noteText.set('');
  }

  /**
   * Whether the case on screen can be left: at once when the form holds nothing unsaved, and
   * otherwise what the person answers. Asked once, however many ways out are taken while the
   * question is on screen (Escape again, another case arriving). Every way out comes through
   * here: the ones of the panel, another case given to it, and the screen under it being left
   * (see UnsavedChanges).
   */
  private mayLeave(): Promise<boolean> {
    if (!this.unsaved()) return Promise.resolve(true);
    // Drawn as a danger, with the focus on staying: what is discarded cannot be brought back.
    this.leaving ??= this.confirm
      .ask({ title: 'Hay cambios sin guardar', confirmLabel: 'Descartar y salir', cancelLabel: 'Seguir editando', danger: true }, this.destroyRef)
      .finally(() => (this.leaving = null));
    return this.leaving;
  }

  /** The button that closes, a press outside the panel and Escape. */
  protected async close(): Promise<void> {
    const visit = this.visits.now();
    if ((await this.mayLeave()) && visit.current()) this.closed.emit();
  }

  /** Escape closes an enlarged attachment first, then the panel. */
  protected onEscape(): void {
    if (this.attachments()?.closeLightbox()) return;
    void this.close();
  }

  /** Closing or reloading the tab with unsaved changes: the browser asks, in its own words. */
  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.unsaved()) return;
    event.preventDefault();
    // What older browsers ask with.
    event.returnValue = true;
  }

  /**
   * Asks the AI for the client message. `manual` is true for the button: it then confirms
   * before replacing a message the case has. Automatic calls stay silent when no provider is
   * active.
   *
   * The AI writes from the stored case and stores the message in it. So the button does nothing
   * while the form has unsaved changes (it is shown disabled, and says why): the message would
   * leave out what the person is changing, or the observation they have not added, and they
   * would not know. The draft itself is never touched by the answer. The new message reaches the reply box like any change of the case
   * (see take): there unless the person is writing a message of their own, which stays.
   *
   * `id` is the case shown, unless the reply follows a save of another one: a case resolved
   * just before the panel moved on still gets its message.
   */
  protected async generateReply(manual: boolean, id = this.caseId()): Promise<void> {
    if (id === null || this.replyingFor() === id || !this.catalogs.aiReady()) return;
    if (manual) {
      if (this.unsaved()) return;
      const visit = this.visits.now();
      const replace = !this.stored()?.customerReply || (await this.confirm.ask({ title: '¿Reemplazar la respuesta actual por una nueva?', confirmLabel: 'Reemplazar' }, this.destroyRef));
      // The question was on screen for a while: the panel may be on another case by now.
      if (!replace || !visit.current() || this.replyingFor() === id) return;
    }
    this.replyingFor.set(id);
    try {
      await this.api.aiReply(id);
    } catch (error) {
      this.toast.error(error);
    } finally {
      // Unless a reply for another case started meanwhile: that one is still being written.
      if (this.replyingFor() === id) this.replyingFor.set(null);
    }
  }

  /**
   * Starts or stops the timer, at once and whatever the draft holds: it runs on the stored case
   * and nothing of the draft is sent with it. Its answer brings the time spent, which the form
   * shows like any change of the case (see take).
   *
   * Stopping it adds the minutes that ran to the time spent of the case. With an unsaved change
   * in "Real (minutos)" that sum would be written over by the next "Actualizar", so the button
   * to stop is disabled until that change is saved or discarded, and says so. Starting it
   * writes no minutes and is never held back.
   */
  protected async timer(action: 'start' | 'stop'): Promise<void> {
    const id = this.caseId();
    if (id === null || (action === 'stop' && this.spentUnsaved())) return;
    try {
      await this.api.timer(id, action);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** "Agregar", and Ctrl+Enter in the box: the observation typed is added at once, whatever the draft holds. */
  protected async addNote(): Promise<void> {
    const text = this.noteText().trim();
    const id = this.caseId();
    if (!text || id === null) return;
    try {
      await this.postNote(id, text);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /**
   * Sends an observation, which leaves its box at once. When it could not be added it fails
   * with the reason, for whoever sent it to say, and the text is put back to be sent again.
   */
  private async postNote(id: number, text: string): Promise<void> {
    this.noteText.set('');
    try {
      await this.api.addNote(id, text);
    } catch (error) {
      // Back into the box. Unless the panel moved on: the box is now the one of another case,
      // where this note does not belong.
      if (id === this.caseId()) this.noteText.set(text);
      throw error;
    }
  }

  protected async removeNote(noteId: number): Promise<void> {
    const id = this.caseId();
    const visit = this.visits.now();
    if (id === null || !(await this.confirm.ask({ title: '¿Eliminar esta observación?', confirmLabel: 'Eliminar', danger: true }, this.destroyRef)) || !visit.current()) return;
    try {
      await this.api.deleteNote(id, noteId);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** Files can be dropped anywhere on the panel; the attachments block uploads them. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    void this.attachments()?.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  /**
   * Archives the case, or brings it back, at once. Sent alone and not with the draft: putting a
   * case away is not working on it (the server leaves its last activity where it was), and the
   * draft is still the person's to save or to discard.
   *
   * `press` is the click on the button, which is the same for both. The second click of a
   * double click does nothing: on a fast server it finds the button already saying the
   * opposite, and would undo what the first one did.
   */
  protected async archive(archived: boolean, press: MouseEvent): Promise<void> {
    const id = this.caseId();
    if (id === null || this.archiving() || press.detail > 1) return;
    const visit = this.visits.now();
    this.archiving.set(true);
    try {
      await this.api.updateTicket(id, { archived });
      this.toast.ok(archived ? 'Caso archivado' : 'Caso desarchivado');
    } catch (error) {
      this.toast.error(error);
    } finally {
      if (visit.current()) this.archiving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const ticket = this.stored();
    if (!ticket) return;
    const visit = this.visits.now();
    const confirmed = await this.confirm.ask(
      {
        title: `¿Eliminar el caso ${ticket.code}?`,
        message: 'Se eliminan también sus observaciones y adjuntos. No se puede deshacer.',
        confirmLabel: 'Eliminar',
        danger: true,
      },
      this.destroyRef,
    );
    if (!confirmed || !visit.current()) return;
    try {
      // The "removed" event closes this panel (see the constructor).
      await this.api.deleteTicket(ticket.id);
      this.toast.ok(`Caso ${ticket.code} eliminado`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
