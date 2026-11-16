import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * The sizes of tests/responsive.spec.ts, in CSS pixels: two phones held upright, a phone on its
 * side, a tablet held upright and two desktops. The phone on its side is the one short screen (360
 * px high: the `short:` layout of styles.css, where the bars and footers scroll away with the
 * content and the four screens are behind "Menú"); the next lowest is 568.
 */
export const SCREENS = [
  { name: 'teléfono', width: 360, height: 740 },
  { name: 'teléfono pequeño', width: 320, height: 568 },
  { name: 'teléfono de lado', width: 740, height: 360 },
  { name: 'tableta', width: 768, height: 1024 },
  { name: 'escritorio', width: 1280, height: 800 },
  { name: 'escritorio grande', width: 1920, height: 1080 },
] as const;

export type Screen = (typeof SCREENS)[number];

/**
 * What a person can press or reach with the Tab key. A label that wraps its input is the control a
 * person sees of a hidden one, and the box of a select is the one of the field it types in.
 */
const INTERACTIVE = [
  'a[href]',
  'button',
  'input:not([type=hidden]):not(.ng-select input)',
  '.ng-select-container',
  'select',
  'textarea',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
  '[role=button]',
  '[role=tab]',
  '[role=option]',
  '[role=checkbox]',
  '[role=switch]',
  'label:has(> input)',
].join(', ');

/**
 * The boxes that scroll sideways on purpose, inside a screen that does not: a table (the case list
 * on a wide screen, whose code column stays in view, and the previews of an import, each a region
 * the keyboard scrolls), the tabs of Configuración on a phone, and the columns of the board, one
 * beside the other. Any other box that scrolls sideways holds something wider than its screen.
 */
const SIDEWAYS = [':has(> table)', '[role=tablist]', '[cdkdroplistgroup]'];

/** Below this width the app is laid out for a phone (Tailwind's `md`), and a button of an icon is 44 px a side. */
const PHONE_BELOW = 768;

/**
 * The buttons of an icon that stay 24 px a side on a phone too, on purpose (see CONTRIBUTING): the
 * "?" of a hint, in the line of a label or in the header of a table, which would be as high as a
 * field; the "×" of a chip in a select, which would make each chip as high as a field; and the "×"
 * that clears a whole select, where a larger target makes clearing every chip by accident likelier.
 * Any other button of an icon is 44 px a side below PHONE_BELOW.
 */
export const SMALL_ON_PURPOSE = ['app-hint > button', 'app-type-chip > button', '.ng-select .ng-clear-wrapper'];

/**
 * What is wrong with the layout of the screen as it stands, one line each: the page, or a box in
 * it, scrolls sideways; a control is cut by the box around it, or cannot be brought into the
 * screen by scrolling; a button that shows only its icon is smaller than a finger needs. With a
 * dialog open, only the dialog counts (and the lists and notices over it): the page behind it is
 * checked on its own. Scrolls the page and its boxes to each control.
 */
export function layoutProblems(page: Page): Promise<string[]> {
  return page.evaluate(
    ({ interactive, sideways, phone, small, most }) => {
      const problems: string[] = [];
      const width = document.documentElement.clientWidth;
      const height = document.documentElement.clientHeight;
      const describe = (element: Element): string => {
        const text = element.getAttribute('aria-label') ?? element.getAttribute('title') ?? element.getAttribute('placeholder') ?? element.textContent ?? '';
        const id = element.id ? `#${element.id}` : '';
        const role = element.getAttribute('role') ? `[role=${element.getAttribute('role')}]` : '';
        return `${element.tagName.toLowerCase()}${id}${role} «${text.replace(/\s+/g, ' ').trim().slice(0, 60)}»`;
      };
      const where = (box: DOMRect): string => `x ${Math.round(box.left)}…${Math.round(box.right)}, y ${Math.round(box.top)}…${Math.round(box.bottom)}`;
      const shown = (element: Element): boolean => {
        const box = element.getBoundingClientRect();
        // Hidden ones, and the ones hidden on purpose for a screen reader (sr-only: a pixel).
        return box.width >= 2 && box.height >= 2 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]');
      };

      // A box that scrolls sideways, and what in it is wider than it is.
      const root = document.scrollingElement ?? document.documentElement;
      for (const box of [root, ...Array.from(document.body.querySelectorAll('*'))]) {
        if (box.scrollWidth <= box.clientWidth + 1) continue;
        if (box !== root) {
          const overflow = getComputedStyle(box).overflowX;
          if ((overflow !== 'auto' && overflow !== 'scroll') || sideways.some((selector) => box.matches(selector))) continue;
        }
        const edge = box === root ? width : box.getBoundingClientRect().left + box.clientWidth;
        const wider = Array.from(box.querySelectorAll('*')).filter((element) => {
          const right = element.getBoundingClientRect().right;
          return right > edge + 1 && (element.parentElement ?? box).getBoundingClientRect().right <= edge + 1;
        });
        problems.push(`${box === root ? 'la página' : describe(box)} se desplaza de lado (${box.scrollWidth} px en ${box.clientWidth}): ${wider.slice(0, 3).map(describe).join('; ') || 'sin un elemento que lo explique'}`);
      }

      // The boxes that can hide part of an element: those around it that it is laid out in. Not one
      // it is taken out of: a fixed panel by the box of the page it is written in, an element placed
      // with position: absolute by the boxes between it and the one it is placed in.
      const clipping = (element: Element): { box: Element; style: CSSStyleDeclaration }[] => {
        const found: { box: Element; style: CSSStyleDeclaration }[] = [];
        let position = getComputedStyle(element).position;
        for (let box = element.parentElement; box && box !== document.body && position !== 'fixed'; box = box.parentElement) {
          const style = getComputedStyle(box);
          if (position === 'absolute' && style.position === 'static') continue;
          if (style.overflowX !== 'visible' || style.overflowY !== 'visible') found.push({ box, style });
          position = style.position;
        }
        return found;
      };
      const hides = (overflow: string) => overflow === 'hidden' || overflow === 'clip';

      // A button that shows only its icon (no word in sight, no picture) is a target a finger has to hit: 24 px a
      // side at the least, 44 on a phone (below 768 px), as the class btn-icon of styles.css makes it. The
      // icon is an SVG, or a glyph written as text, hidden from a screen reader or not (the "×" of ng-select
      // and of a chip, the "?" of a hint): text with no letter and no digit in it is not a word.
      const least = width < phone ? 44 : 24;
      const iconOnly = (element: Element): boolean => {
        if (!element.matches('button, [role=button], a[href]') || element.querySelector('img')) return false;
        let icon = !!element.querySelector('svg');
        const texts = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let text = texts.nextNode(); text; text = texts.nextNode()) {
          const written = text.textContent?.trim();
          if (!written || text.parentElement?.closest('.sr-only')) continue;
          const range = document.createRange();
          range.selectNodeContents(text);
          const box = range.getBoundingClientRect();
          if (box.width < 2 || box.height < 2) continue;
          if (/[\p{L}\p{N}]/u.test(written)) return false;
          icon = true;
        }
        return icon;
      };
      /** The least a side of a button of an icon measures: 24 px for the ones small on purpose (SMALL_ON_PURPOSE). */
      const leastFor = (element: Element): number => (small.some((selector) => element.matches(selector)) ? 24 : least);

      // With a dialog open, what a person can reach is in the dialog: the lists of its selects, which
      // hang from the body, and the notices of the application go over it.
      const modal = Array.from(document.querySelectorAll('[aria-modal="true"]')).filter(shown).pop();
      const roots = modal ? [...Array.from(document.querySelectorAll('.ng-dropdown-panel')), modal, ...Array.from(document.querySelectorAll('app-toasts'))] : [document.body];
      const controls = roots.flatMap((area) => [...(area.matches(interactive) ? [area] : []), ...Array.from(area.querySelectorAll(interactive))]).filter(shown);
      for (const control of Array.from(new Set(controls))) {
        if (!control.isConnected || !shown(control)) continue;
        // Cut by a box that hides what does not fit in it, across or down, instead of scrolling to it.
        const inner = control.getBoundingClientRect();
        const needed = leastFor(control);
        if (iconOnly(control) && (inner.width < needed - 0.5 || inner.height < needed - 0.5)) {
          problems.push(`${describe(control)} muestra solo su icono y mide ${Math.round(inner.width)} × ${Math.round(inner.height)} px: necesita ${needed} px por lado (btn-icon)`);
        }
        const cut = clipping(control).find(({ box, style }) => {
          const outer = box.getBoundingClientRect();
          return (hides(style.overflowX) && (inner.left < outer.left - 2 || inner.right > outer.right + 2)) || (hides(style.overflowY) && (inner.top < outer.top - 2 || inner.bottom > outer.bottom + 2));
        });
        if (cut) {
          problems.push(`${describe(control)} queda cortado por ${describe(cut.box)} (${where(inner)} en ${where(cut.box.getBoundingClientRect())})`);
          continue;
        }
        // Brought into the screen as the keyboard or a scroll would bring it: whole into what shows
        // it (the screen, and the boxes that scroll around it), or, when it is bigger than that, a
        // part of it, the rest a scroll away (a long card in a column of the board of a phone).
        control.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const box = control.getBoundingClientRect();
        let [left, top, right, bottom] = [0, 0, width, height];
        for (const { box: around } of clipping(control)) {
          const view = around.getBoundingClientRect();
          [left, top, right, bottom] = [Math.max(left, view.left), Math.max(top, view.top), Math.min(right, view.right), Math.min(bottom, view.bottom)];
        }
        const fits = (start: number, end: number, from: number, to: number) => (end - start > to - from ? start < to && end > from : start >= from - 1 && end <= to + 1);
        if (!fits(box.left, box.right, left, right) || !fits(box.top, box.bottom, top, bottom)) {
          problems.push(`${describe(control)} queda fuera de la pantalla (${where(box)} en ${width} × ${height}, a la vista x ${Math.round(left)}…${Math.round(right)}, y ${Math.round(top)}…${Math.round(bottom)})`);
        }
      }
      // A defect that repeats in every row of a list says enough in its first few.
      return problems.length > most ? [...problems.slice(0, most), `… y ${problems.length - most} más`] : problems;
    },
    { interactive: INTERACTIVE, sideways: SIDEWAYS, phone: PHONE_BELOW, small: SMALL_ON_PURPOSE, most: 12 },
  );
}

/** Fails the test, at the end, with what is wrong with the layout of `screen` at this size. */
export async function expectLayout(page: Page, screen: string, size: Screen): Promise<void> {
  expect.soft(await layoutProblems(page), `${screen}, ${size.name} de ${size.width} × ${size.height}`).toEqual([]);
}
