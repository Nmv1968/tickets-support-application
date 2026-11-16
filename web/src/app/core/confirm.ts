import { A11yModule } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { BackdropClick } from './backdrop-click';

export interface ConfirmQuestion {
  /** What is asked, in a few words: "¿Eliminar el caso SOP-00012?". */
  title: string;
  /** What saying yes brings, when the title does not say it all. */
  message?: string;
  /** The button that says yes, named after what it does: "Eliminar", "Descartar y salir". */
  confirmLabel: string;
  /** The button that says no. "Cancelar" unless another wording reads better next to `confirmLabel`. */
  cancelLabel?: string;
  /** The yes cannot be undone: its button is drawn as a danger and the focus starts on the no. */
  danger?: boolean;
}

/** A question that was asked. The number tells it apart from another one with the same words. */
interface Asked extends ConfirmQuestion {
  readonly id: number;
}

interface Pending extends Asked {
  /** Whoever asked, when they said so (see `ask`). */
  asker: DestroyRef | undefined;
  answer: (confirmed: boolean) => void;
}

/** Two questions read the same on screen: nothing tells the person one from the other. */
function sameWords(a: ConfirmQuestion, b: ConfirmQuestion): boolean {
  return a.title === b.title && a.message === b.message && a.confirmLabel === b.confirmLabel && a.cancelLabel === b.cancelLabel && !!a.danger === !!b.danger;
}

/**
 * Asks the person to confirm something before it is done, in a dialog of the app:
 * `if (await confirm.ask({ title: '¿Eliminar…?', confirmLabel: 'Eliminar', danger: true })) …`.
 * The dialog itself is `<app-confirm />`, which the shell has once for every screen.
 */
@Injectable({ providedIn: 'root' })
export class Confirm {
  /** Asked and not answered yet, oldest first. A second question waits for the first one. */
  private readonly pending = signal<Pending[]>([]);
  private nextId = 1;

  /** The question on screen. */
  readonly current = computed<Asked | null>(() => this.pending()[0] ?? null);

  /**
   * Resolves to true when the person confirms, to false when they cancel, close or press Escape.
   *
   * `asker`: whoever asks, when it can go away with its question unanswered (the case panel,
   * which closes by itself when its case is deleted somewhere else). The question goes with it,
   * answered as a no: left on screen, it would ask about something that is no longer there.
   *
   * Asked again by the same asker while it is unanswered, a question is not asked twice: that
   * is the button that asks pressed a second time before the dialog was drawn over it. The
   * second press gets a no at once, so that what is confirmed is done once.
   */
  ask(question: ConfirmQuestion, asker?: DestroyRef): Promise<boolean> {
    if (asker?.destroyed) return Promise.resolve(false);
    if (this.pending().some((asked) => asked.asker === asker && sameWords(asked, question))) return Promise.resolve(false);
    return new Promise((resolve) => {
      const id = this.nextId++;
      const unwatch = asker?.onDestroy(() => this.settle(id, false));
      const answer = (confirmed: boolean): void => {
        unwatch?.();
        resolve(confirmed);
      };
      this.pending.update((pending) => [...pending, { ...question, id, asker, answer }]);
    });
  }

  /** Answers the question on screen. Called by the dialog; a spec without the dialog can call it too. */
  answer(confirmed: boolean): void {
    const [question] = this.pending();
    if (question) this.settle(question.id, confirmed);
  }

  /** Takes a question out, the one on screen or one that waits, and gives its answer to whoever asked. */
  private settle(id: number, confirmed: boolean): void {
    const question = this.pending().find((item) => item.id === id);
    if (!question) return;
    this.pending.update((pending) => pending.filter((item) => item.id !== id));
    question.answer(confirmed);
  }

  /** The dialog is going away (the session ended): nothing left unanswered is confirmed. */
  cancelAll(): void {
    while (this.pending().length) this.answer(false);
  }
}

@Component({
  selector: 'app-confirm',
  imports: [A11yModule, BackdropClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A list of one: a question that was waiting gets a dialog of its own, with the focus where it starts. -->
    @for (question of shown(); track question.id) {
      <div class="modal-backdrop" (appBackdropClick)="answer($event, false)">
        <!-- alertdialog: it interrupts to ask, and is read out with its message. -->
        <div
          class="card w-full max-w-md p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          [attr.aria-describedby]="question.message ? 'confirm-message' : null"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
        >
          <h2 id="confirm-title" class="font-semibold">{{ question.title }}</h2>
          @if (question.message) {
            <p id="confirm-message" class="mt-1 whitespace-pre-line text-muted">{{ question.message }}</p>
          }
          <div class="mt-4 flex flex-wrap justify-end gap-2">
            <!-- The focus starts on the button that is safe to press with Enter. -->
            @if (question.danger) {
              <button type="button" class="btn btn-ghost" cdkFocusInitial (click)="answer($event, false)">{{ question.cancelLabel ?? 'Cancelar' }}</button>
              <button type="button" class="btn btn-danger" (click)="answer($event, true)">{{ question.confirmLabel }}</button>
            } @else {
              <button type="button" class="btn btn-ghost" (click)="answer($event, false)">{{ question.cancelLabel ?? 'Cancelar' }}</button>
              <button type="button" class="btn btn-primary" cdkFocusInitial (click)="answer($event, true)">{{ question.confirmLabel }}</button>
            }
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(Confirm);
  protected readonly shown = computed(() => {
    const question = this.confirm.current();
    return question ? [question] : [];
  });

  constructor() {
    const document = inject(DOCUMENT);
    // Escape cancels the question and stops there. Heard on the way down (capture): the panel
    // or the dialog under this one listens for the same key on the document, and would close
    // as well with a question that was only about, say, leaving it.
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.confirm.current()) return;
      event.stopPropagation();
      this.confirm.answer(false);
    };
    document.addEventListener('keydown', onKeydown, true);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('keydown', onKeydown, true);
      this.confirm.cancelAll();
    });
  }

  /**
   * A click on the dialog answers the question. Not the second click of a double click: its
   * first one was made before this question was on screen, on the button that asked, and the
   * second lands on whatever the dialog has there, the backdrop or one of its buttons. A click
   * of its own counts one (`detail`), and a key pressed on a button counts none.
   */
  protected answer(event: MouseEvent, confirmed: boolean): void {
    if (event.detail > 1) return;
    this.confirm.answer(confirmed);
  }
}
