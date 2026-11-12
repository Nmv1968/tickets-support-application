import { A11yModule } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, linkedSignal, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketInput } from '../../core/api';
import { Catalogs, assigneeInput, assigneeValue } from '../../core/catalogs';
import { StoredValue } from '../../core/stored-value';
import { TicketEvents } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { PRIORITIES, PRIORITY_LABEL, PROMISE_CLASS, STATUSES, STATUS_LABEL, copyText, formatDateTime, formatMinutes, promiseText, todayIso } from '../../core/ui';
import { TicketAttachments } from './ticket-attachments';

/** No case is older than this. A date before it is a year that is still being typed. */
const OLDEST_DATE = '1900-01-01';

/** How long a date field has to be left alone before the date in it is saved. */
const DATE_PAUSE_MS = 700;

/** The two dates of a case and its time of day: the browser reports all three the same way while they are typed. */
type DateField = 'date' | 'promisedDate' | 'time';

/** A date typed or picked in a field, waiting for the pause that saves it. */
interface PendingDate {
  /** The case it was typed for: the panel may show another one by the time it is saved. */
  id: number;
  value: string;
  /** The field it was typed in. */
  box: StoredValue;
  timer: ReturnType<typeof setTimeout>;
}

/** The fields where the person writes free text. */
const TEXT_FIELDS = ['company', 'description', 'customerReply'] as const;
type TextField = (typeof TEXT_FIELDS)[number];

/** The fields where the person types. The case on screen takes what they type only once it is stored (see saveTyped). */
type TypedField = TextField | DateField;

/** The saves of one typed field that are still unanswered. */
interface Sending {
  /** What the last of them sent: what the case is going to have in that field. */
  value: string | null;
  /** How many. A field can be saved again before its earlier save is answered. */
  count: number;
}

/** Side panel with every field of one case. Each change saves on its own; there is no "Guardar" button. */
@Component({
  selector: 'app-ticket-panel',
  imports: [FormsModule, A11yModule, StoredValue, TicketAttachments],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'onEscape()' },
  template: `
    <div class="fixed inset-0 z-40 bg-black/40" (click)="closed.emit()" aria-hidden="true"></div>
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
      <header class="flex items-center gap-2 border-b border-line px-4 py-3">
        @if (ticket(); as t) {
          <span class="font-mono text-sm font-semibold text-primary">{{ t.code }}</span>
          <span class="badge" [class]="'st-' + t.status">{{ statusLabel[t.status] }}</span>
          @if (t.overdue) {
            <span class="badge bg-danger/10 text-danger"><i class="mdi mdi-clock-alert-outline" aria-hidden="true"></i> Vencido</span>
          }
          @if (t.stale) {
            <span class="badge st-PENDING" [title]="'Último movimiento: ' + formatDateTime(t.lastActivityAt) + '. Agrega una observación o actualiza el caso para quitar el aviso.'">
              <i class="mdi mdi-bell-ring-outline" aria-hidden="true"></i> Olvidado
            </span>
          }
          @if (t.aiGenerated) {
            <span class="badge bg-elevated text-muted" title="El borrador de este caso lo redactó la IA"><i class="mdi mdi-creation-outline" aria-hidden="true"></i> IA</span>
          }
        }
        <button type="button" class="btn btn-ghost ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar" cdkFocusInitial>
          <i class="mdi mdi-close text-lg" aria-hidden="true"></i>
        </button>
      </header>

      @if (ticket(); as t) {
        <div class="min-h-0 flex-1 space-y-5 overflow-auto p-4">
          <section class="grid grid-cols-2 gap-3">
            <div>
              <label class="label" for="tp-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
              <input
                #caseDate="storedValue"
                id="tp-date"
                class="input"
                type="date"
                [max]="today"
                [appStoredValue]="t.date"
                [saving]="!!sending().date"
                (input)="onDateInput('date', caseDate)"
                (blur)="onDateBlur('date', caseDate)"
              />
            </div>
            <div>
              <label class="label" for="tp-time" title="Hora en que el cliente reportó el problema. Opcional">Hora del caso</label>
              <div class="flex gap-1.5">
                <input
                  #caseTime="storedValue"
                  id="tp-time"
                  class="input min-w-0 flex-1"
                  type="time"
                  [appStoredValue]="t.time ?? ''"
                  [saving]="!!sending().time"
                  (input)="onDateInput('time', caseTime)"
                  (blur)="onDateBlur('time', caseTime)"
                />
                @if (t.time) {
                  <button type="button" class="btn btn-ghost px-2" aria-label="Quitar la hora del caso" title="Quitar la hora" [disabled]="!!sending().time" (click)="clearTime(caseTime)">
                    <i class="mdi mdi-close" aria-hidden="true"></i>
                  </button>
                }
              </div>
            </div>
            <div class="col-span-2">
              <span class="label" id="tp-registered-label" title="Momento en que se registró el ticket. La pone el sistema y no se edita">Fecha de registro</span>
              <div class="input truncate bg-elevated text-muted" aria-labelledby="tp-registered-label" [title]="t.createdByName ? 'Registrado por ' + t.createdByName : ''">
                {{ formatDateTime(t.createdAt) }}{{ t.createdByName ? ' · ' + t.createdByName : '' }}
              </div>
            </div>
            <div class="col-span-2">
              <label class="label" for="tp-company">Empresa</label>
              <input
                #companyBox="storedValue"
                id="tp-company"
                class="input aria-[invalid=true]:border-danger"
                maxlength="200"
                [appStoredValue]="t.company"
                [saving]="!!sending().company"
                [attr.aria-invalid]="unsaved().company ? 'true' : null"
                [attr.aria-describedby]="unsaved().company ? 'tp-company-unsaved' : null"
                (change)="saveText('company', companyBox)"
              />
              @if (unsaved().company) {
                <p class="unsaved-hint" id="tp-company-unsaved">
                  <span><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> No se guardó.</span>
                  <button type="button" [disabled]="!!sending().company" (click)="retryText('company', companyBox)">Reintentar</button>
                  <button type="button" [disabled]="!!sending().company" (click)="discardText('company', companyBox)">Descartar</button>
                </p>
              }
            </div>
            <div class="col-span-2">
              <label class="label" for="tp-description">Descripción</label>
              <textarea
                #descriptionBox="storedValue"
                id="tp-description"
                class="input min-h-24 resize-y aria-[invalid=true]:border-danger"
                maxlength="5000"
                [appStoredValue]="t.description"
                [saving]="!!sending().description"
                [attr.aria-invalid]="unsaved().description ? 'true' : null"
                [attr.aria-describedby]="unsaved().description ? 'tp-description-unsaved' : null"
                (change)="saveText('description', descriptionBox)"
              ></textarea>
              @if (unsaved().description) {
                <p class="unsaved-hint" id="tp-description-unsaved">
                  <span><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> No se guardó.</span>
                  <button type="button" [disabled]="!!sending().description" (click)="retryText('description', descriptionBox)">Reintentar</button>
                  <button type="button" [disabled]="!!sending().description" (click)="discardText('description', descriptionBox)">Descartar</button>
                </p>
              }
            </div>
            <div>
              <label class="label" for="tp-status">Estado</label>
              <select id="tp-status" class="input" [ngModel]="t.status" (ngModelChange)="save({ status: $event })">
                @for (s of statuses; track s) {
                  <option [value]="s">{{ statusLabel[s] }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="tp-assignee">Responsable</label>
              <select id="tp-assignee" class="input" [ngModel]="assigneeValue(t)" (ngModelChange)="save(assigneeInput($event))">
                <option value="">Sin asignar</option>
                @for (person of catalogs.assignees(); track person.id) {
                  @if (person.active || person.id === t.assigneeId) {
                    <option [value]="person.id">{{ person.name }}</option>
                  }
                }
                <option value="client">Cliente</option>
              </select>
            </div>
            <div>
              <label class="label" for="tp-priority">Prioridad</label>
              <select id="tp-priority" class="input" [ngModel]="t.priority ?? ''" (ngModelChange)="savePriority($event)">
                <option value="">Sin prioridad</option>
                @for (p of priorities; track p) {
                  <option [value]="p">{{ priorityLabel[p] }}</option>
                }
              </select>
            </div>
            <div>
              <label class="label" for="tp-module">Módulo</label>
              <select id="tp-module" class="input" [ngModel]="t.moduleId ?? ''" (ngModelChange)="save({ moduleId: $event ? +$event : null })">
                <option value="">Sin módulo</option>
                @for (module of catalogs.modules(); track module.id) {
                  <option [value]="module.id">{{ module.fullName }}</option>
                }
              </select>
            </div>
            <div class="col-span-2 rounded-control border border-line px-3 py-2.5">
              <div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
                <label class="flex cursor-pointer items-center gap-2 font-medium" title="Día en que se le prometió al cliente tener el caso resuelto">
                  <input type="checkbox" role="switch" class="sr-only" [checked]="promiseOn()" (change)="togglePromise($event)" />
                  <span class="toggle" aria-hidden="true"></span>
                  Promesa de entrega
                </label>
                @if (promiseOn()) {
                  <input
                    #promised="storedValue"
                    class="input w-auto py-1.5"
                    type="date"
                    aria-label="Fecha prometida de entrega"
                    [appStoredValue]="t.promisedDate ?? ''"
                    [saving]="!!sending().promisedDate"
                    (input)="onDateInput('promisedDate', promised)"
                    (blur)="onDateBlur('promisedDate', promised)"
                  />
                  @if (t.promiseState; as state) {
                    <span class="text-xs font-medium" [class]="promiseClass[state]">{{ promiseText(t.promisedDate) }}</span>
                  } @else if (!t.promisedDate && !sending().promisedDate?.value) {
                    <span class="text-xs text-muted">Elige la fecha prometida</span>
                  }
                } @else {
                  <span class="text-xs text-muted">Sin fecha prometida al cliente</span>
                }
              </div>
            </div>
          </section>

          <section class="rounded-card border border-line p-3">
            <h2 class="section-title mb-2">Tiempos</h2>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="label" for="tp-estimated">Estimado (minutos)</label>
                <input id="tp-estimated" class="input" type="number" min="0" max="1000000" step="5" [value]="t.estimatedMinutes ?? ''" (change)="saveMinutes('estimatedMinutes', $event)" />
              </div>
              <div>
                <label class="label" for="tp-spent">Real (minutos)</label>
                <input id="tp-spent" class="input" type="number" min="0" max="1000000" step="5" [value]="t.spentMinutes" (change)="saveMinutes('spentMinutes', $event)" />
              </div>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              @if (t.timerStartedAt) {
                <button type="button" class="btn btn-danger" (click)="timer('stop')">
                  <i class="mdi mdi-stop" aria-hidden="true"></i> Detener cronómetro
                </button>
                <span class="text-xs text-muted">En marcha desde {{ formatDateTime(t.timerStartedAt) }}</span>
              } @else {
                <button type="button" class="btn btn-soft" [disabled]="t.status === 'RESOLVED'" (click)="timer('start')">
                  <i class="mdi mdi-play" aria-hidden="true"></i> Iniciar cronómetro
                </button>
                <span class="text-xs text-muted">Acumulado: {{ formatMinutes(t.spentMinutes) }}</span>
              }
            </div>
            <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              <dt class="text-muted">Fecha límite (SLA)</dt>
              <dd [class.text-danger]="t.overdue">{{ t.dueAt ? formatDateTime(t.dueAt) : 'Sin prioridad, sin fecha límite' }}</dd>
              @if (t.resolvedAt) {
                <dt class="text-muted">Resuelto</dt>
                <dd>{{ formatDateTime(t.resolvedAt) }}</dd>
              }
            </dl>
          </section>

          <section>
            <h2 class="section-title mb-2">Observaciones</h2>
            <div class="flex gap-2">
              <textarea
                class="input min-h-10 resize-y"
                rows="2"
                placeholder="Nueva observación (Ctrl+Enter para guardar)"
                aria-label="Nueva observación"
                maxlength="5000"
                [(ngModel)]="noteText"
                (keydown.control.enter)="addNote()"
              ></textarea>
              <button type="button" class="btn btn-primary self-start" [disabled]="!noteText().trim()" (click)="addNote()">Agregar</button>
            </div>
            <ul class="mt-3 space-y-2">
              @for (note of t.notes; track note.id) {
                <li class="group rounded-control bg-elevated px-3 py-2">
                  <div class="flex items-center gap-2 text-2xs text-muted">
                    <span>{{ formatDateTime(note.createdAt) }}</span>
                    @if (note.authorName) {
                      <span>· {{ note.authorName }}</span>
                    }
                    <!--
                      Hidden until the note is hovered only where hovering exists: a touch screen always shows it.
                      The padding, taken back by the margins, gives a finger more than the icon to hit.
                    -->
                    <button
                      type="button"
                      class="-my-1.5 -mr-1.5 ml-auto p-1.5 can-hover:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                      (click)="removeNote(note.id)"
                      aria-label="Eliminar observación"
                    >
                      <i class="mdi mdi-trash-can-outline" aria-hidden="true"></i>
                    </button>
                  </div>
                  <p class="mt-0.5 whitespace-pre-line">{{ note.text }}</p>
                </li>
              } @empty {
                <li class="text-xs text-muted">Sin observaciones.</li>
              }
            </ul>
          </section>

          <section class="rounded-card border border-line p-3">
            <div class="mb-2 flex flex-wrap items-center gap-2">
              <h2 class="section-title mr-auto">Respuesta para el cliente</h2>
              <button
                type="button"
                class="btn btn-soft px-2 py-1 text-xs"
                [disabled]="replying() || !catalogs.aiReady()"
                [title]="catalogs.aiReady() ? 'Redacta el mensaje con el caso y sus observaciones' : 'Activa un proveedor en Configuración > IA'"
                (click)="generateReply(true, t.id, replyBox)"
              >
                <i class="mdi" [class]="replying() ? 'mdi-loading mdi-spin' : 'mdi-creation-outline'" aria-hidden="true"></i>
                {{ replying() ? 'Redactando…' : t.customerReply ? 'Volver a generar' : 'Generar con IA' }}
              </button>
              <button type="button" class="btn btn-primary px-2 py-1 text-xs" [disabled]="!t.customerReply && !replyTyped().trim()" (click)="copyReply(replyBox.value)">
                <i class="mdi" [class]="copied() ? 'mdi-check' : 'mdi-content-copy'" aria-hidden="true"></i>
                {{ copied() ? 'Copiado' : 'Copiar' }}
              </button>
            </div>
            <textarea
              #replyBox="storedValue"
              class="input min-h-28 resize-y aria-[invalid=true]:border-danger"
              aria-label="Respuesta para el cliente"
              placeholder="Mensaje para quien pidió el soporte. Se redacta con IA al resolver el caso, o escríbelo aquí."
              maxlength="5000"
              [appStoredValue]="t.customerReply ?? ''"
              [saving]="!!sending().customerReply"
              [attr.aria-invalid]="unsaved().customerReply ? 'true' : null"
              [attr.aria-describedby]="unsaved().customerReply ? 'tp-reply-unsaved' : null"
              (input)="replyTyped.set(replyBox.value)"
              (change)="saveText('customerReply', replyBox)"
            ></textarea>
            @if (unsaved().customerReply) {
              <p class="unsaved-hint" id="tp-reply-unsaved">
                <span><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> No se guardó.</span>
                <button type="button" [disabled]="!!sending().customerReply" (click)="retryText('customerReply', replyBox)">Reintentar</button>
                <button type="button" [disabled]="!!sending().customerReply" (click)="discardText('customerReply', replyBox)">Descartar</button>
              </p>
            }
            <p class="mt-1 text-2xs text-muted">Revisa el mensaje antes de enviarlo. Puedes editarlo; se guarda con el caso.</p>
          </section>

          <app-ticket-attachments [ticketId]="t.id" [attachments]="t.attachments" />

          <details class="rounded-card border border-line px-3 py-2">
            <summary class="section-title cursor-pointer">Historial de cambios ({{ t.history.length }})</summary>
            <ul class="mt-2 space-y-1 text-xs">
              @for (h of t.history; track h.id) {
                <li>
                  <span class="text-muted">{{ formatDateTime(h.createdAt) }} · {{ h.userName ?? 'Sistema' }}:</span>
                  {{ h.field }}
                  @if (h.oldValue || h.newValue) {
                    <span>de «{{ h.oldValue ?? '—' }}» a «{{ h.newValue ?? '—' }}»</span>
                  } @else {
                    <span>modificada</span>
                  }
                </li>
              } @empty {
                <li class="text-muted">Sin cambios registrados.</li>
              }
            </ul>
          </details>

          <button type="button" class="btn btn-danger" (click)="remove()">
            <i class="mdi mdi-trash-can-outline" aria-hidden="true"></i> Eliminar caso
          </button>
        </div>
      } @else {
        <p class="p-6 text-muted">Cargando…</p>
      }
    </aside>
  `,
})
export class TicketPanel {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  readonly ticketId = input.required<number>();
  /** Draft the client reply as soon as the case loads (the case was just resolved from a list). */
  readonly autoReply = input(false);
  readonly closed = output<void>();

  /** The case as the form shows it. It runs ahead of `stored` while a change is being saved. */
  protected readonly ticket = signal<TicketDetail | null>(null);
  /** The case as the server has it. */
  private stored: TicketDetail | null = null;
  /** Number of the last read started, and how many saves of the case were shown (see read). */
  private reads = 0;
  private saves = 0;
  /** No read of the case the panel was given has been shown yet. */
  private unread = true;
  /**
   * Counts the cases the panel was given. What is asked for one of them (a save, a note) keeps
   * the number: answered under another one, the fields on screen are not the ones it left.
   * Not the id of the case: the panel can be back on the same case, with its fields made again.
   */
  private visit = 0;
  /** Dates waiting to be saved, by field (see onDateInput). */
  private readonly pendingDates: Partial<Record<DateField, PendingDate>> = {};
  /** The typed fields with a save still unanswered (see saveTyped). */
  protected readonly sending = signal<Partial<Record<TypedField, Sending>>>({});
  /**
   * The text fields whose last save failed, with the text that was not stored: the field still
   * shows it and the case does not have it.
   */
  protected readonly unsaved = signal<Partial<Record<TextField, { text: string }>>>({});
  protected readonly noteText = signal('');
  private readonly promisedDate = computed(() => this.ticket()?.promisedDate ?? null);
  /**
   * The "Promesa de entrega" switch. Can be on with no date yet: turning it on only shows the
   * date field; the promise is saved when a date is chosen. It follows the promised date alone
   * and not the whole case, or any other save or live update would turn it off before that.
   */
  protected readonly promiseOn = linkedSignal(() => this.promisedDate() !== null);
  /**
   * The case whose client reply the AI is writing. Kept by case, not as a yes or no: the answer
   * can arrive when the panel shows another case, which must not look busy because of it.
   */
  private readonly replyingFor = signal<number | null>(null);
  protected readonly replying = computed(() => this.replyingFor() === this.ticketId());
  protected readonly copied = signal(false);
  /** What the user has typed in the reply box, so Copy works before the text is saved. */
  protected readonly replyTyped = signal('');

  private readonly attachments = viewChild(TicketAttachments);

  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly priorities = PRIORITIES;
  protected readonly priorityLabel = PRIORITY_LABEL;
  /** Upper limit of the case date: a problem cannot be reported in the future. */
  protected readonly today = todayIso();
  protected readonly promiseClass = PROMISE_CLASS;
  protected readonly promiseText = promiseText;
  protected readonly formatDateTime = formatDateTime;
  protected readonly formatMinutes = formatMinutes;
  protected readonly assigneeValue = assigneeValue;
  protected readonly assigneeInput = assigneeInput;

  constructor() {
    effect(() => {
      const id = this.ticketId();
      untracked(() => {
        // A date still waiting for its pause was typed for the case shown until now.
        this.flushDates();
        this.leave();
        this.unread = true;
        // An observation typed and not added belongs to the case that is left: carried along,
        // it would be added to another one.
        this.noteText.set('');
        this.show(null);
        void this.read(id);
      });
    });

    // Closing the panel destroys it, and must not lose a date typed a moment before.
    inject(DestroyRef).onDestroy(() => {
      this.flushDates();
      this.leave();
    });

    // The case is followed wherever it changes: in this panel, on another screen of this tab
    // or elsewhere (see TicketEvents).
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe((event) => {
        const id = this.ticketId();
        if (event.kind === 'saved') {
          if (event.ticket.id === id) {
            this.saves++;
            this.show(event.ticket);
          }
        } else if (event.kind === 'removed') {
          if (event.id === id) this.closed.emit();
        } else if (event.id === null || event.id === id) {
          void this.read(id);
        }
      });
  }

  /** The fields on screen are about to go, with the case or with the panel: nothing answered later is theirs. */
  private leave(): void {
    this.visit++;
    this.sending.set({});
  }

  /** Takes the case as the server has it. */
  private show(ticket: TicketDetail | null): void {
    for (const field of TEXT_FIELDS) {
      // A mark goes with its case: the fields of the next one are made again. On the same case
      // it stays while the stored text changes, because the typed text stays too (see
      // StoredValue), and goes when the case arrives with that very text: the save was stored
      // although its answer got lost, or someone else wrote the same.
      if (ticket?.id !== this.stored?.id || this.unsaved()[field]?.text === (ticket?.[field] ?? '')) this.setUnsaved(field);
    }
    this.stored = ticket;
    this.ticket.set(ticket);
  }

  /**
   * Reads the case: when the panel is given it, and again after someone else (or an assistant)
   * changed it. All the reads are numbered together, the first one too: it can be answered
   * after a newer read, or after a save, and must not put the older case back on screen.
   */
  private async read(id: number): Promise<void> {
    const read = ++this.reads;
    const saves = this.saves;
    // The answer counts only while the panel shows the same case and no newer read started.
    const current = (): boolean => id === this.ticketId() && read === this.reads;
    try {
      const ticket = await this.api.ticket(id);
      if (!current()) return;
      // A save answered meanwhile may be newer than this read, which would undo it on screen.
      // Dropping the read is not enough: that save may in turn be older than the change that
      // asked for the read. So the case is read once more.
      if (saves !== this.saves) return this.read(id);
      const first = this.unread;
      this.unread = false;
      this.show(ticket);
      if (first && this.autoReply() && !ticket.customerReply) void this.generateReply(false);
    } catch (error) {
      if (!current()) return;
      if (!this.ticket()) {
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

  /**
   * Saves `input` and tells whether it was stored. `id` is the case the change was made for:
   * the one the panel is on, or the one it is leaving (a date typed just before it moved on).
   * It is kept for the whole save: the answer can arrive when the panel shows another case,
   * and nothing of that one may be touched.
   *
   * `optimistic` false is for what the person types, text and dates (see saveTyped).
   */
  protected async save(input: TicketInput, optimistic = true, id = this.ticketId()): Promise<boolean> {
    // The form shows the change before it is stored. Its controls are then bound to what is on
    // screen, so putting the stored case back after a rejection is a change Angular writes to
    // them; set to the same values they had, nothing would be rewritten.
    if (optimistic) this.ticket.update((ticket) => ticket && { ...ticket, ...input });
    try {
      // The stored case comes back through its "saved" event (see the constructor).
      const updated = await this.api.updateTicket(id, input);
      // Resolving a case drafts the message for the client.
      if (input.status === 'RESOLVED' && !updated.customerReply) void this.generateReply(false, id);
      return true;
    } catch (error) {
      this.toast.error(error);
      if (optimistic && id === this.ticketId()) this.ticket.set(this.stored);
      return false;
    }
  }

  /**
   * For the number fields, bound with `[value]`: writes `value` into the control when what the
   * user left there is not going to be saved. Their binding still holds the stored value, so
   * Angular itself would not write it again.
   */
  private showStored(event: Event, value: number | null): void {
    (event.target as HTMLInputElement).value = value === null ? '' : String(value);
  }

  protected togglePromise(event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    this.promiseOn.set(on);
    // Turning it on waits for the date.
    if (on) return;
    // Turning it off removes the promise the case has, or is about to have (a date being
    // stored), and a date still waiting to be saved: saved after this, it would bring the
    // promise back. A choice like the others, shown before it is stored, and at the same time a
    // save of that field: a date typed after it is compared with it (see awaited).
    this.dropPendingDate('promisedDate');
    if (this.awaited('promisedDate')) void this.saveTyped('promisedDate', null, true);
  }

  /**
   * Called with every change of a date field. The browser reports a complete date after each
   * key: typing 28 over a day gives the 2nd and then the 28th, and a year arrives as "0002",
   * "0020", "0202" and "2026". A day picked in the calendar arrives the same way and cannot be
   * told apart. Saving each of them would store dates nobody meant, each with its line in the
   * history, so the date waits until the field is left alone for a moment, or left (see
   * onDateBlur).
   *
   * Nothing waits for an empty field (a day is being typed), a date before 1900 (a year is
   * being typed) or the date the case has or is about to have (see awaited).
   */
  protected onDateInput(field: DateField, box: StoredValue): void {
    this.dropPendingDate(field);
    const value = box.value;
    // A time has no year to be half typed.
    const yearBeingTyped = field !== 'time' && value < OLDEST_DATE;
    if (!value || yearBeingTyped || value === this.awaited(field)) return;
    const timer = setTimeout(() => this.flushDate(field), DATE_PAUSE_MS);
    this.pendingDates[field] = { id: this.ticketId(), value, box, timer };
  }

  /** On leaving a date field: a date that was waiting is saved at once, and the field shows the date of the case. */
  protected onDateBlur(field: DateField, box: StoredValue): void {
    this.flushDate(field);
    this.showCaseDate(field, box);
  }

  /**
   * Puts the date the case has into a date field the person has left, over what stayed there
   * and is not going to be saved: an empty or half typed date, or one the server refused.
   *
   * Not while a date of that field is waiting or being saved. The case does not have it yet, so
   * the field would show the old date for a moment and then the new one. The answer to that
   * save comes back here (see saveDate): accepted, the field already holds the date; refused,
   * it goes back then.
   */
  private showCaseDate(field: DateField, box: StoredValue): void {
    if (!this.pendingDates[field] && !this.sending()[field]) box.show(this.ticket()?.[field] ?? '');
  }

  /** Saves now the date that was waiting in a field, to the case it was typed for. */
  private flushDate(field: DateField): void {
    const pending = this.pendingDates[field];
    if (!pending) return;
    this.dropPendingDate(field);
    void this.saveDate(field, pending);
  }

  /**
   * Saves a date. The case on screen takes it only once it is stored, like typed text (see
   * saveTyped), so a refusal leaves nothing to put back and the field is not written while the
   * person is in it. Written then, between two parts of a date, the old date would take the
   * place of the one being typed, and the next key would complete a date nobody meant, which is
   * then saved. The refusal is said by the toast; the field goes back to the date of the case
   * when it is left.
   */
  private async saveDate(field: DateField, { id, value, box }: PendingDate): Promise<void> {
    const saved = await this.saveTyped(field, value, false, id);
    // Null: the field went with its case.
    if (saved !== null && !box.focused) this.showCaseDate(field, box);
  }

  /**
   * Takes the time off the case, which then has only its date. A button and not the emptied
   * field: a time field is also empty while a time is being typed in it.
   */
  protected async clearTime(box: StoredValue): Promise<void> {
    this.dropPendingDate('time');
    // Null: the field went with its case. False: refused, the toast said why and the time stays.
    if (await this.saveTyped('time', null)) box.show('');
  }

  private flushDates(): void {
    this.flushDate('date');
    this.flushDate('promisedDate');
    this.flushDate('time');
  }

  private dropPendingDate(field: DateField): void {
    clearTimeout(this.pendingDates[field]?.timer);
    delete this.pendingDates[field];
  }

  /**
   * What the case is going to have in a typed field: what its unanswered save sent, or what is
   * stored. What the person types is compared with this to tell whether there is anything to
   * save. Compared with the stored text alone, putting the old text back while another one is
   * being stored would send nothing, and the case would keep the text they undid.
   */
  private awaited(field: TypedField): string {
    const sending = this.sending()[field];
    return (sending ? sending.value : this.ticket()?.[field]) ?? '';
  }

  /**
   * Saves one typed field and tells whether it was stored. Null: answered after the panel left
   * the case, or went away, so the field it was typed in is no longer on screen.
   *
   * Unlike the rest of the form, the case on screen does not take what was typed before it is
   * stored: the field already shows it. So when the save fails (no connection, server
   * restarting, a refusal) there is nothing to put back over what the person wrote. Once
   * stored, it arrives with the "saved" event. Until the answer the field counts as being
   * saved (`sending`).
   */
  private async saveTyped(field: TypedField, value: string | null, optimistic = false, id = this.ticketId()): Promise<boolean | null> {
    const visit = this.visit;
    this.sending.update((all) => ({ ...all, [field]: { value, count: (all[field]?.count ?? 0) + 1 } }));
    const saved = await this.save({ [field]: value }, optimistic, id);
    if (visit !== this.visit) return null;
    this.sending.update((all) => {
      const mine = all[field];
      return { ...all, [field]: mine && mine.count > 1 ? { ...mine, count: mine.count - 1 } : undefined };
    });
    return saved;
  }

  /** Called when a text field is left with another text, and by its "Reintentar" button. */
  protected saveText(field: TextField, box: StoredValue): void {
    const text = box.value.trim();
    // Empresa and Descripción cannot be left empty. The reply can: it is then stored as none.
    const empty = !text && field !== 'customerReply';
    if (!empty && text !== this.awaited(field)) void this.sendText(field, text || null, box);
    // Left empty, or only the spaces around the text changed: the field shows the stored text
    // again. Unless that text is the one being saved, which is not the stored one yet.
    else if (empty || !this.sending()[field]) this.showStoredText(field, box);
  }

  /**
   * Saves the text of a field and, once answered, leaves the field as it stands: stored, it
   * shows the text as the server keeps it; failed, it keeps what the person wrote and is marked
   * as not saved, with a way to send the text again or to discard it.
   */
  private async sendText(field: TextField, text: string | null, box: StoredValue): Promise<void> {
    // As the field holds it now, spaces included: a space or a new line typed after this is
    // already the person writing on.
    const typed = box.value;
    const saved = await this.saveTyped(field, text);
    if (saved === null) return;
    // The person may have written on while the save was on its way. That text is theirs: it
    // stays in the field and is saved when they leave it. Spaces around the same text count as
    // writing on only while they are still in the field.
    const held = box.value === typed || (!box.focused && box.value.trim() === (text ?? ''));
    if (saved && held) this.showStoredText(field, box);
    else if (saved) this.setUnsaved(field);
    // Not stored: whatever the field holds now is not saved, and says so. Without the mark, a
    // person who wrote on and then went back to this text would leave the field with nothing
    // sent (it did not change) and nothing telling them.
    else this.setUnsaved(field, box.value.trim());
  }

  /** Puts the text the case has into a field, over a text of the person's own that is given up or was nothing to save. */
  private showStoredText(field: TextField, box: StoredValue): void {
    box.show(this.ticket()?.[field] ?? '');
    if (field === 'customerReply') this.replyTyped.set(box.value);
    this.setUnsaved(field);
  }

  /**
   * The two buttons of a field marked as not saved. Pressing one takes the focus from the
   * field first, and a field left with another text is saved right then. Until that save is
   * answered the buttons do nothing (they are shown disabled): "Descartar" would give up a text
   * that is being stored, and "Reintentar" would send it a second time. The person acts on what
   * that save leaves.
   */
  protected retryText(field: TextField, box: StoredValue): void {
    if (!this.sending()[field]) this.saveText(field, box);
  }

  protected discardText(field: TextField, box: StoredValue): void {
    if (!this.sending()[field]) this.showStoredText(field, box);
  }

  /** Marks a text field as holding `text`, which could not be saved. With no text, takes the mark away. */
  private setUnsaved(field: TextField, text?: string): void {
    this.unsaved.update((marks) => ({ ...marks, [field]: text === undefined ? undefined : { text } }));
  }

  protected saveMinutes(field: 'estimatedMinutes' | 'spentMinutes', event: Event): void {
    const shown = this.ticket()?.[field] ?? null;
    const raw = (event.target as HTMLInputElement).value;
    // "Real" always has a number: emptied, it goes back to zero.
    const minutes = raw === '' ? (field === 'spentMinutes' ? 0 : null) : Math.max(0, Math.round(Number(raw)));
    if (minutes !== shown && (minutes === null || Number.isFinite(minutes))) void this.save({ [field]: minutes });
    // Not a number, or the same minutes written another way ("30.4", or "-5" for zero).
    else this.showStored(event, shown);
  }

  protected savePriority(value: string): void {
    void this.save({ priority: (value || null) as Priority | null });
  }

  /**
   * Asks the AI for the client message. `manual` is true for the button: it then
   * confirms before replacing an existing message and reports a missing AI setup.
   * Automatic calls stay silent when no provider is active.
   *
   * `id` is the case shown, unless the reply follows a save of another one: a case resolved
   * just before the panel moved on still gets its message.
   *
   * `box` is given by the button. The message asked for there takes the place of whatever the
   * reply box holds, also of text of the person's own (typed, or kept because its save failed),
   * which the box would otherwise keep over it. A message nobody asked for leaves that text alone.
   */
  protected async generateReply(manual: boolean, id = this.ticketId(), box?: StoredValue): Promise<void> {
    if (this.replyingFor() === id || !this.catalogs.aiReady()) return;
    // Asked whenever there is a message to lose: stored, on its way to be stored, or only typed.
    const written = box?.value.trim() || this.awaited('customerReply');
    if (manual && written && !confirm('¿Reemplazar la respuesta actual por una nueva?')) return;
    const visit = this.visit;
    this.replyingFor.set(id);
    try {
      await this.api.aiReply(id);
      if (box && visit === this.visit) this.showStoredText('customerReply', box);
    } catch (error) {
      this.toast.error(error);
    } finally {
      // Unless a reply for another case started meanwhile: that one is still being written.
      if (this.replyingFor() === id) this.replyingFor.set(null);
    }
  }

  protected async copyReply(text: string): Promise<void> {
    if (await copyText(text.trim())) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toast.error('No se pudo copiar. Selecciona el texto y usa Ctrl+C.');
    }
  }

  protected async timer(action: 'start' | 'stop'): Promise<void> {
    try {
      await this.api.timer(this.ticketId(), action);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async addNote(): Promise<void> {
    const text = this.noteText().trim();
    if (!text) return;
    const id = this.ticketId();
    this.noteText.set('');
    try {
      await this.api.addNote(id, text);
    } catch (error) {
      // Back into the box, to be sent again. Unless the panel moved on: the box is now the one
      // of another case, where this note does not belong.
      if (id === this.ticketId()) this.noteText.set(text);
      this.toast.error(error);
    }
  }

  protected async removeNote(noteId: number): Promise<void> {
    if (!confirm('¿Eliminar esta observación?')) return;
    try {
      await this.api.deleteNote(this.ticketId(), noteId);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** Files can be dropped anywhere on the panel; the attachments block uploads them. */
  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    void this.attachments()?.upload(Array.from(event.dataTransfer?.files ?? []));
  }

  protected async remove(): Promise<void> {
    const ticket = this.ticket();
    if (!ticket || !confirm(`¿Eliminar el caso ${ticket.code}? Se borran también sus observaciones y adjuntos. No se puede deshacer.`)) return;
    try {
      // The "removed" event closes this panel (see the constructor).
      await this.api.deleteTicket(ticket.id);
      this.toast.ok(`Caso ${ticket.code} eliminado`);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** Escape closes an enlarged attachment first, then the panel. */
  protected onEscape(): void {
    if (this.attachments()?.closeLightbox()) return;
    // The field the person is in is left first, as when the panel is closed with the mouse:
    // what they typed in it is then saved, not dropped with the panel.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.closed.emit();
  }
}
