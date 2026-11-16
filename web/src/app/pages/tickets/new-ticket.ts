import { ChangeDetectionStrategy, Component, ElementRef, Injector, afterNextRender, computed, inject, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketStatus } from '../../core/api';
import { AssigneeSelect, CompanySelect, ModuleSelect, PrioritySelect, StatusSelect, SupportTypeSelect } from '../../core/case-selects';
import { Catalogs } from '../../core/catalogs';
import { focusProblem } from '../../core/focus';
import { Hint } from '../../core/hint';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { Toast } from '../../core/toast';
import { todayIso } from '../../core/ui';
import { MISSING_COMPANY, MISSING_DESCRIPTION, futureDate } from './ticket-form';

/**
 * "Nuevo caso": the short form above the case list, for a case typed by hand. It stays open
 * after each one, to register several in a row. A case can be registered whole from here: the
 * list has nothing to edit it with afterwards. What a new case rarely needs (times, the promise)
 * is filled in later, in the form of the case.
 */
@Component({
  selector: 'app-new-ticket',
  imports: [FormsModule, CompanySelect, StatusSelect, AssigneeSelect, PrioritySelect, ModuleSelect, SupportTypeSelect, Hint, Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { id: 'new-ticket', class: 'block' },
  template: `
    <form class="card grid grid-cols-1 gap-x-3 gap-y-2 p-3 xs:grid-cols-2 lg:grid-cols-4 xl:grid-cols-12" aria-labelledby="nt-title" (ngSubmit)="register()">
      <div class="col-span-full flex items-center gap-2">
        <h2 id="nt-title" class="section-title mr-auto">Nuevo caso</h2>
        <button type="button" class="btn btn-ghost btn-icon -my-1 px-2 py-1" aria-label="Cerrar el formulario de caso nuevo" title="Cerrar" (click)="closed.emit()">
          <app-icon name="close" class="text-lg leading-none" />
        </button>
      </div>
      <!-- The hint of a label is behind its "?", and is the description of its field too (see Hint). -->
      <div class="xl:col-span-2">
        <div class="label flex items-center gap-1">
          <label for="nt-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
          <app-hint textId="nt-date-hint" about="Fecha del caso" text="Día en que el cliente reportó el problema" />
        </div>
        <input
          #dateBox
          id="nt-date"
          class="input aria-[invalid=true]:border-danger"
          type="date"
          name="date"
          [max]="today"
          [(ngModel)]="date"
          [attr.aria-invalid]="problems().date ? 'true' : null"
          [attr.aria-describedby]="problems().date ? 'nt-date-error nt-date-hint' : 'nt-date-hint'"
        />
        @if (problems().date; as problem) {
          <p class="field-error" id="nt-date-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
        }
      </div>
      <div class="xl:col-span-2">
        <div class="label flex items-center gap-1">
          <label for="nt-time" title="Hora en que el cliente lo reportó. Opcional">Hora</label>
          <app-hint textId="nt-time-hint" about="Hora" text="Hora en que el cliente lo reportó. Opcional" />
        </div>
        <input id="nt-time" class="input" type="time" name="time" aria-describedby="nt-time-hint" [(ngModel)]="time" />
      </div>
      <div class="xs:col-span-2 xl:col-span-3">
        <label class="label" for="nt-company">Empresa <span class="text-danger" aria-hidden="true">*</span></label>
        <!-- "Crear empresa «X»": the company joins the catalog, and the select chooses it for the case being typed. -->
        <app-company-select
          #company
          inputId="nt-company"
          placeholder="Elige o escribe una empresa"
          creatable
          required
          [invalid]="!!problems().company"
          [describedBy]="problems().company ? 'nt-company-error' : null"
          [items]="catalogs.activeCompanies()"
          [(value)]="companyId"
        />
        @if (problems().company; as problem) {
          <p class="field-error" id="nt-company-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
        }
      </div>
      <div class="xs:col-span-2 lg:col-span-4 xl:col-span-5">
        <label class="label" for="nt-description">Descripción <span class="text-danger" aria-hidden="true">*</span></label>
        <!-- A text area: what a client wrote is pasted here with its lines. Enter is a new line, so the form is sent with Ctrl+Enter. -->
        <textarea
          #descriptionBox
          id="nt-description"
          class="input min-h-[2.375rem] resize-y aria-[invalid=true]:border-danger"
          name="description"
          rows="2"
          maxlength="5000"
          required
          placeholder="Qué reportó el cliente (Ctrl+Enter para registrar)"
          [(ngModel)]="description"
          (keydown.control.enter)="register()"
          [attr.aria-invalid]="problems().description ? 'true' : null"
          [attr.aria-describedby]="problems().description ? 'nt-description-error' : null"
        ></textarea>
        @if (problems().description; as problem) {
          <p class="field-error" id="nt-description-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
        }
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-status">Estado</label>
        <app-status-select inputId="nt-status" [(value)]="status" />
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-assignee">Responsable</label>
        <!-- Empty unless someone is chosen: registering a case makes nobody its responsible. -->
        <app-assignee-select inputId="nt-assignee" [items]="catalogs.activeAssignees()" [(value)]="assigneeId" />
      </div>
      <div class="xl:col-span-2">
        <label class="label" for="nt-priority">Prioridad</label>
        <app-priority-select inputId="nt-priority" [(value)]="priority" />
      </div>
      <div class="xl:col-span-3">
        <label class="label" for="nt-module">Módulo</label>
        <app-module-select inputId="nt-module" [items]="catalogs.activeModules()" [(value)]="moduleId" />
      </div>
      <div class="xs:col-span-2 xl:col-span-3">
        <label class="label" for="nt-types">Tipos de soporte</label>
        <app-support-type-select inputId="nt-types" multiple [items]="catalogs.activeSupportTypes()" [(value)]="supportTypeIds" />
      </div>
      <div class="xs:col-span-2 xl:col-span-12">
        <label class="label" for="nt-note">Observación</label>
        <input id="nt-note" class="input" name="note" maxlength="5000" placeholder="Opcional" autocomplete="off" [(ngModel)]="note" />
      </div>
      <div class="col-span-full flex flex-wrap items-center gap-x-3 gap-y-1">
        <!-- Never disabled for a field left empty: pressed, it says which one. While it waits it keeps the focus. -->
        <button type="submit" class="btn btn-primary" [appSoftDisabled]="saving()">
          <app-icon [name]="saving() ? 'loading' : 'plus'" />
          {{ saving() ? 'Registrando…' : 'Registrar' }}
        </button>
        <!-- The fields that need one say they are required to who hears them (required, aria-required): the asterisk is for the eye. -->
        <p class="text-xs text-muted">
          <span aria-hidden="true"><span class="text-danger">*</span> Obligatorio. </span>El formulario queda abierto para registrar varios casos seguidos. La fecha de
          registro la pone el sistema.
        </p>
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
  /** "Registrar" was pressed with a field missing: from then on each missing field says so, until it is filled. */
  private readonly tried = signal(false);
  /**
   * What keeps the case from being registered, each said under its field. A case needs its
   * company and its description; the rest has a value to start with, or is optional. A date in the
   * future is said at once.
   */
  protected readonly problems = computed(() => ({
    date: futureDate(this.date(), this.today),
    company: this.tried() && this.companyId() === null ? MISSING_COMPANY : undefined,
    description: this.tried() && !this.description().trim() ? MISSING_DESCRIPTION : undefined,
  }));

  private readonly companySelect = viewChild.required<CompanySelect<number | null>>('company');
  private readonly dateBox = viewChild.required<ElementRef<HTMLInputElement>>('dateBox');
  private readonly descriptionBox = viewChild.required<ElementRef<HTMLTextAreaElement>>('descriptionBox');
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

  constructor() {
    // The date is already today: the first thing to fill in is the company.
    afterNextRender(() => this.companySelect().focus());
  }

  protected async register(): Promise<void> {
    const companyId = this.companyId();
    const description = this.description().trim();
    // Also Ctrl+Enter in the description while the case is on its way.
    if (this.saving()) return;
    if (companyId === null || !description || futureDate(this.date(), this.today)) {
      this.tried.set(true);
      this.focusFirstProblem();
      return;
    }
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

  /** The focus goes to the first field that keeps the case from being registered, which says why (see focusProblem). */
  private focusFirstProblem(): void {
    const { date, company, description } = this.problems();
    if (date) focusProblem(this.injector, this.dateBox().nativeElement, date);
    else if (company) focusProblem(this.injector, () => this.host.querySelector('#nt-company'), company);
    else if (description) focusProblem(this.injector, this.descriptionBox().nativeElement, description);
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
    // Empty again, and not yet missing: nothing was pressed for the next case.
    this.tried.set(false);
    this.companySelect().focus();
  }
}
