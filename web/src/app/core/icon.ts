import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, type IconName } from './icons';

/**
 * An icon of Material Design Icons, drawn as inline SVG:
 * `<app-icon name="plus" class="text-base" />`. It is 1em square, in the colour of the text, so the
 * classes that size and colour it go on the element, as on the text around it.
 *
 * Decorative, hidden from screen readers, unless it is given a `label`: then it is an image with
 * that name, for an icon that says something no text beside it says (the flags of a case).
 *
 * `loading` turns by itself; `spin` turns any other one (the refresh of the board while it reads).
 * With less motion asked for it stands still (styles.css): what it says is also said in words, in
 * the text of its button ("Guardando…") or beside it.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[attr.data-icon]': 'name()',
    '[attr.role]': 'label() ? "img" : null',
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': 'label() ? null : "true"',
  },
  template: `<svg viewBox="0 0 24 24" [class.spin]="spinning()"><path [attr.d]="path()" /></svg>`,
  styles: `
    /*
     * Where the icon font that came before drew its glyphs, so that nothing around an icon moves:
     * the square from 0.875em above the baseline to 0.125em below it, in a box as tall as the line
     * (1lh), which the margins make.
     */
    svg {
      display: inline-block;
      width: 1em;
      height: 1em;
      fill: currentColor;
      margin-block: calc((1lh - 1em) / 2);
      vertical-align: calc(-0.125em - (1lh - 1em) / 2);
    }

    /*
     * The same box to the pixel, as Chrome laid out the font's: its ascent and descent (453 and 66
     * of its 512 units) rounded to whole pixels, and the leading of the line shared out with the
     * part above the baseline rounded down. Measured against the font for the sizes and line
     * heights the app uses. Without round() the box above stays, within a pixel of it.
     */
    @supports (width: round(1px, 1px)) {
      svg {
        --ascent: round(0.884765625em, 1px);
        --descent: round(0.12890625em, 1px);
        --above: calc(var(--ascent) + round(down, (1lh - var(--ascent) - var(--descent)) / 2, 1px));
        margin-top: calc(var(--above) - 0.875em);
        margin-bottom: calc(1lh - var(--above) - 0.125em);
        vertical-align: calc(var(--above) - 1lh);
      }
    }

    .spin {
      animation: spin 2s linear infinite;
    }

    @keyframes spin {
      from {
        transform: rotate(0deg);
      }
      to {
        transform: rotate(359deg);
      }
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  /** The name of what the icon says, for an icon with no text beside it that says it. */
  readonly label = input<string>();
  readonly spin = input(false);

  protected readonly path = computed(() => ICONS[this.name()]);
  protected readonly spinning = computed(() => this.spin() || this.name() === 'loading');
}
