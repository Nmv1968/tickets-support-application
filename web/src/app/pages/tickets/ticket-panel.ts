import { A11yModule } from '@angular/cdk/a11y';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, model, output, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketInput, TicketStatus, TicketSupportType } from '../../core/api';
import { Catalogs, companyCreator } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { SELECT } from '../../core/select';
import { TicketEvents } from '../../core/ticket-events';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';
import { PRIORITIES, PRIORITY_LABEL, PROMISE_CLASS, STATUSES, STATUS_LABEL, copyText, errorMessage, formatDateTime, formatMinutes, promiseText, todayIso } from '../../core/ui';
import { UnsavedChanges } from '../../core/unsaved-changes';
import { TicketAttachments } from './ticket-attachments';

/** No case is older than this. A date before it is a year that is still being typed. */
const OLDEST_DATE = '1900-01-01';

/**
 * The fields of a case the form edits, each as its control holds it. The person works on this
 * copy: the case gets what they changed only with "Actualizar".
 */
interface Draft {
  /** Empty, or before 1900, while a date is being typed. */
  date: string;
  /** Empty: the case has only its date. */
  time: string;
  companyId: number;
  description: string;
  status: TicketStatus;
  /** Null: nobody. */
  assigneeId: number | null;
  priority: Priority | null;
  moduleId: number | null;
  supportTypeIds: number[];
  /** Minutes as typed: not rounded yet, and null while the field is empty. */
  estimatedMinutes: number | null;
  spentMinutes: number | null;
  /** The "Promesa de entrega" switch. On with no date yet, it only shows the date field. */
  promiseOn: boolean;
  promisedDate: string;
  customerReply: string;
}

/** What a draft stores in the case: the fields "Actualizar" can send, each as it is sent. */
type Values = Required<
  Pick<
    TicketInput,
    | 'date'
    | 'time'
    | 'companyId'
    | 'description'
    | 'status'
    | 'assigneeId'
    | 'priority'
    | 'moduleId'
    | 'supportTypeIds'
    | 'estimatedMinutes'
    | 'spentMinutes'
    | 'promisedDate'
    | 'customerReply'
  >
>;
type Field = keyof Values;

/** The two fields of minutes: the estimate and the time spent. */
type MinutesField = 'estimatedMinutes' | 'spentMinutes';

/** What keeps a draft from being saved, by the field that says it. */
type Problems = Partial<Record<'date' | 'time' | 'description' | 'promisedDate' | MinutesField, string>>;

/**
 * A text as a textarea gives it back once written: with every line end as "\n". Kept as stored,
 * a text with Windows line ends (from an import or an assistant) would never equal what its
 * field holds, and would look changed by the person.
 */
function asHeld(text: string | null): string {
  return (text ?? '').replace(/\r\n?/g, '\n');
}

/** The form as it shows a stored case. */
function draftOf(ticket: TicketDetail): Draft {
  return {
    date: ticket.date,
    time: ticket.time ?? '',
    companyId: ticket.companyId,
    description: asHeld(ticket.description),
    status: ticket.status,
    assigneeId: ticket.assigneeId,
    priority: ticket.priority,
    moduleId: ticket.moduleId,
    supportTypeIds: ticket.supportTypes.map((type) => type.id),
    estimatedMinutes: ticket.estimatedMinutes,
    spentMinutes: ticket.spentMinutes,
    promiseOn: ticket.promisedDate !== null,
    promisedDate: ticket.promisedDate ?? '',
    customerReply: asHeld(ticket.customerReply),
  };
}

/** Minutes typed in a number field as a case stores them: whole, and not below zero. Null for an empty field. */
function wholeMinutes(typed: number | null): number | null {
  return typed === null || !Number.isFinite(typed) ? null : Math.max(0, Math.round(typed));
}

/**
 * What a draft would leave in the case. Two drafts are compared through this, so that only what
 * would be stored differently counts as a change: not the spaces around a text, nor the same
 * minutes written another way ("30.4").
 */
function valuesOf(draft: Draft): Values {
  return {
    date: draft.date,
    time: draft.time || null,
    companyId: draft.companyId,
    description: draft.description.trim(),
    status: draft.status,
    assigneeId: draft.assigneeId,
    priority: draft.priority,
    moduleId: draft.moduleId,
    supportTypeIds: draft.supportTypeIds,
    estimatedMinutes: wholeMinutes(draft.estimatedMinutes),
    // "Real" always has a number: emptied, it goes back to zero.
    spentMinutes: wholeMinutes(draft.spentMinutes) ?? 0,
    // The switch on with no date chosen is no promise yet.
    promisedDate: draft.promiseOn && draft.promisedDate ? draft.promisedDate : null,
    // The reply can be left empty: it is then stored as none.
    customerReply: draft.customerReply.trim() || null,
  };
}

/** The support types of a case are a set: the order they were chosen in says nothing. */
function equal(a: Values[Field], b: Values[Field]): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((id) => b.includes(id)) : a === b;
}

/** The fields of the case two drafts would store differently. */
function changed(draft: Draft, other: Draft): Field[] {
  const mine = valuesOf(draft);
  const theirs = valuesOf(other);
  return (Object.keys(mine) as Field[]).filter((field) => !equal(mine[field], theirs[field]));
}

/** `draft` with one field of the case as `source` has it. The promise is its switch and its date. */
function withField(draft: Draft, source: Draft, field: Field): Draft {
  return field === 'promisedDate' ? { ...draft, promiseOn: source.promiseOn, promisedDate: source.promisedDate } : { ...draft, [field]: source[field] };
}

/**
 * What a select of the form offers out of a catalog: its active entries and the ones the case
 * has, whatever their state. An entry the catalog does not bring (it is still on its way) is
 * offered as the case itself names it.
 */
function offered<T extends { id: number }>(catalog: readonly (T & { active: boolean })[], own: readonly T[]): T[] {
  const options: T[] = catalog.filter((entry) => entry.active || own.some((mine) => mine.id === entry.id));
  return [...options, ...own.filter((mine) => !options.some((entry) => entry.id === mine.id))];
}

/**
 * Side panel with every field of one case. The form edits a draft: nothing is sent while the
 * person types or chooses, and "Actualizar" saves what they changed in one go. What is not a
 * field of the case (observations, attachments, the timer, the AI reply, archiving, deleting)
 * has its own button and acts at once. An observation typed and not added with its button is
 * the one thing "Actualizar" saves besides the draft: it would otherwise be lost on the way out.
 */
@Component({
  selector: 'app-ticket-panel',
  imports: [FormsModule, A11yModule, ...SELECT, TypeChip, TicketAttachments],
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
            @if (t.archivedAt) {
              <span class="badge bg-elevated text-muted" [title]="'Archivado el ' + formatDateTime(t.archivedAt) + '. No aparece en las listas salvo que se filtre por archivados.'">
                <i class="mdi mdi-archive-outline" aria-hidden="true"></i> Archivado
              </span>
            }
          }
        </div>
        <button type="button" class="btn btn-ghost px-2" (click)="close()" aria-label="Cerrar" cdkFocusInitial>
          <i class="mdi mdi-close text-lg" aria-hidden="true"></i>
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
                  <p class="field-error" id="tp-date-error"><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> {{ problem }}</p>
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
                      <i class="mdi mdi-close" aria-hidden="true"></i>
                    </button>
                  }
                </div>
                @if (problems().time; as problem) {
                  <p class="field-error" id="tp-time-error"><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> {{ problem }}</p>
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
                <!-- A case always has a company: the select cannot be emptied. -->
                <ng-select
                  labelForId="tp-company"
                  bindValue="id"
                  bindLabel="name"
                  appendTo="body"
                  [items]="companyOptions()"
                  [clearable]="false"
                  [addTag]="createCompany"
                  [inputAttrs]="{ maxlength: '200' }"
                  [ngModel]="d.companyId"
                  (ngModelChange)="set('companyId', $event)"
                >
                  <ng-template ng-tag-tmp let-search="searchTerm">Crear empresa «{{ search }}»</ng-template>
                </ng-select>
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
                  <p class="field-error" id="tp-description-error"><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> {{ problem }}</p>
                }
              </div>
              <div>
                <label class="label" for="tp-status">Estado</label>
                <ng-select
                  labelForId="tp-status"
                  bindValue="id"
                  bindLabel="label"
                  appendTo="body"
                  [items]="statusOptions"
                  [clearable]="false"
                  [searchable]="false"
                  [ngModel]="d.status"
                  (ngModelChange)="set('status', $event)"
                />
              </div>
              <div>
                <label class="label" for="tp-assignee">Responsable</label>
                <ng-select
                  labelForId="tp-assignee"
                  bindValue="id"
                  bindLabel="name"
                  placeholder="Sin asignar"
                  appendTo="body"
                  [items]="assigneeOptions()"
                  [ngModel]="d.assigneeId"
                  (ngModelChange)="set('assigneeId', $event)"
                />
              </div>
              <div>
                <label class="label" for="tp-priority">Prioridad</label>
                <ng-select
                  labelForId="tp-priority"
                  bindValue="id"
                  bindLabel="label"
                  placeholder="Sin prioridad"
                  appendTo="body"
                  [items]="priorityOptions"
                  [searchable]="false"
                  [ngModel]="d.priority"
                  (ngModelChange)="set('priority', $event)"
                />
              </div>
              <div>
                <label class="label" for="tp-module">Módulo</label>
                <ng-select
                  labelForId="tp-module"
                  bindValue="id"
                  bindLabel="fullName"
                  placeholder="Sin módulo"
                  appendTo="body"
                  [items]="moduleOptions()"
                  [ngModel]="d.moduleId"
                  (ngModelChange)="set('moduleId', $event)"
                />
              </div>
              <div class="col-span-2">
                <label class="label" for="tp-types">Tipos de soporte</label>
                <!-- The list stays open after each choice: a case often takes more than one. -->
                <ng-select
                  labelForId="tp-types"
                  bindValue="id"
                  bindLabel="name"
                  placeholder="Sin tipo de soporte"
                  appendTo="body"
                  [items]="typeOptions()"
                  [multiple]="true"
                  [closeOnSelect]="false"
                  [ngModel]="d.supportTypeIds"
                  (ngModelChange)="set('supportTypeIds', $event)"
                >
                  <ng-template ng-label-tmp let-item="item" let-clear="clear">
                    <app-type-chip [type]="item" removable (removed)="clear(item)" />
                  </ng-template>
                  <ng-template ng-option-tmp let-item="item">
                    <app-type-chip [type]="item" />
                  </ng-template>
                </ng-select>
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

            <section class="rounded-card border border-line p-3">
              <h2 class="section-title mb-2">Tiempos</h2>
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label" for="tp-estimated">Estimado (minutos)</label>
                  <input
                    #estimatedBox
                    id="tp-estimated"
                    class="input aria-[invalid=true]:border-danger"
                    type="number"
                    min="0"
                    max="1000000"
                    step="5"
                    [ngModel]="d.estimatedMinutes"
                    (ngModelChange)="set('estimatedMinutes', $event)"
                    (input)="watchMinutes()"
                    (keyup)="watchMinutes()"
                    (change)="tidyMinutes()"
                    [attr.aria-invalid]="problems().estimatedMinutes ? 'true' : null"
                    [attr.aria-describedby]="problems().estimatedMinutes ? 'tp-estimated-error' : null"
                  />
                  @if (problems().estimatedMinutes; as problem) {
                    <p class="field-error" id="tp-estimated-error"><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> {{ problem }}</p>
                  }
                </div>
                <div>
                  <label class="label" for="tp-spent">Real (minutos)</label>
                  <input
                    #spentBox
                    id="tp-spent"
                    class="input aria-[invalid=true]:border-danger"
                    type="number"
                    min="0"
                    max="1000000"
                    step="5"
                    [ngModel]="d.spentMinutes"
                    (ngModelChange)="set('spentMinutes', $event)"
                    (input)="watchMinutes()"
                    (keyup)="watchMinutes()"
                    (change)="tidyMinutes()"
                    [attr.aria-invalid]="problems().spentMinutes ? 'true' : null"
                    [attr.aria-describedby]="problems().spentMinutes ? 'tp-spent-error' : null"
                  />
                  @if (problems().spentMinutes; as problem) {
                    <p class="field-error" id="tp-spent-error"><i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> {{ problem }}</p>
                  }
                </div>
              </div>
              <!-- The timer runs on the stored case and acts at once, whatever the draft holds (see timer). -->
              <div class="mt-3 flex flex-wrap items-center gap-2">
                @if (t.timerStartedAt) {
                  <button type="button" class="btn btn-danger" [disabled]="spentUnsaved()" (click)="timer('stop')">
                    <i class="mdi mdi-stop" aria-hidden="true"></i> Detener cronómetro
                  </button>
                  @if (spentUnsaved()) {
                    <span class="text-xs text-muted" id="tp-timer-hint">Actualiza o descarta el cambio en «Real (minutos)» para detenerlo.</span>
                  } @else {
                    <span class="text-xs text-muted">En marcha desde {{ formatDateTime(t.timerStartedAt) }}</span>
                  }
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
                <!-- Not with unsaved changes: the AI writes from the stored case (see generateReply). -->
                <button
                  type="button"
                  class="btn btn-soft px-2 py-1 text-xs"
                  [disabled]="replying() || !catalogs.aiReady() || unsaved()"
                  [title]="replyHelp()"
                  (click)="generateReply(true)"
                >
                  <i class="mdi" [class]="replying() ? 'mdi-loading mdi-spin' : 'mdi-creation-outline'" aria-hidden="true"></i>
                  {{ replying() ? 'Redactando…' : t.customerReply ? 'Volver a generar' : 'Generar con IA' }}
                </button>
                <button type="button" class="btn btn-primary px-2 py-1 text-xs" [disabled]="!d.customerReply.trim()" (click)="copyReply(d.customerReply)">
                  <i class="mdi" [class]="copied() ? 'mdi-check' : 'mdi-content-copy'" aria-hidden="true"></i>
                  {{ copied() ? 'Copiado' : 'Copiar' }}
                </button>
              </div>
              <textarea
                class="input min-h-28 resize-y"
                aria-label="Respuesta para el cliente"
                placeholder="Mensaje para quien pidió el soporte. Se redacta con IA al resolver el caso, o escríbelo aquí."
                maxlength="5000"
                [ngModel]="d.customerReply"
                (ngModelChange)="set('customerReply', $event)"
              ></textarea>
              <p class="mt-1 text-2xs text-muted">
                Revisa el mensaje antes de enviarlo. Puedes editarlo; se guarda con el caso al pulsar Actualizar.
                @if (unsaved() && catalogs.aiReady()) {
                  Para redactarlo con IA, actualiza o descarta antes los cambios: la IA lee el caso guardado.
                }
              </p>
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

            <div class="flex flex-wrap gap-2">
              <!-- No question asked: a case that was archived is brought back with the same button. -->
              <button type="button" class="btn btn-soft" [disabled]="archiving()" (click)="archive(!t.archivedAt, $event)">
                <i class="mdi" [class]="t.archivedAt ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-arrow-down-outline'" aria-hidden="true"></i>
                {{ t.archivedAt ? 'Desarchivar' : 'Archivar' }}
              </button>
              <button type="button" class="btn btn-danger" (click)="remove()">
                <i class="mdi mdi-trash-can-outline" aria-hidden="true"></i> Eliminar caso
              </button>
            </div>
          </div>

          @if (behind()) {
            <p class="flex flex-wrap items-center gap-x-3 border-t border-line bg-warning/10 px-4 py-1.5 text-xs" role="status">
              <span><i class="mdi mdi-alert-outline text-warning" aria-hidden="true"></i> Este caso cambió en otra pantalla.</span>
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
              <i class="mdi" [class]="saving() ? 'mdi-loading mdi-spin' : 'mdi-content-save-outline'" aria-hidden="true"></i>
              {{ saving() ? 'Guardando…' : 'Actualizar' }}
            </button>
            @if (unsaved()) {
              <button type="button" class="btn btn-ghost" [disabled]="saving()" (click)="discard()">Descartar cambios</button>
            }
            <p class="ml-auto text-xs text-muted" role="status">
              @if (unsaved()) {
                <i class="mdi mdi-circle-medium text-warning" aria-hidden="true"></i> Cambios sin guardar
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
  /** Number of the last read started, and how many saves of the case were shown (see read). */
  private reads = 0;
  private saves = 0;
  /** No read of the case the panel was given has been shown yet. */
  private unread = true;
  /**
   * Counts the cases the panel was given. What is asked for one of them (a save, a question to
   * the person) keeps the number: answered under another one, the form on screen is not the one
   * it left. Not the id of the case: the panel can be back on the same case, with its form made again.
   */
  private visit = 0;
  /** The question about leaving the case that is on screen, so that it is asked once (see mayLeave). */
  private leaving: Promise<boolean> | null = null;

  /**
   * The time field holds a time that is half typed. The browser reports such a field as empty,
   * which in the draft is a case without a time: saved like that, it would take the time off.
   */
  protected readonly timeHalfTyped = signal(false);
  private readonly timeBox = viewChild<ElementRef<HTMLInputElement>>('caseTime');
  /**
   * The fields of minutes that hold a text that is not a number ("30e", "45 min"). The browser
   * reports such a field as empty too, which in the draft is a case without an estimate, or
   * with no time spent: saved like that, the case would lose the minutes it has.
   */
  private readonly notNumber = signal<Record<MinutesField, boolean>>({ estimatedMinutes: false, spentMinutes: false });
  private readonly estimatedBox = viewChild<ElementRef<HTMLInputElement>>('estimatedBox');
  private readonly spentBox = viewChild<ElementRef<HTMLInputElement>>('spentBox');

  /** What "Actualizar" would send of the case: the fields the draft changes, and nothing else. */
  private readonly changes = computed<TicketInput>(() => {
    const draft = this.draft();
    const base = this.base();
    if (!draft || !base) return {};
    const values = valuesOf(draft);
    return Object.fromEntries(changed(draft, base).map((field) => [field, values[field]]));
  });
  /**
   * The fields of the form hold something the case does not have. Besides what would be sent,
   * the promise switch turned on with no date yet, a time half typed and minutes that are not a
   * number: nothing to save, but the person's own, which the form must not lose by following
   * the case.
   */
  private readonly dirty = computed(() => {
    const draft = this.draft();
    const base = this.base();
    const notNumber = this.notNumber();
    return (
      !!draft &&
      !!base &&
      (Object.keys(this.changes()).length > 0 || draft.promiseOn !== base.promiseOn || this.timeHalfTyped() || notNumber.estimatedMinutes || notNumber.spentMinutes)
    );
  });
  /** What keeps the draft from being saved as it stands. Each is said next to its field. */
  protected readonly problems = computed<Problems>(() => {
    const draft = this.draft();
    const problems: Problems = {};
    if (!draft) return problems;
    // Empty while a day is being typed, before 1900 while it is the year.
    if (draft.date < OLDEST_DATE) problems.date = 'Escribe la fecha completa.';
    if (this.timeHalfTyped()) problems.time = 'Completa la hora o quítala.';
    if (!draft.description.trim()) problems.description = 'La descripción no puede quedar vacía.';
    if (draft.promiseOn && draft.promisedDate < OLDEST_DATE) problems.promisedDate = 'Elige la fecha prometida';
    const notNumber = this.notNumber();
    if (notNumber.estimatedMinutes) problems.estimatedMinutes = 'Escribe solo el número de minutos.';
    if (notNumber.spentMinutes) problems.spentMinutes = 'Escribe solo el número de minutos.';
    return problems;
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
  protected readonly replyHelp = computed(() => {
    if (!this.catalogs.aiReady()) return 'Activa un proveedor en Configuración > IA';
    return this.unsaved() ? 'Actualiza o descarta los cambios primero: la IA redacta con el caso guardado' : 'Redacta el mensaje con el caso y sus observaciones';
  });
  protected readonly copied = signal(false);

  private readonly attachments = viewChild(TicketAttachments);

  protected readonly statusLabel = STATUS_LABEL;
  protected readonly statusOptions = STATUSES.map((id) => ({ id, label: STATUS_LABEL[id] }));
  protected readonly priorityOptions = PRIORITIES.map((id) => ({ id, label: PRIORITY_LABEL[id] }));
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
  protected readonly formatMinutes = formatMinutes;

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
    this.notNumber.set({ estimatedMinutes: false, spentMinutes: false });
    this.stored.set(null);
    this.draft.set(null);
    this.base.set(null);
    void this.read(id);
  }

  /** The form on screen is about to go, with the case or with the panel: nothing answered later is its own. */
  private leave(): void {
    this.visit++;
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
    const brought = changed(fields, own ? draftOf(before) : base);
    const mine = changed(draft, base);
    this.base.set(brought.reduce((form, field) => withField(form, fields, field), base));
    this.draft.set(brought.filter((field) => !mine.includes(field)).reduce((form, field) => withField(form, fields, field), draft));
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
    const current = (): boolean => id === this.caseId() && read === this.reads;
    try {
      const ticket = await this.api.ticket(id);
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
   * Called with what the person does in the two fields of minutes, to tell whether one holds a
   * text that is not a number. With every key too, as for the time: a text that starts in an
   * empty field leaves it empty for the browser, which may then report no change.
   */
  protected watchMinutes(): void {
    const held = this.notNumber();
    const now = {
      estimatedMinutes: !!this.estimatedBox()?.nativeElement.validity.badInput,
      spentMinutes: !!this.spentBox()?.nativeElement.validity.badInput,
    };
    if (now.estimatedMinutes !== held.estimatedMinutes || now.spentMinutes !== held.spentMinutes) this.notNumber.set(now);
  }

  /** A text that is not a number is in its field alone, which reported it as empty: the draft never had it to give up. */
  private emptyNotNumbers(): void {
    const held = this.notNumber();
    if (!held.estimatedMinutes && !held.spentMinutes) return;
    const estimated = this.estimatedBox()?.nativeElement;
    const spent = this.spentBox()?.nativeElement;
    if (held.estimatedMinutes && estimated) estimated.value = '';
    if (held.spentMinutes && spent) spent.value = '';
    this.notNumber.set({ estimatedMinutes: false, spentMinutes: false });
  }

  /**
   * On leaving a number field: shows the minutes as they would be stored ("30.4" is 30, "-5" is
   * zero, and "Real" emptied goes back to zero), so that what the field shows is what is saved.
   * A text that is not a number stays as it was typed, to be corrected: the zero of "Real"
   * would take its place without a word.
   */
  protected tidyMinutes(): void {
    this.watchMinutes();
    const notNumber = this.notNumber();
    this.draft.update(
      (draft) =>
        draft && {
          ...draft,
          estimatedMinutes: wholeMinutes(draft.estimatedMinutes),
          spentMinutes: notNumber.spentMinutes ? draft.spentMinutes : (wholeMinutes(draft.spentMinutes) ?? 0),
        },
    );
  }

  /**
   * "Crear empresa «X»" in the company select: the company joins the catalog at once, and the
   * select chooses it in the draft. The case gets it like any other change, with "Actualizar".
   */
  protected readonly createCompany = companyCreator();

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
    const visit = this.visit;
    this.saving.set(true);
    try {
      let resolved = false;
      if (fields) {
        // The stored case comes back through its "saved" event (see the constructor).
        const updated = await this.api.updateTicket(id, input);
        this.toast.ok('Caso actualizado');
        if (visit === this.visit) this.showSaved(sent);
        resolved = input.status === 'RESOLVED' && !updated.customerReply;
      }
      // The observation as it was when the button was pressed. Not once its box holds something
      // else: the person went on writing it, or added it with its own button meanwhile. Nor
      // once the form is gone, with what they chose to leave unsaved.
      if (note && visit === this.visit && this.noteText().trim() === note) {
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
      if (visit === this.visit) this.saving.set(false);
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
    const fields = draftOf(stored);
    this.base.set(fields);
    this.draft.set(changed(draft, sent).reduce((form, field) => withField(form, draft, field), fields));
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
    this.emptyNotNumbers();
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
    const visit = this.visit;
    if ((await this.mayLeave()) && visit === this.visit) this.closed.emit();
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
      const visit = this.visit;
      const replace = !this.stored()?.customerReply || (await this.confirm.ask({ title: '¿Reemplazar la respuesta actual por una nueva?', confirmLabel: 'Reemplazar' }, this.destroyRef));
      // The question was on screen for a while: the panel may be on another case by now.
      if (!replace || visit !== this.visit || this.replyingFor() === id) return;
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

  protected async copyReply(text: string): Promise<void> {
    if (await copyText(text.trim())) {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toast.error('No se pudo copiar. Selecciona el texto y usa Ctrl+C.');
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
    const visit = this.visit;
    if (id === null || !(await this.confirm.ask({ title: '¿Eliminar esta observación?', confirmLabel: 'Eliminar', danger: true }, this.destroyRef)) || visit !== this.visit) return;
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
    const visit = this.visit;
    this.archiving.set(true);
    try {
      await this.api.updateTicket(id, { archived });
      this.toast.ok(archived ? 'Caso archivado' : 'Caso desarchivado');
    } catch (error) {
      this.toast.error(error);
    } finally {
      if (visit === this.visit) this.archiving.set(false);
    }
  }

  protected async remove(): Promise<void> {
    const ticket = this.stored();
    if (!ticket) return;
    const visit = this.visit;
    const confirmed = await this.confirm.ask(
      {
        title: `¿Eliminar el caso ${ticket.code}?`,
        message: 'Se eliminan también sus observaciones y adjuntos. No se puede deshacer.',
        confirmLabel: 'Eliminar',
        danger: true,
      },
      this.destroyRef,
    );
    if (!confirmed || visit !== this.visit) return;
    try {
      // The "removed" event closes this panel (see the constructor).
      await this.api.deleteTicket(ticket.id);
      this.toast.ok(`Caso ${ticket.code} eliminado`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
