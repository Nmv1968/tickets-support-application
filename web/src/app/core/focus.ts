import { afterNextRender } from '@angular/core';
import type { Injector } from '@angular/core';
import { Announcer } from './announcer';

/** Where the focus may go: an element, or how to find it once the screen is drawn again. */
export type FocusTarget = HTMLElement | null | undefined | (() => Element | null | undefined);

/** The focus is nowhere: on the page itself, as when the element that had it left the screen. */
export function focusLost(): boolean {
  const active = document.activeElement;
  return !active || active === document.body;
}

/**
 * Once the screen is drawn again, gives the focus to the first of `targets` that is on it, if the
 * focus was lost by then. For a control that takes itself off the screen, or is swapped by another
 * one, while it has the focus ("Descartar cambios", "Iniciar cronómetro", the step of a dialog):
 * the browser puts the focus nowhere, and the next Tab starts again from the top of the page or of
 * the dialog. Nothing is done when the focus is somewhere: the person, or the screen, put it there.
 *
 * A target that cannot take the focus is passed over: a heading needs `tabindex="-1"`.
 */
export function focusAfterRender(injector: Injector, ...targets: FocusTarget[]): void {
  afterNextRender(
    () => {
      if (!focusLost()) return;
      for (const target of targets) {
        const element = typeof target === 'function' ? target() : target;
        if (!(element instanceof HTMLElement) || !element.isConnected) continue;
        element.focus();
        if (document.activeElement === element) return;
      }
    },
    { injector },
  );
}

/**
 * After a form was sent with a field missing or wrong (the forms that mark them only once they are
 * sent: the login, "Nuevo caso", the case of the AI, the new user). Once the screen is drawn again,
 * with the message under the field and tied to it (`aria-describedby`), the focus goes to the
 * field, and a screen reader reads its message with it. Given before, the focus landed on a field
 * that had no message yet, and the message could go unsaid.
 *
 * A field that already has the focus says nothing when it gets it again: `message` is then said
 * politely through the Announcer, as when the focus cannot go to it.
 */
export function focusProblem(injector: Injector, field: FocusTarget, message: string): void {
  const announcer = injector.get(Announcer);
  afterNextRender(
    () => {
      const element = typeof field === 'function' ? field() : field;
      if (element instanceof HTMLElement && element.isConnected && document.activeElement !== element) {
        element.focus();
        if (document.activeElement === element) return;
      }
      announcer.say(message);
    },
    { injector },
  );
}
