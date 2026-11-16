import { TestBed } from '@angular/core/testing';
import { WIDE_SCREEN, wideScreen } from './wide-screen';

/** The media condition of a class of styles.css, which the test page loads. */
function mediaOf(selector: string, rules: CSSRuleList, media = '', within = ''): string | null {
  for (const rule of Array.from(rules)) {
    const condition = rule instanceof CSSMediaRule ? rule.conditionText : media;
    const style = rule instanceof CSSStyleRule ? rule.selectorText : within;
    if (condition && style === selector) return condition;
    // Rules nest in layers, in media rules, and in other rules.
    if ('cssRules' in rule) {
      const found = mediaOf(selector, (rule as CSSGroupingRule).cssRules, condition, style);
      if (found) return found;
    }
  }
  return null;
}

/** The width a media condition starts at, in px: `(width >= 48rem)` is 768. */
function from(condition: string): number {
  const found = /(\d+(?:\.\d+)?)(px|rem)/.exec(condition);
  if (!found) throw new Error(`No width in ${condition}`);
  return Number(found[1]) * (found[2] === 'rem' ? 16 : 1);
}

describe('wideScreen', () => {
  // With the real BreakpointObserver: the browser answers the query.
  it('is what the browser answers to the query of a wide screen', () => {
    const wide = TestBed.runInInjectionContext(() => wideScreen());
    expect(wide()).toBe(window.matchMedia(WIDE_SCREEN).matches);
  });

  // The page draws one thing or the other with this, and lays out the rest with the classes `md:`.
  it('starts where the classes md: of styles.css start: 768 px', () => {
    const md = Array.from(document.styleSheets)
      .map((sheet) => mediaOf('.md\\:hidden', sheet.cssRules))
      .find(Boolean);

    expect(md).withContext('the rule of md:hidden in styles.css').toBeTruthy();
    expect(from(WIDE_SCREEN)).toBe(768);
    expect(from(md!)).toBe(from(WIDE_SCREEN));
  });
});
