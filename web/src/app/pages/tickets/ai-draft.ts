import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Priority, TicketDetail, TicketStatus } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs, assigneeInput } from '../../core/catalogs';
import { Toast } from '../../core/toast';
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
  imports: [FormsModule, A11yModule],
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
              <div>
                <label class="label" for="ai-date" title="Día en que el cliente reportó el problema">Fecha del caso</label>
                <input id="ai-date" class="input" type="date" [max]="today" [(ngModel)]="date" />
                <p class="mt-1 text-2xs text-muted">Día en que lo reportó el cliente. La fecha de registro será hoy, automática.</p>
              </div>
              <div>
                <label class="label" for="ai-status">Estado</label>
                <select id="ai-status" class="input" [(ngModel)]="status">
                  @for (s of statuses; track s) {
                    <option [value]="s">{{ statusLabel[s] }}</option>
                  }
                </select>
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-company">Empresa <span class="text-danger">*</span></label>
                <input id="ai-company" class="input" list="ai-company-options" [(ngModel)]="company" />
                <datalist id="ai-company-options">
                  @for (option of companyOptions(); track option) {
                    <option [value]="option"></option>
                  }
                </datalist>
              </div>
              <div class="col-span-2">
                <label class="label" for="ai-description">Descripción <span class="text-danger">*</span></label>
                <textarea id="ai-description" class="input min-h-20 resize-y" [(ngModel)]="description"></textarea>
              </div>
              <div>
                <label class="label" for="ai-assignee">Responsable</label>
                <select id="ai-assignee" class="input" [(ngModel)]="assignee">
                  <option value="">Sin asignar</option>
                  @for (user of catalogs.activeUsers(); track user.id) {
                    <option [value]="user.id">{{ user.name }}</option>
                  }
                  <option value="client">Cliente</option>
                </select>
              </div>
              <div>
                <label class="label" for="ai-priority">Prioridad</label>
                <select id="ai-priority" class="input" [(ngModel)]="priority">
                  <option value="">Sin prioridad</option>
                  @for (p of priorities; track p) {
                    <option [value]="p">{{ priorityLabel[p] }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="label" for="ai-module">Módulo</label>
                <select id="ai-module" class="input" [(ngModel)]="moduleId">
                  <option value="">Sin módulo</option>
                  @for (module of catalogs.modules(); track module.id) {
                    <option [value]="module.id">{{ module.fullName }}</option>
                  }
                </select>
              </div>
              <div>
                <label class="label" for="ai-estimated">Tiempo estimado (minutos)</label>
                <input id="ai-estimated" class="input" type="number" min="0" step="5" [(ngModel)]="estimated" />
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
                <textarea id="ai-note" class="input min-h-16 resize-y" [(ngModel)]="note"></textarea>
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
            <button type="button" class="btn btn-primary" [disabled]="busy() || !company().trim() || !description().trim() || (promiseOn() && !promisedDate())" (click)="save()">
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
  private readonly auth = inject(Auth);
  protected readonly catalogs = inject(Catalogs);

  /** Images already available when the dialog opens (a screenshot pasted on the list). */
  readonly initialImages = input<File[]>([]);
  readonly closed = output<void>();
  readonly created = output<TicketDetail>();

  protected readonly maxImages = MAX_IMAGES;
  protected readonly today = todayIso();
  /** Reading the clipboard from a button only exists on HTTPS or localhost. */
  protected readonly canReadClipboard = typeof navigator.clipboard?.read === 'function';
  protected readonly statuses = STATUSES;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly priorities = PRIORITIES;
  protected readonly priorityLabel = PRIORITY_LABEL;

  protected readonly step = signal<'input' | 'review'>('input');
  protected readonly images = signal<Picked[]>([]);
  protected readonly text = signal('');
  protected readonly dragging = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly usedAi = signal(false);
  protected readonly aiModel = signal('');
  protected readonly companyOptions = signal<string[]>([]);

  // Draft fields
  protected readonly date = signal(todayIso());
  protected readonly status = signal<TicketStatus>('PENDING');
  protected readonly company = signal('');
  protected readonly description = signal('');
  protected readonly assignee = signal(String(this.auth.user()?.id ?? ''));
  protected readonly priority = signal<Priority | ''>('');
  protected readonly moduleId = signal('');
  protected readonly estimated = signal<number | null>(null);
  protected readonly promiseOn = signal(false);
  protected readonly promisedDate = signal('');
  protected readonly note = signal('');

  constructor() {
    // Inputs are set before the first change detection; read them once the component exists.
    queueMicrotask(() => this.addImages(this.initialImages()));
    this.api
      .companies('')
      .then((companies) => this.companyOptions.set(companies))
      .catch(() => undefined);
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
      this.company.set(draft.company ?? '');
      this.description.set(draft.description);
      this.priority.set(draft.priority ?? '');
      this.moduleId.set(draft.moduleId ? String(draft.moduleId) : '');
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

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const estimated = Number(this.estimated());
      let ticket = await this.api.createTicket({
        date: this.date() || todayIso(),
        status: this.status(),
        company: this.company().trim(),
        description: this.description().trim(),
        ...assigneeInput(this.assignee()),
        priority: this.priority() || null,
        moduleId: this.moduleId() ? Number(this.moduleId()) : null,
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
