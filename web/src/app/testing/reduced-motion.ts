/*
 * For specs of what the app draws when the person asked their system for less motion: the rules
 * of the page under `@media (prefers-reduced-motion: reduce)` (the end of styles.css, the
 * `motion-reduce:` classes, the styles of the components drawn so far), as the browser applies
 * them then. The browser of the tests cannot be asked for less motion, so they are copied without
 * that condition, each in its layer and under its selector, into a stylesheet of their own, which
 * goes away after the test (test.ts calls restoreMotion after each one):
 *
 *   beforeEach(() => reduceMotion());
 *
 * Only the stylesheets: what a script asks `matchMedia` (the charts) is the browser's answer.
 */

const REDUCE = /\(prefers-reduced-motion:\s*reduce\)/;

/** The stylesheet of the test, while one is in place. */
let added: HTMLStyleElement | null = null;

/** The rules under less motion in `rules`, each written inside what holds it (`wrap`). */
function underLessMotion(rules: CSSRuleList, wrap: (inner: string) => string): string[] {
  const found: string[] = [];
  const inner = (rule: CSSGroupingRule | CSSStyleRule): string => Array.from(rule.cssRules, (child) => child.cssText).join('\n');
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSMediaRule && REDUCE.test(rule.media.mediaText)) {
      found.push(wrap(`@media ${rule.media.mediaText.replace(REDUCE, 'all')} { ${inner(rule)} }`));
    } else if (rule instanceof CSSMediaRule) {
      found.push(...underLessMotion(rule.cssRules, (text) => wrap(`@media ${rule.media.mediaText} { ${text} }`)));
    } else if (rule instanceof CSSSupportsRule) {
      found.push(...underLessMotion(rule.cssRules, (text) => wrap(`@supports ${rule.conditionText} { ${text} }`)));
    } else if (rule instanceof CSSLayerBlockRule) {
      found.push(...underLessMotion(rule.cssRules, (text) => wrap(`@layer ${rule.name} { ${text} }`)));
    } else if (rule instanceof CSSStyleRule && rule.cssRules.length) {
      // A rule nested in it (a `motion-reduce:` class is one): under the same selector.
      found.push(...underLessMotion(rule.cssRules, (text) => wrap(`${rule.selectorText} { ${text} }`)));
    }
  }
  return found;
}

/** Draws the page until the end of the test as it is drawn with less motion asked for. */
export function reduceMotion(): void {
  restoreMotion();
  const rules = Array.from(document.styleSheets).flatMap((sheet) => underLessMotion(sheet.cssRules, (text) => text));
  if (!rules.length) throw new Error('The page has no rule for less motion: its stylesheet is not loaded');
  added = document.createElement('style');
  added.textContent = rules.join('\n');
  // Last in the page, after the stylesheet of the app, which Karma loads in the body: within a layer, the later rule wins.
  document.body.append(added);
}

/** The page goes back to motion as the browser asks for it. After every test: see test.ts. */
export function restoreMotion(): void {
  added?.remove();
  added = null;
}
