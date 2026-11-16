import { DestroyRef, Directive, ElementRef, booleanAttribute, inject, input, output } from '@angular/core';

/**
 * A button that cannot be used right now and keeps the focus: `<button [appSoftDisabled]="busy()">`.
 * It is `aria-disabled` and looks like a disabled one (see `.btn` in styles.css), stays in the
 * order of the Tab key, and a press on it, with the pointer, Enter or Space, does nothing: not its
 * `(click)`, and not the submit of its form either (also the one Enter in a field of the form makes).
 *
 * For the buttons that disable themselves while they hold the focus: the one pressed to save,
 * which waits for the answer, or one whose press makes it useless ("Restablecer"). With
 * `disabled` the browser takes the focus away to nowhere, and the person is back at the top of the
 * page or of the dialog without a word. A button that says why it cannot be used (with
 * aria-describedby) is one too: a disabled one cannot be reached to read it.
 *
 * A press that does nothing is told (`refused`), for a button that says why when it is pressed:
 * `<button [appSoftDisabled]="inUse()" (refused)="sayWhy()">`. Its description reaches only who
 * hears it, and its title only a mouse that stays on it.
 */
@Directive({
  selector: 'button[appSoftDisabled]',
  host: { '[attr.aria-disabled]': 'appSoftDisabled() ? "true" : null' },
})
export class SoftDisabled {
  readonly appSoftDisabled = input(false, { transform: booleanAttribute });
  /** A press it did nothing with: the pointer, Enter or Space. */
  readonly refused = output<void>();

  constructor() {
    const button = inject<ElementRef<HTMLButtonElement>>(ElementRef).nativeElement;
    // Before the handlers of the button itself, which listen on the way up: a listener on the way
    // down is called first on the element too, and the press goes no further.
    const swallow = (event: Event): void => {
      if (!this.appSoftDisabled()) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.refused.emit();
    };
    button.addEventListener('click', swallow, { capture: true });
    inject(DestroyRef).onDestroy(() => button.removeEventListener('click', swallow, { capture: true }));
  }
}
