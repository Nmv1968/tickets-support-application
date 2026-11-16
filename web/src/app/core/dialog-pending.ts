import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, booleanAttribute, input, output } from '@angular/core';
import { Say } from './announcer';
import { BackdropClick } from './backdrop-click';
import { Icon } from './icon';

/**
 * What a dialog loaded apart from its page (`@defer`) shows in its place while its code is late,
 * and when its code could not be loaded (offline, or the app was updated and the old code is
 * gone). Without it, a press on the button that opens the dialog would seem to do nothing.
 *
 * Closed like the dialog itself: Escape, a press outside, or "Cerrar" once it failed.
 */
@Component({
  selector: 'app-dialog-pending',
  imports: [A11yModule, BackdropClick, Icon, Say],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop" (appBackdropClick)="closed.emit()">
      @if (failed()) {
        <div
          class="card w-full max-w-md p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="dialog-pending-title"
          aria-describedby="dialog-pending-message"
          cdkTrapFocus
          [cdkTrapFocusAutoCapture]="true"
        >
          <h2 id="dialog-pending-title" class="font-semibold">No se pudo abrir</h2>
          <p id="dialog-pending-message" class="mt-1 text-muted">Revisa la conexión y vuelve a cargar la página.</p>
          <div class="mt-4 flex justify-end">
            <button type="button" class="btn btn-primary" cdkFocusInitial (click)="closed.emit()">Cerrar</button>
          </div>
        </div>
      } @else {
        <!-- Said as it comes (see Say): a status that comes with its words may not be read. -->
        <div class="card flex items-center gap-2 p-4" appSay>
          <app-icon name="loading" />
          Abriendo…
        </div>
      }
    </div>
  `,
})
export class DialogPending {
  /** Its code could not be loaded: says so, instead of "Abriendo…". */
  readonly failed = input(false, { transform: booleanAttribute });
  readonly closed = output<void>();
}
