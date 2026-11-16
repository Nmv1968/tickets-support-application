/** The least a popover leaves between itself and the left edge of the screen, in px. */
const SCREEN_MARGIN = 8;

/**
 * Which edge of its button a popover (a menu under the button) lines up with: the right one, so
 * that it opens towards the middle of the screen, unless that takes its left edge off the screen.
 * A button that a narrow screen sends to the start of a line of its own has no room on its left.
 * `widthRem` is the width of the popover, in rem.
 */
export function popoverSide(button: Element, widthRem: number): 'left' | 'right' {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  return button.getBoundingClientRect().right - widthRem * rem < SCREEN_MARGIN ? 'left' : 'right';
}
