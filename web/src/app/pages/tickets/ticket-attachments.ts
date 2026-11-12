import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Api } from '../../core/api';
import type { Attachment } from '../../core/api';
import { Toast } from '../../core/toast';
import { downloadBlob, formatBytes, pastedImages } from '../../core/ui';

/**
 * The "Adjuntos" block of the case panel: the files of one case with a thumbnail for each
 * image, upload (by button, by pasting a screenshot, or files the panel hands over when they
 * are dropped on it), the enlarged view and delete.
 * It only writes through Api; the new list of files comes back through `attachments`.
 */
@Component({
  selector: 'app-ticket-attachments',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(document:paste)': 'onPaste($event)' },
  template: `
    <section>
      <div class="mb-2 flex items-center gap-2">
        <h2 class="section-title">Adjuntos</h2>
        <label class="btn btn-soft ml-auto cursor-pointer px-2 py-1 text-xs">
          <i class="mdi mdi-paperclip" aria-hidden="true"></i> Adjuntar
          <input type="file" class="sr-only" multiple (change)="onFiles($event)" />
        </label>
      </div>
      <div class="grid grid-cols-3 gap-2">
        @for (a of attachments(); track a.id) {
          <div class="group relative overflow-hidden rounded-control border border-line">
            <button type="button" class="block aspect-video w-full bg-elevated" (click)="openAttachment(a)" [title]="a.filename">
              @if (thumbs()[a.id]; as url) {
                <img class="size-full object-cover" [src]="url" [alt]="a.filename" />
              } @else {
                <span class="grid size-full place-items-center text-muted"><i class="mdi mdi-file-outline text-2xl" aria-hidden="true"></i></span>
              }
            </button>
            <div class="flex items-center gap-1 px-1.5 py-1 text-2xs">
              <span class="flex-1 truncate" [title]="a.filename">{{ a.filename }}</span>
              <span class="text-muted">{{ formatBytes(a.size) }}</span>
              <button type="button" class="hover:text-danger" (click)="removeAttachment(a)" [attr.aria-label]="'Eliminar ' + a.filename">
                <i class="mdi mdi-close" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        }
      </div>
      <p class="mt-2 text-2xs text-muted">
        {{ uploading() ? 'Subiendo…' : 'Arrastra archivos aquí o pega una captura (Ctrl+V).' }}
      </p>
    </section>

    @if (lightbox(); as url) {
      <button type="button" class="fixed inset-0 z-60 grid place-items-center bg-black/80 p-4" (click)="lightbox.set(null)" aria-label="Cerrar imagen">
        <img class="max-h-full max-w-full rounded-control" [src]="url" alt="Adjunto ampliado" />
      </button>
    }
  `,
})
export class TicketAttachments {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly destroyRef = inject(DestroyRef);

  readonly ticketId = input.required<number>();
  readonly attachments = input.required<Attachment[]>();

  protected readonly uploading = signal(false);
  protected readonly lightbox = signal<string | null>(null);
  /** Object URLs of image attachments, by attachment id. */
  protected readonly thumbs = signal<Record<number, string>>({});
  /**
   * Images already asked for. The list arrives again after every save of the case, and an
   * image still on its way must not be downloaded twice: the second URL would replace the
   * first one, which nobody would release.
   */
  private readonly requested = new Set<number>();

  protected readonly formatBytes = formatBytes;

  constructor() {
    effect(() => {
      const attachments = this.attachments();
      untracked(() => this.loadThumbs(attachments));
    });

    this.destroyRef.onDestroy(() => Object.values(this.thumbs()).forEach((url) => URL.revokeObjectURL(url)));
  }

  private loadThumbs(attachments: Attachment[]): void {
    for (const attachment of attachments) {
      if (!attachment.mime.startsWith('image/') || this.requested.has(attachment.id)) continue;
      this.requested.add(attachment.id);
      this.api
        .attachmentBlob(attachment.id)
        .then((blob) => {
          // The panel closed while the image was on its way: its URL would never be released.
          if (this.destroyRef.destroyed) return;
          this.thumbs.update((thumbs) => ({ ...thumbs, [attachment.id]: URL.createObjectURL(blob) }));
        })
        .catch(() => {
          // Asked for again the next time the list arrives.
          this.requested.delete(attachment.id);
        });
    }
  }

  protected onFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    void this.upload(Array.from(input.files ?? []));
    input.value = '';
  }

  protected onPaste(event: ClipboardEvent): void {
    const images = pastedImages(event);
    if (!images.length) return;
    event.preventDefault();
    void this.upload(images);
  }

  /** Also called by the panel, which takes files dropped anywhere on it. */
  async upload(files: File[]): Promise<void> {
    if (!files.length) return;
    this.uploading.set(true);
    try {
      await this.api.uploadAttachments(this.ticketId(), files);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.uploading.set(false);
    }
  }

  protected async openAttachment(attachment: Attachment): Promise<void> {
    const thumb = this.thumbs()[attachment.id];
    if (thumb) {
      this.lightbox.set(thumb);
      return;
    }
    try {
      downloadBlob(await this.api.attachmentBlob(attachment.id), attachment.filename);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async removeAttachment(attachment: Attachment): Promise<void> {
    if (!confirm(`¿Eliminar el adjunto "${attachment.filename}"?`)) return;
    try {
      await this.api.deleteAttachment(this.ticketId(), attachment.id);
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** For the panel's Escape key, which closes an enlarged image before the panel. Tells whether one was open. */
  closeLightbox(): boolean {
    const open = this.lightbox() !== null;
    this.lightbox.set(null);
    return open;
  }
}
