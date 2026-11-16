import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { settled } from './screens';

/** What a screen reader takes for a live region: what comes into one is read out. */
const LIVE_REGION = '[role=status], [role=alert], [role=log], [aria-live]:not([aria-live=off])';

/** Where the watch of watchLiveRegions keeps what it found, in the page. */
const FAULTS = '__liveRegionFaults';

/**
 * Watches, from before the first script of each page of `context`, every live region that comes
 * into the page: one that comes with its words may be read by no screen reader, and is reported.
 * A live region is on the page empty, and changes (`<app-status>`, the regions of the Announcer,
 * the one of each ng-select); a message that comes with its words is said by the Announcer
 * (`appSay`, CONTRIBUTING.md, "Accesibilidad"). What it found is looked at by expectAccessible.
 */
export async function watchLiveRegions(context: BrowserContext): Promise<void> {
  await context.addInitScript(
    ({ selector, faults }) => {
      const found: string[] = [];
      (window as unknown as Record<string, string[]>)[faults] = found;
      const name = (element: Element): string => `<${element.tagName.toLowerCase()}${element.id ? ` id="${element.id}"` : ''}>`;
      // Looked at once the screen update that added it is over: an element of Angular gets its words after it is added.
      new MutationObserver((records) => {
        for (const record of records) {
          for (const node of Array.from(record.addedNodes)) {
            if (!(node instanceof Element)) continue;
            const regions = [...(node.matches(selector) ? [node] : []), ...Array.from(node.querySelectorAll(selector))];
            for (const region of regions) {
              const text = (region.textContent ?? '').replace(/\s+/g, ' ').trim();
              if (text && region.isConnected) found.push(`${name(region)} llegó con su texto: "${text.slice(0, 100)}"`);
            }
          }
        }
      }).observe(document, { childList: true, subtree: true });
    },
    { selector: LIVE_REGION, faults: FAULTS },
  );
}

/**
 * The live regions of the page, as a screen reader needs them: none came with its words (see
 * watchLiveRegions, when the page is watched), and none holds a control, which would be read out
 * with each of its messages ("Caso actualizado, Cerrar aviso"). What was found is forgotten once
 * said: the next scan says what came after.
 */
async function liveRegionFaults(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ selector, faults }) => {
      const store = window as unknown as Record<string, string[] | undefined>;
      const born = store[faults]?.splice(0) ?? [];
      const control = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [role=button], [role=link]';
      const holding = Array.from(document.querySelectorAll(selector))
        .filter((region) => region.querySelector(control))
        .map((region) => `<${region.tagName.toLowerCase()}${region.id ? ` id="${region.id}"` : ''}> tiene un control: "${(region.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 100)}"`);
      return [...born, ...holding];
    },
    { selector: LIVE_REGION, faults: FAULTS },
  );
}

type Violation = Awaited<ReturnType<AxeBuilder['analyze']>>['violations'][number];

/** WCAG 2.0, 2.1 and 2.2, levels A and AA: the target of the application (CONTRIBUTING.md, "Accesibilidad"). */
export const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** What fails a scan. A moderate or minor finding goes to the report of the test, without failing it. */
const FAILING = ['serious', 'critical'];

/**
 * Findings of axe that are not failures, each one for one rule on the elements named, and why.
 * A rule is never left out for a whole page, nor for an element that is not named here.
 */
const ACCEPTED: { rule: string; elements: string; why: string }[] = [
  {
    rule: 'label-content-name-mismatch',
    // The cards of the board, of the list on a phone and of the bell.
    elements: '[data-case-id][aria-labelledby], button[appremindercard]',
    // A card that is a button holds a whole case. Its label is its title, the code and the company
    // it starts with, and that is its name; the rest of the card is its description
    // (aria-describedby). Named by all its text, it was read out whole every time the focus reached
    // it (CONTRIBUTING.md, "Accesibilidad"). Whoever speaks to the computer opens it by its code or
    // its company, which are in its name. axe takes every word of the card for its label.
    why: 'una tarjeta de un caso se nombra por su título (código y empresa) y el resto es su descripción',
  },
];

/**
 * axe on the page, or on what `include` names. In legacy mode: one axe.run in the page itself, which
 * has no frames, instead of a run in each frame finished in a blank page opened for each scan.
 */
async function scan(page: Page, include: string[], rules?: string[]): Promise<Violation[]> {
  let builder = new AxeBuilder({ page }).setLegacyMode();
  builder = rules ? builder.withRules(rules) : builder.withTags(WCAG_TAGS);
  for (const selector of include) builder = builder.include(selector);
  return (await builder.analyze()).violations;
}

/** The serious and critical violations, one line per element, by rule: those of ACCEPTED left out. */
async function failures(page: Page, violations: Violation[]): Promise<Map<string, string[]>> {
  const failing = new Map<string, string[]>();
  for (const violation of violations.filter((found) => FAILING.includes(found.impact ?? ''))) {
    const accepted = ACCEPTED.find((entry) => entry.rule === violation.id);
    const targets = violation.nodes.map((node) => node.target.join(' '));
    const excused = accepted
      ? await page.evaluate(({ targets, elements }) => targets.map((target) => !!document.querySelector(target)?.matches(elements)), { targets, elements: accepted.elements })
      : targets.map(() => false);
    const lines = violation.nodes.flatMap((node, index) => {
      if (excused[index]) return [];
      const why = (node.failureSummary ?? '').split('\n').slice(1).map((line) => line.trim()).join(' ');
      return [`${violation.id} (${violation.impact}) en ${targets[index]}: ${why}`];
    });
    if (lines.length) failing.set(violation.id, lines);
  }
  return failing;
}

/**
 * Runs axe on the page, or only on what `include` names (a dialog, a list that opened), and fails
 * the test at its end with each serious or critical violation found, one line per element: the
 * rule, the element and what axe says is wrong. Every violation, of any impact, is attached to
 * the report of the test. Also with each live region of the page that came with its words or holds
 * a control (see liveRegionFaults), which axe does not look at.
 *
 * What fails is looked at again, once the page has drawn what it had pending: a screen draws again
 * what it reads (the lists of Configuración, read again as a tab opens, with what other tests
 * added), and Chromium has given the colour of the light theme to an element it had just inserted
 * in the dark one, before drawing it, and the right one once drawn. A violation that is really
 * there is there again.
 */
export async function expectAccessible(page: Page, screen: string, include: string[] = []): Promise<void> {
  let violations = await scan(page, include);
  let failing = await failures(page, violations);
  if (failing.size) {
    await settled(page);
    const rules = [...failing.keys()];
    violations = [...violations.filter((found) => !rules.includes(found.id)), ...(await scan(page, include, rules))];
    failing = await failures(page, violations);
  }
  if (violations.length) {
    await test.info().attach(`axe: ${screen}`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
  }
  expect.soft([...failing.values()].flat(), `accesibilidad de ${screen}`).toEqual([]);
  expect.soft(await liveRegionFaults(page), `regiones vivas de ${screen}`).toEqual([]);
}
