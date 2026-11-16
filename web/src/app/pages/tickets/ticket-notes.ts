import { ChangeDetectionStrategy, Component, ElementRef, Injector, effect, inject, input, model, output, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { TicketNote } from '../../core/api';
import { focusAfterRender } from '../../core/focus';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { formatDateTime } from '../../core/ui';

/**
 * The "Observaciones" block of the case panel: the box for a new observation and the ones the
 * case has. The panel keeps what is typed in the box (it is saved with "Actualizar" too) and
 * does what the buttons ask.
 */
@Component({
  selector: 'app-ticket-notes',
  imports: [FormsModule, Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section>
      <h2 class="section-title mb-2">Observaciones</h2>
      <div class="flex gap-2">
        <textarea
          class="input min-h-10 resize-y"
          rows="2"
          placeholder="Nueva observación (Ctrl+Enter para guardar)"
          aria-label="Nueva observación"
          maxlength="5000"
          [(ngModel)]="text"
          (keydown.control.enter)="add.emit()"
        ></textarea>
        <!-- Keeps the focus once the observation is added and the box is empty again. -->
        <button type="button" class="btn btn-primary self-start" [appSoftDisabled]="!text().trim()" (click)="add.emit()">Agregar</button>
      </div>
      <ul class="mt-3 space-y-2">
        @for (note of notes(); track note.id; let index = $index) {
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
                class="btn-icon -my-1.5 -mr-1.5 ml-auto grid place-items-center p-1.5 can-hover:opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
                data-note-trash
                (click)="askRemove(note.id, index)"
                aria-label="Eliminar observación"
              >
                <app-icon name="trash-can-outline" />
              </button>
            </div>
            <p class="mt-0.5 whitespace-pre-line">{{ note.text }}</p>
          </li>
        } @empty {
          <li class="text-xs text-muted">Sin observaciones.</li>
        }
      </ul>
    </section>
  `,
})
export class TicketNotes {
  readonly notes = input.required<TicketNote[]>();
  /** "Nueva observación": what is typed in the box. */
  readonly text = model.required<string>();
  /** "Agregar", or Ctrl+Enter in the box. Also with nothing typed: the panel tells. */
  readonly add = output<void>();
  /** The trash of an observation, with its id. The panel asks before deleting it. */
  readonly remove = output<number>();

  protected readonly formatDateTime = formatDateTime;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);
  /** The observation whose trash was pressed, and its place in the list: the focus goes on from there once it is gone. */
  private removing: { id: number; index: number } | null = null;

  constructor() {
    // The trash goes with its observation, once the panel deleted it: the focus goes to the trash of
    // the one that took its place, or of the one before, or else to the box of a new one.
    effect(() => {
      const notes = this.notes();
      untracked(() => {
        const removing = this.removing;
        if (!removing || notes.some((note) => note.id === removing.id)) return;
        this.removing = null;
        const trash = (index: number) => () => this.host.querySelectorAll('[data-note-trash]')[index];
        focusAfterRender(this.injector, trash(removing.index), trash(removing.index - 1), () => this.host.querySelector('textarea'));
      });
    });
  }

  protected askRemove(id: number, index: number): void {
    this.removing = { id, index };
    this.remove.emit(id);
  }
}
