import { BreakpointObserver } from '@angular/cdk/layout';
import { inject } from '@angular/core';
import type { Signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';

/**
 * From this width on, a screen is wide: Tailwind's `lg`, which styles.css leaves as it comes
 * (64rem, 1024 px at the browser's usual text size). The classes `lg:` of the page switch there too.
 * Not `md` (768 px), where the menu of the app moves to the side: a tablet held upright, less
 * that menu, showed a third of the table of cases.
 */
export const WIDE_SCREEN = '(min-width: 64rem)';

/**
 * Whether the screen is wide (see WIDE_SCREEN), as it is now and as it changes: a window resized,
 * a tablet turned. For a part of a page that is drawn one way or the other, not both.
 */
export function wideScreen(): Signal<boolean> {
  const breakpoints = inject(BreakpointObserver);
  // The first answer comes at once, from the media query as it stands.
  return toSignal(breakpoints.observe(WIDE_SCREEN).pipe(map((state) => state.matches)), { requireSync: true });
}
