import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketStatus } from '../../core/api';
import { Catalogs, companyCreator } from '../../core/catalogs';
import { SELECT } from '../../core/select';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, todayIso } from '../../core/ui';

/**
 * "Nuevo caso": the short form above the case list, for a case typed by hand. It stays open
 * after each one, to register several in a row. A case can be registered whole from here: the
 * list has nothing to edit it with afterwards. What a new case rarely needs (times, the promise)
 * is filled in later, in the form of the case.
 */
@Component({
  selector: 'app-new-ticket',
  imports: [FormsModule, ...SELECT, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'new-ticket', class: 'block' },
  template: `
    <form class="card grid grid-cols-2 gap-x-3 gap-y-2 p-3 lg:grid-cols-4 xl:grid-cols-12" aria-labelledby="nt-title" (ngSubmit)="register()">
      <div class="col-span-full flex items-center gap-2">
        <h2 id="nt-title" class="section-title mr-auto">Nuevo caso</h2>
        <button type="button" class="btn btn-ghost -my-1 px-2 py-1" aria-label="Cerrar el formulario de caso nuevo" title="Cerrar" (click)="closed.emit()">
          <i class="mdi mdi-close text-lg leading-none" aria-hidden="true"></i>
        </button>
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
        <input id="nt-date" class="input" type="date" name="date" [max]="today" [(ngModel)]="date" />
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-time" title="Hora en que el cliente lo reportó. Opcional">Hora</label>
        <input id="nt-time" class="input" type="time" name="time" [(ngModel)]="time" />
      </div>
      <div class="col-span-2 xl:col-span-3">
        <label class="label" for="nt-company">Empresa <span class="text-danger" aria-hidden="true">*</span></label>
        <!-- The lists of options hang from the body: inside the page they would be cut where the page scrolls. -->
        <ng-select
          #company
          labelForId="nt-company"
          name="company"
          bindValue="id"
          bindLabel="name"
          placeholder="Elige o escribe una empresa"
          appendTo="body"
          [items]="catalogs.activeCompanies()"
          [addTag]="createCompany"
          [inputAttrs]="{ maxlength: '200', 'aria-required': 'true' }"
          [(ngModel)]="companyId"
        >
          <ng-template ng-tag-tmp let-search="searchTerm">Crear empresa «{{ search }}»</ng-template>
        </ng-select>
      </div>
      <div class="col-span-2 lg:col-span-4 xl:col-span-5">
        <label class="label" for="nt-description">Descripción <span class="text-danger" aria-hidden="true">*</span></label>
        <!-- A text area: what a client wrote is pasted here with its lines. Enter is a new line, so the form is sent with Ctrl+Enter. -->
        <textarea
          id="nt-description"
          class="input min-h-[2.375rem] resize-y"
          name="description"
          rows="2"
          maxlength="5000"
          required
          placeholder="Qué reportó el cliente (Ctrl+Enter para registrar)"
          [(ngModel)]="description"
          (keydown.control.enter)="register()"
        ></textarea>
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-status">Estado</label>
        <ng-select
          labelForId="nt-status"
          name="status"
          bindValue="id"
          bindLabel="label"
          appendTo="body"
          [items]="statusOptions"
          [clearable]="false"
          [searchable]="false"
          [(ngModel)]="status"
        />
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-assignee">Responsable</label>
        <!-- Empty unless someone is chosen: registering a case makes nobody its responsible. -->
        <ng-select
          labelForId="nt-assignee"
          name="assignee"
          bindValue="id"
          bindLabel="name"
          placeholder="Sin asignar"
          appendTo="body"
          [items]="catalogs.activeAssignees()"
          [(ngModel)]="assigneeId"
        />
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-priority">Prioridad</label>
        <ng-select
          labelForId="nt-priority"
          name="priority"
          bindValue="id"
          bindLabel="label"
          placeholder="Sin prioridad"
          appendTo="body"
          [items]="priorityOptions"
          [searchable]="false"
          [(ngModel)]="priority"
        />
      </div>
      <div class="xl:col-span-3">
        <label class="label" for="nt-module">Módulo</label>
        <ng-select
          labelForId="nt-module"
          name="module"
          bindValue="id"
          bindLabel="fullName"
          placeholder="Sin módulo"
          appendTo="body"
          [items]="catalogs.activeModules()"
          [(ngModel)]="moduleId"
        />
      </div>
      <div class="col-span-2 xl:col-span-3">
        <label class="label" for="nt-types">Tipos de soporte</label>
        <!-- The list stays open after each choice: a case often takes more than one. -->
        <ng-select
          labelForId="nt-types"
          name="types"
          bindValue="id"
          bindLabel="name"
          placeholder="Sin tipo de soporte"
          appendTo="body"
          [items]="catalogs.activeSupportTypes()"
          [multiple]="true"
          [closeOnSelect]="false"
          [(ngModel)]="supportTypeIds"
        >
          <ng-template ng-label-tmp let-item="item" let-clear="clear">
            <app-type-chip [type]="item" removable (removed)="clear(item)" />
          </ng-template>
          <ng-template ng-option-tmp let-item="item">
            <app-type-chip [type]="item" />
          </ng-template>
        </ng-select>
      </div>
      <div class="col-span-2 xl:col-span-12">
        <label class="label" for="nt-note">Observación</label>
        <input id="nt-note" class="input" name="note" maxlength="5000" placeholder="Opcional" autocomplete="off" [(ngModel)]="note" />
      </div>
      <div class="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1">
        <button type="submit" class="btn btn-primary" [disabled]="!canRegister()">
          <i class="mdi" [class]="saving() ? 'mdi-loading mdi-spin' : 'mdi-plus'" aria-hidden="true"></i>
          {{ saving() ? 'Registrando…' : 'Registrar' }}
        </button>
        <p class="text-xs text-muted">El formulario queda abierto para registrar varios casos seguidos. La fecha de registro la pone el sistema.</p>
      </div>
    </form>
  `,
})
export class NewTicketForm {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  /** A case was registered. The list shows it by itself (see TicketEvents): this is for what only the list can do next. */
  readonly registered = output<TicketDetail>();
  readonly closed = output<void>();

  /** Upper limit of the case date: a problem cannot be reported in the future. */
  protected readonly today = todayIso();
  protected readonly statusOptions = STATUSES.map((id) => ({ id, label: STATUS_LABEL[id] }));
  protected readonly priorityOptions = PRIORITIES.map((id) => ({ id, label: PRIORITY_LABEL[id] }));

  protected readonly date = signal(todayIso());
  /** Empty: the case has only its date. */
  protected readonly time = signal('');
  protected readonly companyId = signal<number | null>(null);
  protected readonly description = signal('');
  protected readonly status = signal<TicketStatus>('PENDING');
  /** Null: the new case has no responsible. Nobody is one by registering it. */
  protected readonly assigneeId = signal<number | null>(null);
  /** Null: the case has no priority, and so no deadline. */
  protected readonly priority = signal<Priority | null>(null);
  protected readonly moduleId = signal<number | null>(null);
  protected readonly supportTypeIds = signal<number[]>([]);
  protected readonly note = signal('');

  protected readonly saving = signal(false);
  /** A case needs its company and its description. The rest has a value to start with, or is optional. */
  protected readonly canRegister = computed(() => this.companyId() !== null && !!this.description().trim() && !this.saving());

  private readonly companySelect = viewChild.required<NgSelectComponent>('company');

  constructor() {
    // The date is already today: the first thing to fill in is the company.
    afterNextRender(() => this.companySelect().focus());
  }

  /** "Crear empresa «X»" in the company select: the company joins the catalog, and the select chooses it for the case being typed. */
  protected readonly createCompany = companyCreator();

  protected async register(): Promise<void> {
    const companyId = this.companyId();
    const description = this.description().trim();
    // Enter in a field sends the form whatever its button looks like, and so does a second
    // press that arrives before the button is drawn disabled.
    if (companyId === null || !description || this.saving()) return;
    const types = this.supportTypeIds();
    this.saving.set(true);
    try {
      const ticket = await this.api.createTicket({
        // A date field left empty: the case is of today, as the form offered.
        date: this.date() || todayIso(),
        time: this.time() || undefined,
        companyId,
        description,
        status: this.status(),
        assigneeId: this.assigneeId(),
        priority: this.priority() ?? undefined,
        moduleId: this.moduleId() ?? undefined,
        supportTypeIds: types.length ? types : undefined,
        note: this.note().trim() || undefined,
      });
      this.toast.ok(`Caso ${ticket.code} registrado`);
      this.startNext();
      this.registered.emit(ticket);
    } catch (error) {
      // Nothing is cleared: what was typed is there to correct, or to send again.
      this.toast.error(error);
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Leaves the form ready for another case. What belongs to the one just registered is emptied.
   * The date and the responsible stay: cases typed in a row are often of the same day, and
   * taken by the same person.
   */
  private startNext(): void {
    this.date.update((date) => date || todayIso());
    this.time.set('');
    this.companyId.set(null);
    this.description.set('');
    this.status.set('PENDING');
    this.priority.set(null);
    this.moduleId.set(null);
    this.supportTypeIds.set([]);
    this.note.set('');
    this.companySelect().focus();
  }
}
