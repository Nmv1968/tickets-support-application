import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';
import { Api } from '../../core/api';
import type { Attachment } from '../../core/api';
import { BackdropClick } from '../../core/backdrop-click';
import { Confirm } from '../../core/confirm';
import { Icon } from '../../core/icon';
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
  imports: [A11yModule, BackdropClick, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block', '(document:paste)': 'onPaste($event)' },
  template: `
    <section>
      <div class="mb-2 flex items-center gap-2">
        <h2 class="section-title">Adjuntos</h2>
        <label class="btn btn-soft ml-auto cursor-pointer px-2 py-1 text-xs">
          <app-icon name="paperclip" /> Adjuntar
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
                <span class="grid size-full place-items-center text-muted"><app-icon name="file-outline" class="text-2xl" /></span>
              }
            </button>
            <!--
              The name whole, on as many lines as it takes, with its size and its "×" under it: cut with an
              ellipsis in a third of a phone, three letters of it were left, and the rest was only in its title.
            -->
            <div class="px-1.5 py-1 text-2xs">
              <span class="block" [title]="a.filename">{{ a.filename }}</span>
              <div class="flex items-center gap-1">
                <span class="flex-1 text-muted">{{ formatBytes(a.size) }}</span>
                <!-- 24 px a side (WCAG 2.5.8), 44 on a phone (.btn-icon): the margins take back part of it from the line. -->
                <button type="button" class="btn-icon -m-1 grid size-6 shrink-0 place-items-center hover:text-danger" (click)="removeAttachment(a)" [attr.aria-label]="'Eliminar ' + a.filename">
                  <app-icon name="close" />
                </button>
              </div>
            </div>
          </div>
        }
      </div>
      <p class="mt-2 text-2xs text-muted">
        {{ uploading() ? 'Subiendo…' : 'Arrastra archivos aquí o pega una captura (Ctrl+V).' }}
      </p>
    </section>

    <!--
      A dialog over the panel, with the focus kept in it: before, Tab went on to the buttons hidden
      under it, which could be pressed unseen. "Cerrar", a press beside the image and Escape (which
      the panel hears, see closeLightbox) close it, and the focus goes back to the thumbnail.
    -->
    @if (lightbox(); as shown) {
      <div
        class="fixed inset-0 z-60 grid place-items-center bg-black/80 p-4"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="'Imagen: ' + shown.name"
        cdkTrapFocus
        [cdkTrapFocusAutoCapture]="true"
        (appBackdropClick)="closeLightbox()"
      >
        <img class="max-h-full max-w-full rounded-control" [src]="shown.url" [alt]="shown.name" />
        <button type="button" class="btn btn-soft absolute top-3 right-3" cdkFocusInitial (click)="closeLightbox()">
          <app-icon name="close" /> Cerrar
        </button>
      </div>
    }
  `,
})
export class TicketAttachments {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly destroyRef = inject(DestroyRef);

  readonly ticketId = input.required<number>();
  readonly attachments = input.required<Attachment[]>();

  protected readonly uploading = signal(false);
  /** The image enlarged: its address and the name of its file. */
  protected readonly lightbox = signal<{ url: string; name: string } | null>(null);
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
      this.lightbox.set({ url: thumb, name: attachment.filename });
      return;
    }
    try {
      downloadBlob(await this.api.attachmentBlob(attachment.id), attachment.filename);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async removeAttachment(attachment: Attachment): Promise<void> {
    if (!(await this.confirm.ask({ title: `¿Eliminar el adjunto "${attachment.filename}"?`, confirmLabel: 'Eliminar', danger: true }, this.destroyRef))) return;
    // The question was on screen for a while: the panel may have gone, or moved on to another case.
    if (this.destroyRef.destroyed || !this.attachments().some((other) => other.id === attachment.id)) return;
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
