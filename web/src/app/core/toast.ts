import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injectable, Injector, afterNextRender, effect, inject, signal, viewChild } from '@angular/core';
import { Announcer } from './announcer';
import { Icon } from './icon';
import { errorMessage } from './ui';

interface ToastItem {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

/** How long a toast stays on screen, in ms, while nobody holds it. An error is read, and maybe acted on: it stays much longer. */
export const TOAST_MS = { ok: 3000, error: 20_000 } as const;

/** What keeps a toast on screen: the pointer on it, the focus in it. Each one counts apart. */
type Hold = 'pointer' | 'focus';

/** The clock of a toast: what is left of its time, and since when it runs (null while held). And the message the Announcer says for it. */
interface Clock {
  left: number;
  since: number | null;
  timer: ReturnType<typeof setTimeout> | undefined;
  holds: Set<Hold>;
  said: number;
}

/**
 * The messages of the app that come and go by themselves: what was done ("Caso actualizado"), what
 * failed. Read out to who uses a screen reader by the Announcer, politely, an error at once; the
 * toasts on screen (see Toasts) are not a live region.
 */
@Injectable({ providedIn: 'root' })
export class Toast {
  readonly items = signal<ToastItem[]>([]);
  private nextId = 1;
  private readonly clocks = new Map<number, Clock>();
  private readonly announcer = inject(Announcer);

  ok(text: string): void {
    this.push('ok', text);
  }

  /** Accepts a message or any thrown value (HTTP errors show the server's message). */
  error(error: unknown): void {
    this.push('error', typeof error === 'string' ? error : errorMessage(error));
  }

  dismiss(id: number): void {
    const clock = this.clocks.get(id);
    clearTimeout(clock?.timer);
    if (clock) this.announcer.unsay(clock.said);
    this.clocks.delete(id);
    this.items.update((items) => items.filter((item) => item.id !== id));
  }

  /**
   * The toast Escape takes away (see Toasts): the newest error, if there is one. Never a toast of
   * what was done, which goes by itself in a moment.
   */
  newestError(): number | undefined {
    return this.items()
      .filter((item) => item.kind === 'error')
      .at(-1)?.id;
  }

  /**
   * The pointer is on a toast, or the focus in it: it stays while it is read, its time stopped
   * (WCAG 2.2.1). `on` false lets it go; its time runs again once nothing holds it.
   */
  hold(id: number, by: Hold, on: boolean): void {
    const clock = this.clocks.get(id);
    if (!clock) return;
    if (on) {
      clock.holds.add(by);
      if (clock.since !== null) {
        clearTimeout(clock.timer);
        clock.left -= Date.now() - clock.since;
        clock.since = null;
      }
    } else {
      clock.holds.delete(by);
      if (!clock.holds.size && clock.since === null) this.run(id, clock);
    }
  }

  private push(kind: ToastItem['kind'], text: string): void {
    const id = this.nextId++;
    this.items.update((items) => [...items, { id, kind, text }]);
    // Said while it is on screen: an error at once, interrupting the screen reader; anything else when it is done.
    const said = this.announcer.say(text, kind === 'error' ? 'assertive' : 'polite', null);
    const clock: Clock = { left: TOAST_MS[kind], since: null, timer: undefined, holds: new Set(), said };
    this.clocks.set(id, clock);
    this.run(id, clock);
  }

  private run(id: number, clock: Clock): void {
    clock.since = Date.now();
    clock.timer = setTimeout(() => this.dismiss(id), Math.max(0, clock.left));
  }
}


/** Space left between a control that has the focus and the toasts above it, in px. */
const CLEARANCE = 8;

/** What scrolls an element into view, nearest first: the boxes around it that scroll, and the page. */
function scrollersOf(element: Element): Element[] {
  const found: Element[] = [];
  for (let around = element.parentElement; around; around = around.parentElement) {
    const { overflowY } = getComputedStyle(around);
    if (overflowY === 'auto' || overflowY === 'scroll') found.push(around);
  }
  const page = element.ownerDocument.scrollingElement;
  if (page && !found.includes(page)) found.push(page);
  return found;
}

/** Where what a scroller shows starts on the screen: below its border, and below what its `scroll-padding` keeps for a sticky header. */
function topOf(scroller: Element): number {
  const style = getComputedStyle(scroller);
  const padding = parseFloat(style.scrollPaddingTop) || 0;
  if (scroller === scroller.ownerDocument.scrollingElement) return padding;
  return scroller.getBoundingClientRect().top + (parseFloat(style.borderTopWidth) || 0) + padding;
}

/** Whether a press on `pressed` was a press on `control`: on it, on what it is in (a select, a button), or on its label. */
function pressedOn(control: HTMLElement, pressed: Element): boolean {
  const labels = Array.from((control as HTMLInputElement).labels ?? []);
  return (control.closest('ng-select') ?? control).contains(pressed) || pressed.contains(control) || labels.some((label) => label.contains(pressed));
}

/**
 * Whether `target` is an open disclosure or inside what it shows (`aria-controls`): the "?" of a
 * hint with its text shown, "Menú", "Columnas" or "Exportar" open, a choice of their list.
 */
function inOpenDisclosure(target: Element): boolean {
  const document = target.ownerDocument;
  return Array.from(document.querySelectorAll('[aria-expanded="true"]')).some(
    (toggle) =>
      toggle.contains(target) ||
      (toggle.getAttribute('aria-controls') ?? '')
        .split(/\s+/)
        .some((id) => !!id && !!document.getElementById(id)?.contains(target)),
  );
}

/** What the eye sees of a control: a box hidden in its label (a switch, a file field) is seen as the label. */
function seenBox(control: HTMLElement): DOMRect {
  const box = control.getBoundingClientRect();
  const label = (control as HTMLInputElement).labels?.[0];
  return (box.width <= 2 || box.height <= 2) && label ? label.getBoundingClientRect() : box;
}

@Component({
  selector: 'app-toasts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Above what is fixed to the bottom of the screen, which it would cover just when the person reaches for it: the tab bar of a
  // phone, the footer of the case panel or of a dialog, the pager of the list. On a short screen those scroll away, and the toasts
  // keep low, in a strip that scrolls if they need more than some third of the screen.
  // Never above the top of the screen either: many at once (a sheet imported elsewhere, a notice per case) went past it, out of
  // reach, over the button that closes the panel. They scroll in their strip, which shows the newest one (see the constructor).
  // A toast is its message and a "×" that closes it: the message alone, as a button, did not say that pressing it closed it.
  // Not a live region: read out as it was, each toast was its message and "Cerrar aviso". The Announcer says the message alone.
  template: `
    <div
      #region
      class="pointer-events-none fixed right-4 bottom-20 z-100 flex max-h-[calc(100dvh-6rem)] w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 overflow-y-auto short:right-2 short:bottom-2 short:max-h-[40dvh]"
    >
      @for (item of toast.items(); track item.id) {
        <div
          class="card pointer-events-auto flex items-start gap-2 py-2.5 pr-1.5 pl-3"
          [attr.data-toast]="item.id"
          [class.border-danger]="item.kind === 'error'"
          (mouseenter)="toast.hold(item.id, 'pointer', true)"
          (mouseleave)="toast.hold(item.id, 'pointer', false)"
          (focusin)="toast.hold(item.id, 'focus', true)"
          (focusout)="toast.hold(item.id, 'focus', false)"
        >
          <app-icon
            [name]="item.kind === 'ok' ? 'check-circle' : 'alert-circle'"
            class="text-lg leading-5"
            [class.text-success]="item.kind === 'ok'"
            [class.text-danger]="item.kind === 'error'"
          />
          <span class="flex-1">{{ item.text }}</span>
          <button type="button" class="btn-icon -my-1 grid size-7 shrink-0 place-items-center rounded-control text-muted hover:bg-elevated hover:text-ink" aria-label="Cerrar aviso" (click)="close(item.id)">
            <app-icon name="close" />
          </button>
        </div>
      }
    </div>
  `,
})
export class Toasts {
  protected readonly toast = inject(Toast);
  private readonly region = viewChild.required<ElementRef<HTMLElement>>('region');
  /** The boxes given more room at their end while there are toasts (see keepClear), with the padding and the height they had. */
  private readonly padded = new Map<HTMLElement, { padding: string; height: string }>();
  private readonly document = inject(DOCUMENT);
  /** What had the focus last outside the toasts: where it goes back from a "Cerrar aviso" whose toast goes (see close). */
  private before: HTMLElement | null = null;

  constructor() {
    // A toast that comes is the last one of the strip, which scrolls once they do not fit: it is
    // scrolled to its end, or the newest message would be under the older ones. Not when one goes:
    // the person may be reading another one up the strip.
    const injector = inject(Injector);
    let newest = 0;
    effect(() => {
      const last = this.toast.items().at(-1)?.id ?? 0;
      if (last <= newest) return;
      newest = last;
      afterNextRender(
        () => {
          const strip = this.region().nativeElement;
          strip.scrollTop = strip.scrollHeight;
        },
        { injector },
      );
    });
    // The room given for the toasts goes with the last of them.
    effect(() => {
      if (!this.toast.items().length) this.unpad();
    });

    const document = this.document;
    const view = document.defaultView;
    /**
     * What the pointer pressed last, until the focus comes or a key is pressed. A control the
     * person presses is in sight, where they pressed it: the toasts would have taken the press.
     */
    let pressed: Element | null = null;
    const onPointerDown = (event: PointerEvent): void => {
      pressed = event.target instanceof Element ? event.target : null;
    };
    /*
     * Escape takes the newest error away first, and stops there: an error stays 20 s and covers
     * what is under it, and its "Cerrar aviso" is out of reach from inside a dialog, whose focus
     * trap keeps the Tab key in it. The next Escape closes the dialog or the panel. Heard before
     * anything else (on the window, on the way down): the dialog, the panel and the question
     * listen for the same key. Not with a list of options open: that list is what the person is
     * in, and closes first (see SelectDefaults).
     *
     * Nor on an open disclosure, or inside what it shows (see inOpenDisclosure): the text of a "?",
     * "Menú", "Columnas" or "Exportar" close first, the innermost open thing, and take the key
     * (they stop it). The key comes back here on its way up, and takes the error if nothing
     * stopped it: what an open "Filtros" or "Nuevo caso" shows does not close with Escape. A key
     * that was only cancelled was not taken: ng-select cancels every Escape, with its list closed
     * too, and from a select in "Filtros" Escape did nothing at all.
     */
    const takeError = (event: KeyboardEvent): void => {
      const error = this.toast.newestError();
      if (error === undefined) return;
      this.close(error);
      event.stopPropagation();
      event.preventDefault();
    };
    /** The Escape left to an open disclosure, until it is back up here. */
    let left: KeyboardEvent | null = null;
    const onKeydown = (event: KeyboardEvent): void => {
      pressed = null;
      left = null;
      if (event.key !== 'Escape' || event.isComposing) return;
      if (event.target instanceof Element && event.target.closest('.ng-select-opened')) return;
      if (event.target instanceof Element && inOpenDisclosure(event.target)) {
        left = event;
        return;
      }
      takeError(event);
    };
    const onKeydownBack = (event: KeyboardEvent): void => {
      if (event !== left) return;
      left = null;
      takeError(event);
    };
    /*
     * A control that takes the focus is never left under the toasts (WCAG 2.4.11). Looked at once
     * the browser has brought it into view, which it does after the event, to the edge of what
     * shows it: where the toasts may be. Not the control the pointer has just pressed: scrolled
     * from under the pointer, the list of options a press opens closes (see SelectDefaults). The
     * focus a press sends elsewhere (to the field a form says is missing) is looked at.
     */
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      const press = pressed;
      pressed = null;
      if (!(target instanceof HTMLElement)) return;
      // With no toasts, nothing in them has the focus.
      if (this.toast.items().length && this.region().nativeElement.contains(target)) return;
      this.before = target;
      if (!this.toast.items().length) return;
      if (press && pressedOn(target, press)) return;
      view?.requestAnimationFrame(() => {
        // Nor a select whose list is open by then: the list hangs where the select was.
        if (document.activeElement === target && !target.closest('.ng-select-opened')) this.keepClear(target);
      });
    };
    view?.addEventListener('keydown', onKeydown, true);
    view?.addEventListener('keydown', onKeydownBack);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    inject(DestroyRef).onDestroy(() => {
      view?.removeEventListener('keydown', onKeydown, true);
      view?.removeEventListener('keydown', onKeydownBack);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('focusin', onFocusIn);
      this.unpad();
    });
  }

  /**
   * Takes a toast away, with its "Cerrar aviso" or with Escape. With the focus on that button, the
   * focus goes first to the "Cerrar aviso" of the next toast, or back to what had it before it came
   * into the toasts, or, when that is gone, into the dialog on top if one is open, else to the
   * content of the page (`#contenido`, see Shell):
   * taken off the screen with its toast, it went nowhere, and the next Tab started from the top.
   */
  protected close(id: number): void {
    const strip = this.region().nativeElement;
    if (strip.querySelector(`[data-toast="${id}"]`)?.contains(this.document.activeElement)) {
      const items = this.toast.items();
      const next = items[items.findIndex((item) => item.id === id) + 1];
      // With a dialog open, the content of the page is behind it: the focus stays in the dialog.
      const modal = Array.from(this.document.querySelectorAll<HTMLElement>('[aria-modal="true"]')).pop();
      const inModal = modal?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      const targets = [next && strip.querySelector(`[data-toast="${next.id}"] button`), this.before, ...(modal ? [inModal, modal] : [this.document.getElementById('contenido')])];
      for (const target of targets) {
        if (!(target instanceof HTMLElement) || !target.isConnected) continue;
        target.focus();
        if (this.document.activeElement === target) break;
      }
    }
    this.toast.dismiss(id);
  }

  /**
   * Scrolls `control` up until it ends above the toasts, if they cover any of it: what shows it
   * first, then what shows that, never taking it past the top of any of them. At the end of a list
   * there may be nothing left to scroll: the box that shows it gets that much more room at its end,
   * for as long as there are toasts, and scrolls into it.
   */
  private keepClear(control: HTMLElement): void {
    const column = this.region().nativeElement.getBoundingClientRect();
    if (!column.height) return;
    const limit = column.top - CLEARANCE;
    /** How far the control goes down into the toasts, or into the space above them. Nothing when it is beside or below them. */
    const covered = (): number => {
      const box = seenBox(control);
      return box.right > column.left && box.left < column.right && box.top < column.bottom ? box.bottom - limit : 0;
    };
    if (covered() <= 0) return;

    const scrollers = scrollersOf(control);
    for (const scroller of scrollers) {
      const over = covered();
      if (over <= 0) return;
      const by = Math.min(over, seenBox(control).top - topOf(scroller));
      if (by > 0) scroller.scrollBy({ top: by, behavior: 'instant' });
    }

    const over = covered();
    if (over <= 0) return;
    // The nearest of them where the control can end above the toasts.
    const height = seenBox(control).height;
    const room = scrollers.find((scroller) => topOf(scroller) + height <= limit);
    if (!room) return;
    // The page scrolls what its body holds.
    const body = room.ownerDocument.body;
    const box = room === room.ownerDocument.scrollingElement ? body : room;
    if (!(box instanceof HTMLElement)) return;
    if (!this.padded.has(box)) this.padded.set(box, { padding: box.style.paddingBottom, height: box.style.height });
    // The body is as high as the screen (styles.css). Where the page scrolls (a short screen), what
    // it holds goes on past its end, and room at that end was no room at the end of the page: the
    // pager of the list stayed under the toasts. It grows with what it holds, while it has the room.
    if (box === body && body.scrollHeight > body.clientHeight) body.style.height = 'auto';
    box.style.paddingBottom = `${(parseFloat(getComputedStyle(box).paddingBottom) || 0) + over}px`;
    room.scrollBy({ top: over, behavior: 'instant' });
  }

  private unpad(): void {
    for (const [box, { padding, height }] of this.padded) {
      box.style.paddingBottom = padding;
      box.style.height = height;
    }
    this.padded.clear();
  }
}
