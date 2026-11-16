import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, model, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { Icon } from '../../core/icon';
import { Toast } from '../../core/toast';
import { copyText } from '../../core/ui';

/**
 * The "Respuesta para el cliente" block of the case panel: the reply of the draft, the button that
 * asks the AI for it and the one that copies it. The panel keeps the reply in the draft and
 * asks the AI; copying is this block's own, since it needs nothing of the case.
 */
@Component({
  selector: 'app-ticket-reply',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section class="rounded-card border border-line p-3">
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <h2 class="section-title mr-auto">Respuesta para el cliente</h2>
        <!-- Not with unsaved changes: the AI writes from the stored case (see TicketPanel.generateReply). -->
        <button type="button" class="btn btn-soft px-2 py-1 text-xs" [disabled]="replying() || !aiReady() || unsaved()" [title]="help()" (click)="generate.emit()">
          <app-icon [name]="replying() ? 'loading' : 'creation-outline'" />
          {{ replying() ? 'Redactando…' : storedReply() ? 'Volver a generar' : 'Generar con IA' }}
        </button>
        <button type="button" class="btn btn-primary px-2 py-1 text-xs" [disabled]="!reply().trim()" (click)="copy()">
          <app-icon [name]="copied() ? 'check' : 'content-copy'" />
          {{ copied() ? 'Copiado' : 'Copiar' }}
        </button>
      </div>
      <textarea
        class="input min-h-28 resize-y"
        aria-label="Respuesta para el cliente"
        placeholder="Mensaje para quien pidió el soporte. Se redacta con IA al resolver el caso, o escríbelo aquí."
        maxlength="5000"
        [ngModel]="reply()"
        (ngModelChange)="reply.set($event)"
      ></textarea>
      <p class="mt-1 text-2xs text-muted">
        Revisa el mensaje antes de enviarlo. Puedes editarlo; se guarda con el caso al pulsar Actualizar.
        @if (unsaved() && aiReady()) {
          Para redactarlo con IA, actualiza o descarta antes los cambios: la IA lee el caso guardado.
        }
      </p>
    </section>
  `,
})
export class TicketReply {
  private readonly toast = inject(Toast);
  private readonly auth = inject(Auth);

  /** The reply of the draft, as it is in its box. */
  readonly reply = model.required<string>();
  /** The reply the case has stored, which the AI would replace. */
  readonly storedReply = input.required<string | null>();
  /** The AI is writing the reply of this case. */
  readonly replying = input.required<boolean>();
  /** An AI provider is active. */
  readonly aiReady = input.required<boolean>();
  /** The form holds something that is not saved: the AI, which reads the stored case, would leave it out. */
  readonly unsaved = input.required<boolean>();
  /** "Generar con IA" or "Volver a generar". */
  readonly generate = output<void>();

  protected readonly help = computed(() => {
    // Configuración > IA is a tab of administrators: an agent is told who turns the AI on.
    if (!this.aiReady()) return this.auth.isAdmin() ? 'Activa un proveedor en Configuración > IA' : 'Un administrador debe activar un proveedor en Configuración > IA';
    return this.unsaved() ? 'Actualiza o descarta los cambios primero: la IA redacta con el caso guardado' : 'Redacta el mensaje con el caso y sus observaciones';
  });
  protected readonly copied = signal(false);
  /** Takes the "Copiado" of the button away again. */
  private copiedTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this.copiedTimer));
  }

  protected async copy(): Promise<void> {
    if (await copyText(this.reply().trim())) {
      this.copied.set(true);
      // A second copy keeps the mark for its own two seconds.
      clearTimeout(this.copiedTimer);
      this.copiedTimer = setTimeout(() => this.copied.set(false), 2000);
    } else {
      this.toast.error('No se pudo copiar. Selecciona el texto y usa Ctrl+C.');
    }
  }
}
