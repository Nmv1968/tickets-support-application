import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, computed, inject, input, output, signal, viewChild } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Say } from '../../core/announcer';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketStatus } from '../../core/api';
import { BackdropClick } from '../../core/backdrop-click';
import { AssigneeSelect, CompanySelect, ModuleSelect, PrioritySelect, StatusSelect, SupportTypeSelect } from '../../core/case-selects';
import { Catalogs, findByName } from '../../core/catalogs';
import { focusAfterRender, focusProblem } from '../../core/focus';
import { Hint } from '../../core/hint';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { Toast } from '../../core/toast';
import { errorMessage, imagesFrom, pastedImages, shrinkImage, todayIso } from '../../core/ui';
import { MISSING_COMPANY, MISSING_DESCRIPTION, futureDate } from './ticket-form';

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
  imports: [FormsModule, A11yModule, BackdropClick, CompanySelect, StatusSelect, AssigneeSelect, PrioritySelect, ModuleSelect, SupportTypeSelect, Hint, Icon, Say, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()', '(document:paste)': 'onPaste($event)' },
  template: `
    <div class="modal-backdrop" (appBackdropClick)="closed.emit()">
      <div class="card overlay max-h-full w-full max-w-2xl" role="dialog" aria-modal="true" aria-labelledby="ai-title" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <app-icon name="creation-outline" class="text-xl text-primary" />
          <!-- Where the focus goes from one step to the other: the button that moved it is gone with its step. -->
          <h2 #title id="ai-title" class="rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary" tabindex="-1">{{ step() === 'input' ? 'Nuevo caso con IA' : 'Revisar el caso' }}</h2>
          <button type="button" class="btn btn-ghost btn-icon ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar">
            <app-icon name="close" class="text-lg" />
          </button>
        </header>

        <div class="overlay-body space-y-4 p-4">
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
                      <button type="button" class="btn-icon absolute top-1 right-1 grid size-6 place-items-center rounded-full bg-black/60 text-white" (click)="removeImage(image)" aria-label="Quitar imagen">
                        <app-icon name="close" />
                      </button>
                    </div>
                  }
                </div>
              } @else {
                <app-icon name="image-plus-outline" class="text-4xl text-muted" />
                <p class="mt-1 font-medium">Pega una captura (Ctrl+V) o arrastra una imagen aquí</p>
                <p class="text-xs text-muted">Hasta {{ maxImages }} imágenes: pantalla con el error, foto del equipo, chat del cliente…</p>
              }
              <div class="mt-3 flex flex-wrap justify-center gap-2">
                <label class="btn btn-soft cursor-pointer">
                  <app-icon name="folder-image" /> Elegir imágenes
                  <input type="file" class="sr-only" accept="image/*" multiple (change)="onFiles($event)" />
                </label>
                <label class="btn btn-soft cursor-pointer">
                  <app-icon name="camera-outline" /> Tomar foto
                  <input type="file" class="sr-only" accept="image/*" capture="environment" (change)="onFiles($event)" />
                </label>
                @if (canReadClipboard) {
                  <button type="button" class="btn btn-soft" (click)="pasteFromClipboard()">
                    <app-icon name="content-paste" /> Pegar captura
                  </button>
                }
              </div>
            </div>

            <div>
              <label class="label" for="ai-text">Texto del cliente o del técnico (opcional)</label>
              <textarea id="ai-text" class="input min-h-24 resize-y" placeholder="Pega aquí el mensaje de WhatsApp o describe lo que pasó" [(ngModel)]="text"></textarea>
            </div>

            <!-- Said at once as it comes (see Say), here and in the next step: an alert that comes with its words may not be read. -->
            @if (error()) {
              <p class="alert-error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
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
            <!-- The fields that need one say they are required to who hears them (required, aria-required): the asterisk is for the eye. -->
            <p class="text-2xs text-muted" aria-hidden="true"><span class="text-danger">*</span> Obligatorio.</p>
            <div class="grid grid-cols-1 gap-3 xs:grid-cols-2">
              <!-- A row of its own on a phone: in half of one, the time leaves no room for the date. -->
              <div class="xs:col-span-2 sm:col-span-1">
                <label class="label" for="ai-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
                <div class="flex gap-2">
                  <input
                    #dateBox
                    id="ai-date"
                    class="input min-w-0 flex-1 aria-[invalid=true]:border-danger"
                    type="date"
                    [max]="today"
                    [(ngModel)]="date"
                    [attr.aria-invalid]="problems().date ? 'true' : null"
                    [attr.aria-describedby]="problems().date ? 'ai-date-error ai-date-hint' : 'ai-date-hint'"
                  />
                  <input class="input w-28" type="time" aria-label="Hora del caso (opcional)" title="Hora en que lo reportó el cliente (opcional)" aria-describedby="ai-date-hint" [(ngModel)]="time" />
                </div>
                @if (problems().date; as problem) {
                  <p class="field-error" id="ai-date-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
                <p class="mt-1 text-2xs text-muted" id="ai-date-hint">Día en que lo reportó el cliente, y la hora si se sabe (opcional). La fecha de registro será hoy, automática.</p>
              </div>
              <div class="xs:col-span-2 sm:col-span-1">
                <label class="label" for="ai-status">Estado</label>
                <app-status-select inputId="ai-status" [(value)]="status" />
              </div>
              <div class="xs:col-span-2">
                <label class="label" for="ai-company">Empresa <span class="text-danger" aria-hidden="true">*</span></label>
                <app-company-select
                  #company
                  inputId="ai-company"
                  placeholder="Elige o escribe una empresa"
                  creatable
                  required
                  [invalid]="!!problems().company"
                  [describedBy]="problems().company ? 'ai-company-error' : null"
                  [items]="catalogs.activeCompanies()"
                  [(value)]="companyId"
                />
                @if (problems().company; as problem) {
                  <p class="field-error" id="ai-company-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
                @if (unmatchedCompany(); as read) {
                  <!--
                    The company the AI read is in no option of the select: said here, with the way to add it. Its words are said
                    as they come (see Say), and its button is in no live region: a status that held it read it out with them.
                  -->
                  <p id="ai-company-read" class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    @if (read.inactive) {
                      <span appSay>La IA leyó «{{ read.name }}», que está desactivada. Elige otra empresa, o actívala en Configuración &gt; Empresas.</span>
                    } @else {
                      <span appSay>La IA leyó «{{ read.name }}», que no está registrada.</span>
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs whitespace-normal" [appSoftDisabled]="creatingCompany()" (click)="createReadCompany(read.name)">
                        <app-icon [name]="creatingCompany() ? 'loading' : 'plus'" />
                        @if (creatingCompany()) {
                          Creando empresa «{{ read.name }}»…
                        } @else {
                          Crear empresa «{{ read.name }}»
                        }
                      </button>
                    }
                  </p>
                }
              </div>
              <div class="xs:col-span-2">
                <label class="label" for="ai-description">Descripción <span class="text-danger" aria-hidden="true">*</span></label>
                <textarea
                  #descriptionBox
                  id="ai-description"
                  class="input min-h-20 resize-y aria-[invalid=true]:border-danger"
                  maxlength="5000"
                  required
                  [(ngModel)]="description"
                  [attr.aria-invalid]="problems().description ? 'true' : null"
                  [attr.aria-describedby]="problems().description ? 'ai-description-error' : null"
                ></textarea>
                @if (problems().description; as problem) {
                  <p class="field-error" id="ai-description-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
                }
              </div>
              <div>
                <label class="label" for="ai-assignee">Responsables</label>
                <!-- Empty unless someone is chosen: registering a case makes nobody its responsible. -->
                <app-assignee-select inputId="ai-assignee" multiple [items]="catalogs.activeAssignees()" [(value)]="assigneeIds" />
              </div>
              <div>
                <label class="label" for="ai-priority">Prioridad</label>
                <app-priority-select inputId="ai-priority" [(value)]="priority" />
              </div>
              <div>
                <label class="label" for="ai-module">Módulo</label>
                <app-module-select inputId="ai-module" [items]="catalogs.activeModules()" [(value)]="moduleId" />
              </div>
              <div>
                <label class="label" for="ai-estimated">Tiempo estimado (minutos)</label>
                <input id="ai-estimated" class="input" type="number" min="0" step="5" [(ngModel)]="estimated" />
              </div>
              <div class="xs:col-span-2">
                <label class="label" for="ai-types">Tipos de soporte</label>
                <app-support-type-select inputId="ai-types" multiple [items]="catalogs.activeSupportTypes()" [(value)]="supportTypeIds" />
              </div>
              <div class="xs:col-span-2 rounded-control border border-line px-3 py-2.5">
                <div class="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-2">
                  <!-- The hint of the switch is behind its "?", and is its description too (see Hint). -->
                  <span class="flex items-center gap-1">
                    <label class="flex cursor-pointer items-center gap-2 font-medium" title="Día en que se le promete al cliente tener el caso resuelto">
                      <input type="checkbox" role="switch" class="sr-only" aria-describedby="ai-promise-hint" [(ngModel)]="promiseOn" />
                      <span class="toggle" aria-hidden="true"></span>
                      Promesa de entrega
                    </label>
                    <app-hint textId="ai-promise-hint" about="Promesa de entrega" text="Día en que se le promete al cliente tener el caso resuelto" />
                  </span>
                  @if (promiseOn()) {
                    <input
                      #promiseBox
                      class="input w-auto py-1.5 aria-[invalid=true]:border-danger"
                      type="date"
                      aria-label="Fecha prometida de entrega"
                      [min]="today"
                      [(ngModel)]="promisedDate"
                      [attr.aria-invalid]="problems().promisedDate ? 'true' : null"
                      [attr.aria-describedby]="problems().promisedDate ? 'ai-promise-error' : null"
                    />
                    @if (problems().promisedDate; as problem) {
                      <span class="text-xs" id="ai-promise-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</span>
                    }
                  } @else {
                    <span class="text-xs text-muted">Sin fecha prometida al cliente</span>
                  }
                </div>
              </div>
              <div class="xs:col-span-2">
                <label class="label" for="ai-note">Observación</label>
                <textarea id="ai-note" class="input min-h-16 resize-y" maxlength="5000" [(ngModel)]="note"></textarea>
              </div>
            </div>
            @if (images().length) {
              <p class="text-xs text-muted"><app-icon name="paperclip" /> {{ images().length }} imagen(es) se guardan como adjuntos del caso.</p>
            }
            @if (error()) {
              <p class="alert-error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
            }
          }
        </div>

        <footer class="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
          @if (step() === 'input') {
            <button type="button" class="btn btn-ghost mr-auto" [appSoftDisabled]="busy()" (click)="skipAi()">Llenar a mano</button>
            <button type="button" class="btn btn-primary" [appSoftDisabled]="busy() || (!images().length && !text().trim())" (click)="analyze()">
              <app-icon [name]="busy() ? 'loading' : 'creation-outline'" />
              {{ busy() ? 'Analizando…' : 'Analizar con IA' }}
            </button>
          } @else {
            <button type="button" class="btn btn-ghost mr-auto" [appSoftDisabled]="busy()" (click)="goTo('input')">Volver</button>
            <!-- Never disabled for a field left empty: pressed, it says which one. While it waits it keeps the focus. -->
            <button type="button" class="btn btn-primary" [appSoftDisabled]="busy()" (click)="save()">
              {{ busy() ? 'Guardando…' : 'Guardar caso' }}
            </button>
          }
        </footer>
      </div>
    </div>
  `,
})
export class AiDraftDialog implements OnInit {
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
  /** Empty: the new case has no responsible. Nobody is one by registering it. */
  protected readonly assigneeIds = signal<number[]>([]);
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
  protected readonly creatingCompany = signal(false);
  /** The company select, whose "Crear empresa «X»" the button for the company the AI read uses too. */
  private readonly companySelect = viewChild<CompanySelect<number | null>>('company');

  /** "Guardar caso" was pressed with a field missing: from then on each missing field says so, until it is filled. */
  private readonly tried = signal(false);
  /** What keeps the case from being saved, each said under its field. A date in the future is said at once. */
  protected readonly problems = computed(() => ({
    date: futureDate(this.date(), this.today),
    company: this.tried() && this.companyId() === null ? MISSING_COMPANY : undefined,
    description: this.tried() && !this.description().trim() ? MISSING_DESCRIPTION : undefined,
    promisedDate: this.tried() && this.promiseOn() && !this.promisedDate() ? 'Elige la fecha prometida' : undefined,
  }));
  private readonly title = viewChild.required<ElementRef<HTMLElement>>('title');
  private readonly dateBox = viewChild<ElementRef<HTMLInputElement>>('dateBox');
  private readonly descriptionBox = viewChild<ElementRef<HTMLTextAreaElement>>('descriptionBox');
  private readonly promiseBox = viewChild<ElementRef<HTMLInputElement>>('promiseBox');
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.images().forEach((image) => URL.revokeObjectURL(image.url)));
  }

  /** The images it opens with: its inputs are set by now. */
  ngOnInit(): void {
    this.addImages(this.initialImages());
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
      this.goTo('review');
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
    this.goTo('review');
  }

  /**
   * To the other step. The button pressed goes with the step it was on: the focus goes to the
   * heading, which says which step this is, and the next Tab to its first field.
   */
  protected goTo(step: 'input' | 'review'): void {
    this.step.set(step);
    focusAfterRender(this.injector, this.title().nativeElement);
  }

  /** What is missing for "Guardar caso", whether or not it was pressed yet. */
  private missing(): { company?: true; description?: true; promisedDate?: true } {
    return {
      ...(this.companyId() === null ? { company: true } : {}),
      ...(!this.description().trim() ? { description: true } : {}),
      ...(this.promiseOn() && !this.promisedDate() ? { promisedDate: true } : {}),
    };
  }

  /** The focus goes to the first field that keeps the case from being saved, which says why (see focusProblem). */
  private focusFirstProblem(): void {
    const { date, company, description, promisedDate } = this.problems();
    if (date) focusProblem(this.injector, this.dateBox()?.nativeElement, date);
    else if (company) focusProblem(this.injector, () => this.host.querySelector('#ai-company'), company);
    else if (description) focusProblem(this.injector, this.descriptionBox()?.nativeElement, description);
    else if (promisedDate) focusProblem(this.injector, this.promiseBox()?.nativeElement, promisedDate);
  }

  /**
   * The button under the company select: adds the company the AI read to the catalog, as it read
   * it, and chooses it for the case. The same as typing that name in the select and taking its
   * "Crear empresa «X»".
   */
  protected async createReadCompany(name: string): Promise<void> {
    // The button is drawn under the select: it is there with it.
    const select = this.companySelect();
    if (!select || this.creatingCompany()) return;
    this.creatingCompany.set(true);
    try {
      this.companyId.set((await select.create(name)).id);
      // The button goes away with what it said, and the focus it had with it.
      select.focus();
    } catch {
      // Already said (see companyCreator). The button stays, to try again or to choose another company.
    } finally {
      this.creatingCompany.set(false);
    }
  }

  protected async save(): Promise<void> {
    const companyId = this.companyId();
    if (this.busy()) return;
    if (companyId === null || Object.keys(this.missing()).length || this.problems().date) {
      this.tried.set(true);
      this.focusFirstProblem();
      return;
    }
    const people = this.assigneeIds();
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
        assigneeIds: people.length ? people : undefined,
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
