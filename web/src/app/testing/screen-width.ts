import { BreakpointObserver } from '@angular/cdk/layout';
import type { BreakpointState } from '@angular/cdk/layout';
import type { Provider } from '@angular/core';
import { BehaviorSubject, map } from 'rxjs';
import type { Observable } from 'rxjs';

/** A laptop, which the case list shows as a table. */
export const DESKTOP = 1280;
/** A phone, which the case list shows as cards. */
export const PHONE = 375;

/** A length of a media query in px. rem and em count the browser's usual 16 px. */
function pixels(length: string): number {
  const found = /^(\d+(?:\.\d+)?)(px|r?em)$/.exec(length.trim());
  if (!found) throw new Error(`ScreenWidth cannot read the length "${length}"`);
  return Number(found[1]) * (found[2] === 'px' ? 1 : 16);
}

/**
 * Whether a screen `width` px wide matches `query`, conditions joined by `and`. Its min-width and
 * max-width are measured against `width`. Any other condition, such as the `(forced-colors: active)`
 * the CDK asks for, is the browser's answer.
 */
function matches(query: string, width: number): boolean {
  return query.split(/\band\b/).every((condition) => {
    const found = /^\s*\((min|max)-width:\s*([^)]+)\)\s*$/.exec(condition);
    if (!found) return window.matchMedia(condition.trim()).matches;
    return found[1] === 'min' ? width >= pixels(found[2]) : width <= pixels(found[2]);
  });
}

/**
 * The width of the screen in a spec, in place of the one of the browser that runs the tests:
 * Karma's window is some 747 px wide, a phone for the app. Given as the BreakpointObserver, it
 * answers the media queries the app asks for that width, and again when the spec changes it, as
 * the real one does when the window is resized. A width it cannot read fails the spec.
 */
export class ScreenWidth {
  private readonly width: BehaviorSubject<number>;

  constructor(width: number) {
    this.width = new BehaviorSubject(width);
  }

  /** The screen is now `width` px wide: a window resized, a tablet turned. */
  set(width: number): void {
    this.width.next(width);
  }

  isMatched(value: string | readonly string[]): boolean {
    return this.state(value, this.width.value).matches;
  }

  observe(value: string | readonly string[]): Observable<BreakpointState> {
    return this.width.pipe(map((width) => this.state(value, width)));
  }

  private state(value: string | readonly string[], width: number): BreakpointState {
    const queries = (typeof value === 'string' ? [value] : value).flatMap((query) => query.split(','));
    const breakpoints = Object.fromEntries(queries.map((query) => [query.trim(), matches(query, width)]));
    return { matches: Object.values(breakpoints).some(Boolean), breakpoints };
  }
}

/**
 * A screen `width` px wide for the components of a spec (see ScreenWidth). The spec changes it
 * with `TestBed.inject(ScreenWidth).set(...)`, before or after creating the component.
 */
export function provideScreenWidth(width: number): Provider[] {
  return [
    { provide: ScreenWidth, useFactory: () => new ScreenWidth(width) },
    { provide: BreakpointObserver, useExisting: ScreenWidth },
  ];
}
