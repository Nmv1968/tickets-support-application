import { Directive, ElementRef, effect, inject, input } from '@angular/core';

/**
 * Shows a stored text in a field where the person also types. It takes the place of `[value]`,
 * which writes every change of the stored text over whatever the field holds: text typed while
 * a save was on its way, or kept in the field because its save failed, was gone the next time
 * the stored text changed.
 *
 * The field follows the stored text only while the person has nothing of their own in it. Their
 * own is whatever the field holds that is not the stored text, as it was until now or as it is
 * now, and whatever it holds while a save of it is unanswered (`saving`). Text of their own
 * stays until it is the stored text, or until the stored text is put over it with `show`.
 */
@Directive({
  selector: 'input[appStoredValue], textarea[appStoredValue]',
  exportAs: 'storedValue',
  host: { '(focus)': 'focused = true', '(input)': 'focused = true', '(blur)': 'focused = false' },
})
export class StoredValue {
  private readonly control = inject<ElementRef<HTMLInputElement | HTMLTextAreaElement>>(ElementRef).nativeElement;

  /** The text as it is stored. */
  readonly stored = input.required<string>({ alias: 'appStoredValue' });
  /**
   * A save of what the field holds is unanswered. That text is the person's own even when it is
   * the stored text: they may have put the old text back while another one was being stored,
   * and the answer to that earlier save must not bring the other text into the field.
   */
  readonly saving = input(false);

  /**
   * Whether the person is in the field: from the moment it takes the focus, or is typed in
   * (which says the same where no focus event was seen), until it is left.
   */
  focused = false;
  /** The stored text as the field last knew it. Null until it is given the first one. */
  private last: string | null = null;

  constructor() {
    effect(() => {
      const stored = this.asHeld(this.stored());
      const saving = this.saving();
      if (this.last === null || (!saving && this.control.value === this.last)) this.write(stored);
      // Also when the field kept the person's text: should they type the old stored text back,
      // that is their own too.
      this.last = stored;
    });
  }

  /**
   * `text` as this field gives it back once written: a textarea turns every line end into "\n"
   * and an input drops them. Compared as stored, a text with Windows line ends (from an import
   * or an assistant) would never equal what the field holds, and the field would stop following.
   */
  private asHeld(text: string): string {
    return this.control instanceof HTMLTextAreaElement ? text.replace(/\r\n?/g, '\n') : text.replace(/[\r\n]/g, '');
  }

  /** What the field holds. */
  get value(): string {
    return this.control.value;
  }

  /**
   * Puts `text`, the stored text of this moment, in the field over whatever it holds: the
   * person gave their own text up, or it was stored and is shown as the server keeps it.
   */
  show(text: string): void {
    this.last = this.asHeld(text);
    this.write(this.last);
  }

  private write(text: string): void {
    // Not when it is already there: a field is not to be written for nothing while the person
    // may be in it (the cursor, or the part of a date being typed).
    if (this.control.value !== text) this.control.value = text;
  }
}
