import { Directive, output } from '@angular/core';

/**
 * The dimmed area behind a dialog or a side panel, which closes it when clicked. Known by its
 * class (see styles.css): what puts something small away with a press (the list of a select, the
 * text of a "?") stops the click that follows when it lands here, or the dialog would close too.
 */
export const BACKDROP = '.modal-backdrop, .panel-backdrop';

/**
 * A click on the dimmed area behind a dialog itself, not on the dialog it holds:
 * `<div class="modal-backdrop" (appBackdropClick)="closed.emit()">`.
 *
 * Told apart here, and not in an inline `$event.target === $event.currentTarget && …` of each
 * dialog: such an expression is false for every click inside the dialog, and a handler that
 * evaluates to false makes Angular cancel the click, which stops file inputs and checkboxes
 * from working.
 */
@Directive({
  selector: '[appBackdropClick]',
  host: { '(click)': 'onClick($event)' },
})
export class BackdropClick {
  readonly appBackdropClick = output<MouseEvent>();

  protected onClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.appBackdropClick.emit(event);
  }
}
