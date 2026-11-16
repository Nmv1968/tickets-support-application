/*
 * For specs that look at the layout: the size of the screen as the browser sees it, the media
 * queries of styles.css included (`md:`, `short:`). Not the width the app asks the
 * BreakpointObserver for, which ScreenWidth gives (see screen-width.ts).
 *
 * Karma draws the specs in a frame of its own page. The frame is made that size, and goes back to
 * the size it had after the test (test.ts calls restoreScreen after each one):
 *
 *   beforeEach(() => resizeScreen(320, 200));
 */

/** The frame the specs are drawn in. Throws outside one: the spec would measure a screen it did not choose. */
function frame(): HTMLElement {
  const element = window.frameElement as HTMLElement | null;
  if (!element) throw new Error('resizeScreen needs the specs to run in a frame, as Karma runs them');
  return element;
}

/** Gives the frame back the size it had before the test resized it. */
let restore: (() => void) | null = null;

/**
 * Makes the screen `width` × `height` CSS px until the test ends. Called again in the same test,
 * it changes the size again: a window resized, a phone turned.
 */
export function resizeScreen(width: number, height: number): void {
  const element = frame();
  // The first size of the test is the one given back.
  if (!restore) {
    const before = element.getAttribute('style');
    restore = () => (before === null ? element.removeAttribute('style') : element.setAttribute('style', before));
  }
  Object.assign(element.style, { width: `${width}px`, height: `${height}px`, maxWidth: 'none', maxHeight: 'none' });
  // The browser lays the frame out again, and the media queries of the page answer for the new size.
  void element.offsetWidth;
  if (window.innerWidth !== width || window.innerHeight !== height) {
    throw new Error(`The screen is ${window.innerWidth} × ${window.innerHeight}, not ${width} × ${height}`);
  }
}

/** The screen goes back to the size it had before the test. After every test: see test.ts. */
export function restoreScreen(): void {
  restore?.();
  restore = null;
}
