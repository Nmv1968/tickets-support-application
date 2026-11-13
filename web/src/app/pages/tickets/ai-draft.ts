import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgSelectComponent } from '@ng-select/ng-select';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketStatus } from '../../core/api';
import { Catalogs, companyCreator, findByName } from '../../core/catalogs';
import { SELECT } from '../../core/select';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';
import { PRIORITIES, PRIORITY_LABEL, STATUSES, STATUS_LABEL, errorMessage, imagesFrom, pastedImages, shrinkImage, todayIso } from '../../core/ui';

interface Picked {
  file: File;
  url: string;
}

const MAX_IMAGES = 4;

/**
 * New case from a photo, a screenshot or pasted text.
 * Step 1 collects the evidence; the AI drafts the case; step 2 lets a person
 * review every field before anything is saved.
 */
@Component({
  selector: 'app-ai-draft',
  imports: [FormsModule, A11yModule, ...SELECT, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()', '(document:paste)': 'onPaste($event)' },
  template: `
    <div class="modal-backdrop" (click)="onBackdrop($event)">
      <div class="card flex max-h-full w-full max-w-2xl flex-col" role="dialog" aria-modal="true" aria-labelledby="ai-title" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <i class="mdi mdi-creation-outline text-xl text-primary" aria-hidden="true"></i>
          <h2 id="ai-title" class="font-semibold">{{ step() === 'input' ? 'Nuevo caso con IA' : 'Revisar el caso' }}</h2>
          <button type="button" class="btn btn-ghost ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar">
            <i class="mdi mdi-close text-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          @if (step() === 'input') {
            <div
              class="rounded-card border-2 border-dashed border-line p-4 text-center"
              [class.border-primary]="dragging()"
              (dragover)="$event.preventDefault(); dragging.set(true)"
              (dragleave)="dragging.set(false)"
              (drop)="onDrop($event)"
            >
              @if (images().length) {
                <div class="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  @for (image of images(); track image.url) {
                    <div class="relative overflow-hidden rounded-control border border-line">
                      <img class="aspect-video w-full object-cover" [src]="image.url" [alt]="image.file.name" />
                      <button type="button" class="absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" (click)="removeImage(image)" aria-label="Quitar imagen">
                        <i class="mdi mdi-close" aria-hidden="true"></i>
                      </button>
                    </div>
                  }
                </div>
              } @else {
                <i class="mdi mdi-image-plus-outline text-4xl text-muted" aria-hidden="true"></i>
                <p class="mt-1 font-medium">Pega una captura (Ctrl+V) o arrastra una imagen aquí</p>
                <p class="text-xs text-muted">Hasta {{ maxImages }} imágenes: pantalla con el error, foto del equipo, chat del cliente…</p>
              }
              <div class="mt-3 flex flex-wrap justify-center gap-2">
                <label class="btn btn-soft cursor-pointer">
                  <i class="mdi mdi-folder-image" aria-hidden="true"></i> Elegir imágenes
                  <input type="file" class="sr-only" accept="image/*" multiple (change)="onFiles($event)" />
                </label>
                <label class="btn btn-soft cursor-pointer">
                  <i class="mdi mdi-camera-outline" aria-hidden="true"></i> Tomar foto
                  <input type="file" class="sr-only" accept="image/*" capture="environment" (change)="onFiles($event)" />
                </label>
                @if (canReadClipboard) {
                  <button type="button" class="btn btn-soft" (click)="pasteFromClipboard()">
                    <i class="mdi mdi-content-paste" aria-hidden="true"></i> Pegar captura
                  </button>
                }
              </div>
            </div>

            <div>
              <label class="label" for="ai-text">Texto del cliente o del técnico (opcional)</label>
              <textarea id="ai-text" class="input min-h-24 resize-y" placeholder="Pega aquí el mensaje de WhatsApp o describe lo que pasó" [(ngModel)]="text"></textarea>
            </div>

            @if (error()) {
              <p class="alert-error" role="alert">{{ error() }}</p>
            }
            <p class="text-2xs text-muted">
              Las imágenes y el texto se envían al proveedor de IA configurado. Evita enviar contraseñas o datos que no deban salir de la empresa.
            </p>
          } @else {
            @if (usedAi()) {
              <p class="rounded-control bg-primary/10 px-3 py-2 text-xs">
                Borrador redactado por <strong>{{ aiModel() }}</strong>. Revisa y corrige antes de guardar.
              </p>
            }
            <div class="grid grid-cols-2 gap-3">
              <!-- A row of its own on a phone: in half of one, the time leaves no room for the date. -->
              <div class="col-span-2 sm:col-span-1">
                <label class="label" for="ai-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
                <div class="flex gap-2">
                  <input id="ai-date" class="input min-w-0 flex-1" type="date" [max]="today" [(ngModel)]="date" />
                  <input class="input w-28" type="time" aria-label="Hora del caso (opcional)" title="Hora en que lo reportó el cliente (opcional)" [(ngModel)]="time" />
                </div>
                <p class="mt-1 text-2xs text-muted">Día en que lo reportó el cliente. La fecha de registro será hoy, automática.</p>
              </div>
              <!-- Every list of options hangs from the body: inside the dialog it would be cut where the dialog scrolls. -->
              <div class="col-span-2 sm:col-span-1">
                <label class="label" for="ai-status">Estado</label>
                <ng-select
                  labelForId="ai-status"
                  bindValue="id"
                  bindLabel="label"
                  appendTo="body"
                  [items]="statusOptions"
                  [clearable]="false"
                  [searchable]="false"
                  [(ngModel)]="status"
                />
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-company">Empresa <span class="text-danger" aria-hidden="true">*</span></label>
                <ng-select
                  #company
                  labelForId="ai-company"
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
                @if (unmatchedCompany(); as read) {
                  <!-- The company the AI read is in no option of the select: said here, with the way to add it. -->
                  <p id="ai-company-read" class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs" role="status">
                    @if (read.inactive) {
                      <span>La IA leyó «{{ read.name }}», que está desactivada. Elige otra empresa, o actívala en Configuración &gt; Empresas.</span>
                    } @else {
                      <span>La IA leyó «{{ read.name }}», que no está registrada.</span>
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs whitespace-normal" [disabled]="creatingCompany()" (click)="createReadCompany(read.name)">
                        <i class="mdi" [class]="creatingCompany() ? 'mdi-loading mdi-spin' : 'mdi-plus'" aria-hidden="true"></i>
                        Crear empresa «{{ read.name }}»
                      </button>
                    }
                  </p>
                }
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-description">Descripción <span class="text-danger" aria-hidden="true">*</span></label>
                <textarea id="ai-description" class="input min-h-20 resize-y" maxlength="5000" required [(ngModel)]="description"></textarea>
              </div>
              <div>
                <label class="label" for="ai-assignee">Responsable</label>
                <!-- Empty unless someone is chosen: registering a case makes nobody its responsible. -->
                <ng-select
                  labelForId="ai-assignee"
                  bindValue="id"
                  bindLabel="name"
                  placeholder="Sin asignar"
                  appendTo="body"
                  [items]="catalogs.activeAssignees()"
                  [(ngModel)]="assigneeId"
                />
              </div>
              <div>
                <label class="label" for="ai-priority">Prioridad</label>
                <ng-select
                  labelForId="ai-priority"
                  bindValue="id"
                  bindLabel="label"
                  placeholder="Sin prioridad"
                  appendTo="body"
                  [items]="priorityOptions"
                  [searchable]="false"
                  [(ngModel)]="priority"
                />
              </div>
              <div>
                <label class="label" for="ai-module">Módulo</label>
                <ng-select
                  labelForId="ai-module"
                  bindValue="id"
                  bindLabel="fullName"
                  placeholder="Sin módulo"
                  appendTo="body"
                  [items]="catalogs.activeModules()"
                  [(ngModel)]="moduleId"
                />
              </div>
              <div>
                <label class="label" for="ai-estimated">Tiempo estimado (minutos)</label>
                <input id="ai-estimated" class="input" type="number" min="0" step="5" [(ngModel)]="estimated" />
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-types">Tipos de soporte</label>
                <!-- The list stays open after each choice: a case often takes more than one. -->
                <ng-select
                  labelForId="ai-types"
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
              <div class="col-span-2 rounded-control border border-line px-3 py-2.5">
                <div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
                  <label class="flex cursor-pointer items-center gap-2 font-medium" title="Día en que se le promete al cliente tener el caso resuelto">
                    <input type="checkbox" role="switch" class="sr-only" [(ngModel)]="promiseOn" />
                    <span class="toggle" aria-hidden="true"></span>
                    Promesa de entrega
                  </label>
                  @if (promiseOn()) {
                    <input class="input w-auto py-1.5" type="date" aria-label="Fecha prometida de entrega" [min]="today" [(ngModel)]="promisedDate" />
                  } @else {
                    <span class="text-xs text-muted">Sin fecha prometida al cliente</span>
                  }
                </div>
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-note">Observación</label>
                <textarea id="ai-note" class="input min-h-16 resize-y" maxlength="5000" [(ngModel)]="note"></textarea>
              </div>
            </div>
            @if (images().length) {
              <p class="text-xs text-muted"><i class="mdi mdi-paperclip" aria-hidden="true"></i> {{ images().length }} imagen(es) se guardan como adjuntos del caso.</p>
            }
            @if (error()) {
              <p class="alert-error" role="alert">{{ error() }}</p>
            }
          }
        </div>

        <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          @if (step() === 'input') {
            <button type="button" class="btn btn-ghost mr-auto" [disabled]="busy()" (click)="skipAi()">Llenar a mano</button>
            <button type="button" class="btn btn-primary" [disabled]="busy() || (!images().length && !text().trim())" (click)="analyze()">
              <i class="mdi" [class]="busy() ? 'mdi-loading mdi-spin' : 'mdi-creation-outline'" aria-hidden="true"></i>
              {{ busy() ? 'Analizando…' : 'Analizar con IA' }}
            </button>
          } @else {
            <button type="button" class="btn btn-ghost mr-auto" [disabled]="busy()" (click)="step.set('input')">Volver</button>
            <button type="button" class="btn btn-primary" [disabled]="busy() || companyId() === null || !description().trim() || (promiseOn() && !promisedDate())" (click)="save()">
              {{ busy() ? 'Guardando…' : 'Guardar caso' }}
            </button>
          }
        </footer>
      </div>
    </div>
  `,
})
export class AiDraftDialog {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  /** Images already available when the dialog opens (a screenshot pasted on the list). */
  readonly initialImages = input<File[]>([]);
  readonly closed = output<void>();
  readonly created = output<TicketDetail>();

  protected readonly maxImages = MAX_IMAGES;
  protected readonly today = todayIso();
  /** Reading the clipboard from a button only exists on HTTPS or localhost. */
  protected readonly canReadClipboard = typeof navigator.clipboard?.read === 'function';
  protected readonly statusOptions = STATUSES.map((id) => ({ id, label: STATUS_LABEL[id] }));
  protected readonly priorityOptions = PRIORITIES.map((id) => ({ id, label: PRIORITY_LABEL[id] }));

  protected readonly step = signal<'input' | 'review'>('input');
  protected readonly images = signal<Picked[]>([]);
  protected readonly text = signal('');
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly usedAi = signal(false);
  protected readonly aiModel = signal('');

  // Draft fields
  protected readonly date = signal(todayIso());
  /** Time of the case. Empty: the case has only its date. */
  protected readonly time = signal('');
  protected readonly status = signal<TicketStatus>('PENDING');
  /** A company of the catalog. Null until one is chosen: the case cannot be saved without it. */
  protected readonly companyId = signal<number | null>(null);
  protected readonly description = signal('');
  /** Null: the new case has no responsible. Nobody is one by registering it. */
  protected readonly assigneeId = signal<number | null>(null);
  protected readonly priority = signal<Priority | null>(null);
  protected readonly moduleId = signal<number | null>(null);
  protected readonly supportTypeIds = signal<number[]>([]);
  protected readonly estimated = signal<number | null>(null);
  protected readonly promiseOn = signal(false);
  protected readonly promisedDate = signal('');
  protected readonly note = signal('');

  /**
   * The company as the AI read it in the evidence: a text, not a company of the catalog. One the
   * catalog offers under that name is chosen in the select (see analyze). Otherwise the name is
   * kept here, to tell the person and offer to add it.
   */
  private readonly readCompany = signal('');
  /**
   * The company the AI read, while no company is chosen and the select does not offer that one:
   * it is not in the catalog, or it is and was deactivated (a new case does not take those).
   */
  protected readonly unmatchedCompany = computed(() => {
    const name = this.readCompany();
    if (!name || this.companyId() !== null || findByName(this.catalogs.activeCompanies(), name)) return null;
    return { name, inactive: !!findByName(this.catalogs.companies(), name) };
  });
  /** "Crear empresa «X»" in the company select. */
  protected readonly createCompany = companyCreator();
  protected readonly creatingCompany = signal(false);
  private readonly companySelect = viewChild<NgSelectComponent>('company');

  constructor() {
    // Inputs are set before the first change detection; read them once the component exists.
    queueMicrotask(() => this.addImages(this.initialImages()));
    inject(DestroyRef).onDestroy(() => this.images().forEach((image) => URL.revokeObjectURL(image.url)));
  }

  /**
   * Closes when the click lands on the backdrop itself. Kept as a method that returns nothing:
   * an inline `a && b` expression evaluates to false for clicks inside the dialog, and Angular
   * then cancels the click, which stops file inputs and checkboxes from working.
   */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  private addImages(files: File[]): void {
    const room = MAX_IMAGES - this.images().length;
    if (files.length > room) this.toast.error(`Máximo ${MAX_IMAGES} imágenes por caso`);
    const picked = files.slice(0, Math.max(room, 0)).map((file) => ({ file, url: URL.createObjectURL(file) }));
    if (picked.length) this.images.update((images) => [...images, ...picked]);
  }

  protected removeImage(image: Picked): void {
    URL.revokeObjectURL(image.url);
    this.images.update((images) => images.filter((item) => item !== image));
  }

  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.addImages(Array.from(input.files ?? []).filter((file) => file.type.startsWith('image/')));
    input.value = '';
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.addImages(imagesFrom(event.dataTransfer));
  }

  protected onPaste(event: ClipboardEvent): void {
    if (this.step() !== 'input') return;
    const images = pastedImages(event);
    if (!images.length) return;
    event.preventDefault();
    this.addImages(images);
  }

  /** Button alternative to Ctrl+V. The browser asks the user for permission the first time. */
  protected async pasteFromClipboard(): Promise<void> {
    try {
      const files: File[] = [];
      for (const item of await navigator.clipboard.read()) {
        const type = item.types.find((t) => t.startsWith('image/'));
        if (!type) continue;
        files.push(new File([await item.getType(type)], `captura-${Date.now()}.${type.split('/')[1]}`, { type }));
      }
      if (files.length) this.addImages(files);
      else this.toast.error('El portapapeles no tiene una imagen. Copia o captura la pantalla primero.');
    } catch {
      this.toast.error('El navegador no permitió leer el portapapeles. Usa Ctrl+V o "Elegir imágenes".');
    }
  }

  protected async analyze(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const small = await Promise.all(this.images().map((image) => shrinkImage(image.file)));
      const draft = await this.api.aiAnalyze(this.text().trim(), small);
      // The reported day only when the evidence shows one; otherwise it stays on today.
      if (draft.date) this.date.set(draft.date);
      this.time.set(draft.time ?? '');
      // The AI gives the company as the text it read. The case is of the company of the catalog
      // with that name, however it is written; with none, the person chooses (see unmatchedCompany).
      const company = draft.company?.trim() ?? '';
      this.readCompany.set(company);
      this.companyId.set(findByName(this.catalogs.activeCompanies(), company)?.id ?? null);
      this.description.set(draft.description);
      this.priority.set(draft.priority);
      this.moduleId.set(draft.moduleId);
      this.estimated.set(draft.estimatedMinutes);
      this.note.set(draft.note ?? '');
      this.aiModel.set(draft.model);
      this.usedAi.set(true);
      this.step.set('review');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  /** Goes to the form without calling the AI. The pasted text becomes the description. */
  protected skipAi(): void {
    if (!this.description().trim()) this.description.set(this.text().trim());
    this.usedAi.set(false);
    this.error.set('');
    this.step.set('review');
  }

  /**
   * The button under the company select: adds the company the AI read to the catalog, as it read
   * it, and chooses it for the case. The same as typing that name in the select and taking its
   * "Crear empresa «X»".
   */
  protected async createReadCompany(name: string): Promise<void> {
    if (this.creatingCompany()) return;
    this.creatingCompany.set(true);
    try {
      this.companyId.set((await this.createCompany(name)).id);
      // The button goes away with what it said, and the focus it had with it.
      this.companySelect()?.focus();
    } catch {
      // Already said (see companyCreator). The button stays, to try again or to choose another company.
    } finally {
      this.creatingCompany.set(false);
    }
  }

  protected async save(): Promise<void> {
    const companyId = this.companyId();
    // Also a press that arrives before the button is drawn disabled.
    if (companyId === null || this.busy()) return;
    const types = this.supportTypeIds();
    this.busy.set(true);
    this.error.set('');
    try {
      const estimated = Number(this.estimated());
      let ticket = await this.api.createTicket({
        date: this.date() || todayIso(),
        time: this.time() || undefined,
        status: this.status(),
        companyId,
        description: this.description().trim(),
        assigneeId: this.assigneeId(),
        priority: this.priority(),
        moduleId: this.moduleId(),
        supportTypeIds: types.length ? types : undefined,
        estimatedMinutes: Number.isFinite(estimated) && estimated > 0 ? Math.round(estimated) : null,
        note: this.note().trim() || undefined,
        promisedDate: this.promiseOn() && this.promisedDate() ? this.promisedDate() : null,
        aiGenerated: this.usedAi(),
      });

      const files = this.images().map((image) => image.file);
      if (files.length) {
        try {
          ticket = await this.api.uploadAttachments(ticket.id, files);
        } catch (error) {
          this.toast.error(`El caso ${ticket.code} se guardó, pero falló la subida de imágenes: ${errorMessage(error)}`);
        }
      }
      this.toast.ok(`Caso ${ticket.code} registrado`);
      this.created.emit(ticket);
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
