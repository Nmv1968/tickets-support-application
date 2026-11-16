import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, afterNextRender, inject, input, signal, viewChild } from '@angular/core';
import { BACKDROP } from './backdrop-click';

/** The least room the text of a hint leaves to the edges of the screen, and the gap to its "?", in px. */
const SCREEN_MARGIN = 8;
const GAP = 4;

/**
 * A "?" beside a label or the header of a column, which shows what the label means:
 *
 *   <div class="label flex items-center gap-1">
 *     <label for="tp-date">Fecha del caso</label>
 *     <app-hint textId="tp-date-hint" about="Fecha del caso" text="Día en que el cliente reportó el problema" />
 *   </div>
 *
 * For a word of help that is written nowhere else on the screen. A `title` shows only under a
 * mouse that stays on it, out of reach of the keyboard and of a finger: it stays, if at all, as
 * a copy of this.
 *
 * A toggletip: a press on the "?" (a click, a tap, Enter or Space) shows the text under it, and the
 * next one hides it, as do Escape, a press anywhere else and the focus going elsewhere. Escape
 * with the text shown hides it and goes no further, where it would close the panel or the dialog
 * around the "?". The text is placed against the screen, not against what the "?" is in: it is
 * never cut by the box of a table or a panel that scrolls, it follows the "?" when that box
 * scrolls, and it stays inside the screen.
 *
 * A press on the text itself leaves it shown: the browser would take the focus off the "?" to
 * nowhere, and that hides it, so the press keeps the focus where it is (`mousedown` cancelled).
 * A press on the dimmed area behind a dialog or a panel (BACKDROP) only hides the text: the click
 * it ends with goes no further, or the dialog around the "?" would close with it, as it does with
 * the list of a select open (see SelectDefaults). The next press there closes the dialog.
 *
 * What goes between its tags is its text, for one that is more than a sentence (the legend of the
 * flags of a case, with their icons): `<app-hint textId="…" about="…">…</app-hint>`, without `text`.
 *
 * The text is in the page while hidden, with the id `textId`: it is the description of the "?",
 * read with it, and the field the label is for points at it too (`aria-describedby`), so a screen
 * reader says it where the field is. An element of the same id may not be anywhere else.
 *
 * 24 px a side, the least WCAG 2.5.8 asks, and not the 44 of a phone (.btn-icon): the line of a
 * label, or the header of the table, would be as high as a field. Its margins keep the line as
 * high as its text, as the "×" of a chip does.
 */
@Component({
  selector: 'app-hint',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'inline-flex shrink-0 -my-1 align-middle' },
  template: `
    <button
      #button
      type="button"
      class="grid size-6 place-items-center rounded-full"
      [attr.aria-label]="'Ayuda sobre ' + about()"
      [attr.aria-expanded]="open()"
      [attr.aria-describedby]="textId()"
      (click)="toggle()"
      (keydown.escape)="onEscape($event)"
      (blur)="close()"
    >
      <span class="grid size-4 place-items-center rounded-full border border-current text-[0.625rem] leading-none font-semibold" aria-hidden="true">?</span>
    </button>
    <span
      #bubble
      class="fixed z-30 w-max max-w-[min(18rem,calc(100vw-1rem))] rounded-control border border-control-line bg-surface px-3 py-2 text-left text-xs font-normal tracking-normal whitespace-normal text-ink normal-case shadow-[0_12px_28px_-12px_rgba(16,24,44,0.45)]"
      [id]="textId()"
      [hidden]="!open()"
      (mousedown)="$event.preventDefault()"
      ><ng-content>{{ text() }}</ng-content></span
    >
  `,
})
export class Hint {
  /** The id of the text, for the field it speaks of to point at. */
  readonly textId = input.required<string>();
  /** What it is about, as the label says it: the name of the "?" is "Ayuda sobre …". */
  readonly about = input.required<string>();
  /** What the label means: a sentence or two. Left out when the text goes between the tags. */
  readonly text = input('');

  protected readonly open = signal(false);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly button = viewChild.required<ElementRef<HTMLButtonElement>>('button');
  private readonly bubble = viewChild.required<ElementRef<HTMLElement>>('bubble');
  private readonly injector = inject(Injector);
  private readonly document = inject(DOCUMENT);

  /** Heard only while the text is shown: a press elsewhere hides it, and it follows its "?" wherever that goes. */
  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.target instanceof Node && this.host.contains(event.target)) return;
    if (event.target instanceof Element && event.target.matches(BACKDROP)) this.stopNextBackdropClick();
    this.close();
  };
  private readonly onMove = (): void => this.place();

  /**
   * Until the next click, or the next press, which comes before a click of its own: the click that
   * ends the press that hid the text stops on the way down, if it lands on a backdrop. Listened to
   * apart from the press that hides the text, whose listener goes with it. Added while that press
   * is heard, neither listener hears it.
   */
  private readonly onBackdropClick = (event: MouseEvent): void => {
    this.letBackdropClicks();
    if (event.target instanceof Element && event.target.matches(BACKDROP)) event.stopPropagation();
  };
  private readonly onNextPress = (): void => this.letBackdropClicks();

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.close();
      this.letBackdropClicks();
    });
  }

  protected toggle(): void {
    if (this.open()) {
      this.close();
      return;
    }
    this.open.set(true);
    this.document.addEventListener('pointerdown', this.onPointerDown, true);
    this.document.addEventListener('scroll', this.onMove, true);
    this.document.defaultView?.addEventListener('resize', this.onMove);
    afterNextRender(() => this.place(), { injector: this.injector });
  }

  protected close(): void {
    this.open.set(false);
    this.document.removeEventListener('pointerdown', this.onPointerDown, true);
    this.document.removeEventListener('scroll', this.onMove, true);
    this.document.defaultView?.removeEventListener('resize', this.onMove);
  }

  private stopNextBackdropClick(): void {
    this.document.addEventListener('click', this.onBackdropClick, true);
    this.document.addEventListener('pointerdown', this.onNextPress, true);
  }

  private letBackdropClicks(): void {
    this.document.removeEventListener('click', this.onBackdropClick, true);
    this.document.removeEventListener('pointerdown', this.onNextPress, true);
  }

  protected onEscape(event: Event): void {
    if (!this.open()) return;
    event.stopPropagation();
    event.preventDefault();
    this.close();
  }

  /** Under its "?", or over it when there is no room under it; never past an edge of the screen. */
  private place(): void {
    const bubble = this.bubble().nativeElement;
    if (bubble.hidden) return;
    const anchor = this.button().nativeElement.getBoundingClientRect();
    const { width, height } = bubble.getBoundingClientRect();
    const screen = this.document.documentElement;
    const left = Math.max(SCREEN_MARGIN, Math.min(anchor.left, screen.clientWidth - SCREEN_MARGIN - width));
    const below = anchor.bottom + GAP;
    const above = anchor.top - GAP - height;
    const top = below + height <= screen.clientHeight - SCREEN_MARGIN || above < SCREEN_MARGIN ? below : above;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }
}
