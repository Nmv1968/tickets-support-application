import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, Directive, ElementRef, Injectable, afterRenderEffect, computed, inject, input, signal, untracked } from '@angular/core';

/** How a message interrupts a screen reader: `polite` waits for what it is saying, `assertive` (an error) cuts in. */
export type Politeness = 'polite' | 'assertive';

/**
 * How long a message said for a moment stays in its region, in ms: long enough to be read out.
 * Then it goes, and nobody who reads the page later finds it at its end.
 */
export const SAID_MS = 7000;

/** The ids of the two regions (see Announcements): what a dialog that is lent one of them owns (see Announcer). */
export const REGION_IDS: Readonly<Record<Politeness, string>> = { polite: 'announcer-polite', assertive: 'announcer-assertive' };

/** A dialog that leaves everything outside it inert while it is open. */
const MODAL = '[aria-modal="true"]';

interface Said {
  id: number;
  text: string;
  politeness: Politeness;
}

/** The ids an element owns (`aria-owns`), in their order. */
function ownedBy(element: Element): string[] {
  return (element.getAttribute('aria-owns') ?? '').split(/\s+/).filter(Boolean);
}

/**
 * What the app says to who uses a screen reader without moving their focus, and without anything
 * on the screen: the message of a toast, the message of a field when its form was sent and the
 * focus was already on it. Two regions that are always on the page (see Announcements), one of
 * each politeness, which hold nothing but the messages: a region that also holds buttons reads
 * them out with each message ("Caso actualizado, Cerrar aviso").
 *
 * Each message is an element of its own, added to its region: the same message said twice is
 * read twice, and two said at once are both read, one after the other.
 *
 * The regions are on the page, outside every dialog. VoiceOver takes what is outside an open
 * modal dialog (`aria-modal`) for inert, and says nothing that comes into it: a toast said over the
 * case panel went unheard. So while a region holds a message and a modal dialog is open, the
 * topmost one owns it (`aria-owns`, besides what it owned before), as Angular CDK's LiveAnnouncer
 * does with its own region: for a screen reader the region is in the dialog. It is lent before the
 * message goes in, which the next screen update draws, and given back when its last message goes.
 */
@Injectable({ providedIn: 'root' })
export class Announcer {
  readonly said = signal<readonly Said[]>([]);
  private nextId = 1;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly document = inject(DOCUMENT);
  /** The dialog each region is lent to, while it holds a message and a dialog is open. */
  private readonly lentTo = new Map<Politeness, Element>();

  /**
   * Says `text`. It stays in its region for `ms` (null: until `unsay`), and the id it returns
   * takes it away before.
   */
  say(text: string, politeness: Politeness = 'polite', ms: number | null = SAID_MS): number {
    const id = this.nextId++;
    this.lend(politeness);
    this.said.update((said) => [...said, { id, text, politeness }]);
    if (ms !== null) this.timers.set(id, setTimeout(() => this.unsay(id), ms));
    return id;
  }

  /** Takes a message out of its region. A screen reader does not say what goes: only what comes. */
  unsay(id: number): void {
    clearTimeout(this.timers.get(id));
    this.timers.delete(id);
    const gone = this.said().find((item) => item.id === id);
    this.said.update((said) => said.filter((item) => item.id !== id));
    if (gone && !this.said().some((item) => item.politeness === gone.politeness)) this.giveBack(gone.politeness);
  }

  /**
   * The region of `politeness` goes to the topmost modal dialog on the page, if there is one: the
   * last one in it, drawn over the ones before (the question over the panel that asks it, the
   * image enlarged inside the panel). Taken from a dialog it was lent to before: a region has one
   * owner. Not lent while the region is not on the page: `aria-owns` would point at nothing.
   */
  private lend(politeness: Politeness): void {
    const id = REGION_IDS[politeness];
    const modals = this.document.querySelectorAll(MODAL);
    const top = this.document.getElementById(id) ? (modals[modals.length - 1] ?? null) : null;
    const lent = this.lentTo.get(politeness);
    if (lent && lent === top && ownedBy(top).includes(id)) return;
    if (lent) this.giveBack(politeness);
    if (!top) return;
    const owned = ownedBy(top);
    if (!owned.includes(id)) top.setAttribute('aria-owns', [...owned, id].join(' '));
    this.lentTo.set(politeness, top);
  }

  /**
   * The dialog the region was lent to owns again only what it owned before. One that closed took
   * the region's id away with it, and the region is on the page again.
   */
  private giveBack(politeness: Politeness): void {
    const dialog = this.lentTo.get(politeness);
    this.lentTo.delete(politeness);
    if (!dialog) return;
    const owned = ownedBy(dialog).filter((id) => id !== REGION_IDS[politeness]);
    if (owned.length) dialog.setAttribute('aria-owns', owned.join(' '));
    else dialog.removeAttribute('aria-owns');
  }
}

/**
 * The two regions of the Announcer, visually hidden. Once in the app, next to the toasts: on the
 * page from the start, so that what comes into them is a change a screen reader hears.
 * `aria-atomic` is left off: a new message is read alone, not with the ones still there.
 */
@Component({
  selector: 'app-announcements',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sr-only" aria-live="polite" data-politeness="polite" [id]="ids.polite">
      @for (item of polite(); track item.id) {
        <p>{{ item.text }}</p>
      }
    </div>
    <div class="sr-only" aria-live="assertive" data-politeness="assertive" [id]="ids.assertive">
      @for (item of assertive(); track item.id) {
        <p>{{ item.text }}</p>
      }
    </div>
  `,
})
export class Announcements {
  private readonly announcer = inject(Announcer);
  protected readonly ids = REGION_IDS;
  protected readonly polite = computed(() => this.announcer.said().filter((item) => item.politeness === 'polite'));
  protected readonly assertive = computed(() => this.announcer.said().filter((item) => item.politeness === 'assertive'));
}

/** The controls a message may hold, whose words are theirs and not the message's. */
const CONTROL = 'a, button, input, select, textarea, [role=button], [role=link]';

/**
 * The words of a message as a screen reader reads them: its text with single spaces, without what
 * is hidden from it (`aria-hidden`) and without its controls: "Ver la versión actual" is a button
 * next to the message, not part of it.
 */
export function spokenText(element: Element): string {
  const parts: string[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) parts.push(node.textContent ?? '');
    else if (node instanceof Element && node.getAttribute('aria-hidden') !== 'true' && !node.matches(CONTROL)) node.childNodes.forEach(walk);
  };
  element.childNodes.forEach(walk);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * A message that comes on screen with its words (inside an `@if`: an error, a notice, "Abriendo…"),
 * said by the Announcer as it comes: `<p class="alert-error" [appSay]="error()" sayAs="assertive">`.
 *
 * Instead of making the message a live region (`role="status"`, `role="alert"`): a region that
 * comes with its text may not be read (see Status), and one that holds a button reads it out with
 * every message. What is said is its words once drawn (see spokenText), without the buttons it may
 * hold, which stay outside any live region; its message leaves the regions when it leaves the screen.
 */
@Directive({ selector: '[appSay]' })
export class Say {
  /**
   * What the words follow, when they change while the element stays (the message of an error, the
   * result of a test): each new value says them again. Left out (`appSay` alone), they are said
   * once, as the element comes, whatever it shows later.
   */
  readonly appSay = input<unknown>();
  /** `assertive` for an error: it cuts in. */
  readonly sayAs = input<Politeness>('polite');

  constructor() {
    const announcer = inject(Announcer);
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    let said: number | null = null;
    const unsay = (): void => {
      if (said !== null) announcer.unsay(said);
      said = null;
    };
    // After the screen update that drew the element, or gave it its new words.
    afterRenderEffect(() => {
      this.appSay();
      const politeness = this.sayAs();
      untracked(() => {
        unsay();
        const words = spokenText(element);
        if (words) said = announcer.say(words, politeness);
      });
    });
    inject(DestroyRef).onDestroy(unsay);
  }
}
