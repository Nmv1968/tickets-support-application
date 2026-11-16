import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';

/** A colour as the app stores it: `#rrggbb`. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Relative luminance of a `#rrggbb` colour, from 0 (black) to 1 (white), as WCAG defines it. */
export function luminance(hex: string): number {
  const channel = (start: number): number => {
    const value = parseInt(hex.slice(start, start + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * The text colour to write with on a background of any colour: black or white, whichever
 * stands out more. Between those two the worse case still has a contrast of 4.5 to 1, which a
 * softer dark (the ink of the app) does not reach on the colours in the middle.
 * Null for something that is not a `#rrggbb` colour: the text keeps the colour it has.
 */
export function readableOn(background: string): '#000000' | '#ffffff' | null {
  if (!HEX_COLOR.test(background)) return null;
  // Contrast is (lighter + 0.05) / (darker + 0.05): black wins from the luminance where both are equal.
  return luminance(background) > Math.sqrt(1.05 * 0.05) - 0.05 ? '#000000' : '#ffffff';
}

/**
 * The edge of a chip of `color`: that colour mixed with the ink of the theme, more ink than colour.
 * Whatever the colour, the edge stands 3:1 or more from the surface of either theme, which is
 * the farthest colour from the ink there is. Undefined for something that is not a colour.
 */
export function edgeOf(color: string): string | undefined {
  return HEX_COLOR.test(color) ? `inset 0 0 0 1px color-mix(in srgb, ${color} 45%, var(--app-ink))` : undefined;
}

/**
 * A support type ("Tipo de soporte") as a chip in its own colour: `<app-type-chip [type]="type" />`.
 * The colour is whatever the team chose, so the text is black or white, whichever can be read on it.
 *
 * In a select of several types each chosen one is a chip with a "×":
 * `<app-type-chip [type]="item" removable (removed)="clear(item)" />` inside its `ng-label-tmp`.
 *
 * A name can be long, and the chip goes in narrow places (a column of the table, a card of the
 * board, a select). It is as wide as its name when there is room, and where there is less it
 * writes the whole name on more lines, its "×" beside them. It shortened the name with an
 * ellipsis before, and the rest was only in its `title`, which neither a keyboard nor a finger
 * shows: two types that start the same looked alike. The `title` stays, a copy for the pointer.
 * Its corners are those of a pill on one line, and rounder than the lines of a longer name.
 *
 * Its edge is a line in its own colour taken towards the colour of the text (see `edgeOf`): a chip
 * in the colour of the card it is on (white on white, black on the dark theme) keeps its shape.
 */
@Component({
  selector: 'app-type-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A grid whose one column may shrink to nothing (the "×" gets a column of its own beside it):
  // what the chip is in then never counts its name as a width it has to make room for.
  host: {
    class: 'badge inline-grid max-w-full grid-flow-col grid-cols-[minmax(0,1fr)] rounded-xl',
    '[style.background-color]': 'type().color',
    '[style.color]': 'ink()',
    '[style.box-shadow]': 'edge()',
    '[attr.title]': 'type().name',
  },
  template: `
    <span class="whitespace-normal">{{ type().name }}</span>
    @if (removable()) {
      <!--
        The press stays here: reaching the select the chip is in, it would open its list. Enter
        and Space too, which press the "×" as they press any button: the select would take them
        to open its list or to choose the option marked in it.
        At least 24 px a side (WCAG 2.5.8), more than the chip is high: the margins take back what
        it has beyond the line of the chip, which stays as high as one without a "×". Not the 44 px
        of a phone (.btn-icon): every chip of a select would be as high as a field, the "×" over
        the chips of the lines above and below.
      -->
      <button
        type="button"
        class="-my-1 -mr-2 grid min-h-6 min-w-6 place-items-center"
        [attr.aria-label]="'Quitar ' + type().name"
        (mousedown)="$event.stopPropagation()"
        (keydown.enter)="$event.stopPropagation()"
        (keydown.space)="$event.stopPropagation()"
        (click)="removed.emit()"
      >×</button>
    }
  `,
})
export class TypeChip {
  readonly type = input.required<{ name: string; color: string }>();
  /** Shows the "×" that asks to take the type off. */
  readonly removable = input(false, { transform: booleanAttribute });
  readonly removed = output<void>();

  protected readonly ink = computed(() => readableOn(this.type().color));
  protected readonly edge = computed(() => edgeOf(this.type().color));
}
