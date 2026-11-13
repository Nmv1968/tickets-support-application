import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
 * A support type ("Tipo de soporte") as a chip in its own colour: `<app-type-chip [type]="type" />`.
 * The colour is whatever the team chose, so the text is black or white, whichever can be read on it.
 *
 * In a select of several types each chosen one is a chip with a "×":
 * `<app-type-chip [type]="item" removable (removed)="clear(item)" />` inside its `ng-label-tmp`.
 *
 * A name can be long, and the chip goes in narrow places (a column of the table, a card of the
 * board, a select). It is as wide as its name when there is room, and where there is less it
 * shortens the name with an ellipsis and keeps its "×": the whole name is its `title`.
 */
@Component({
  selector: 'app-type-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  // A grid whose one column may shrink to nothing (the "×" gets a column of its own beside it):
  // what the chip is in then never counts its name as a width it has to make room for.
  host: {
    class: 'badge inline-grid max-w-full grid-flow-col grid-cols-[minmax(0,1fr)]',
    '[style.background-color]': 'type().color',
    '[style.color]': 'ink()',
    '[attr.title]': 'type().name',
  },
  template: `
    <span class="truncate">{{ type().name }}</span>
    @if (removable()) {
      <!--
        The press stays here: reaching the select the chip is in, it would open its list. Enter
        and Space too, which press the "×" as they press any button: the select would take them
        to open its list or to choose the option marked in it.
        The padding, taken back by the margins, gives a finger more than the "×" to hit.
      -->
      <button
        type="button"
        class="-my-0.5 -mr-2 px-1.5 py-0.5"
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
}
