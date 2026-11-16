import type { Locator, Page, Route } from '@playwright/test';
import { expect, test } from '../support/fixtures';

/**
 * What the keyboard and "reducir movimiento" are shown in the browser itself, where Karma cannot
 * go: the stops of the Tab key inside a date or a time field (the button of its calendar or of its
 * clock is one), and the media query of less motion.
 */

interface Stop {
  /** The field: its id, or its name when it has none. */
  field: string;
  /** Whether the field itself is `:focus`: not on the button of its calendar. */
  focus: boolean;
  /** Its outline and its edge. */
  ring: string;
}

/** Each stop of the Tab key inside the `fields` that come after `from`, and how the field is drawn there. */
async function stopsIn(page: Page, from: Locator, fields: string[]): Promise<Stop[]> {
  await from.focus();
  const stops: Stop[] = [];
  for (let step = 0; step < 24; step++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate((): Stop => {
      const field = document.activeElement as HTMLElement;
      const style = getComputedStyle(field);
      return {
        field: field.id || (field.getAttribute('aria-label') ?? ''),
        focus: field.matches(':focus'),
        ring: `${style.outlineStyle} ${style.outlineWidth} ${style.outlineColor} / ${style.borderTopColor}`,
      };
    });
    if (fields.includes(stop.field)) stops.push(stop);
    // The "?" of a label between two fields (see Hint) is a stop of its own, passed over.
    else if (stop.field.startsWith('Ayuda sobre ')) continue;
    else if (stops.length) break;
  }
  return stops;
}

/** Every stop is drawn with the ring of a field with the focus, the button of the calendar or the clock included. */
function expectRingAtEveryStop(stops: Stop[], fields: Record<string, number>): void {
  for (const [field, least] of Object.entries(fields)) expect(stops.filter((stop) => stop.field === field).length, `paradas en ${field}`).toBeGreaterThanOrEqual(least);
  expect(stops.some((stop) => !stop.focus), 'una parada en la que el campo no es :focus (el botón del calendario)').toBe(true);
  const [{ ring }] = stops;
  expect(ring).toMatch(/^solid 2px /);
  for (const [index, stop] of stops.entries()) expect(stop.ring, `parada ${index + 1}, en ${stop.field}`).toBe(ring);
}

// On the last stop of a date field, the button of its calendar, the field was not `:focus`: only the thin ring of
// the browser was drawn, and the focus could hardly be seen (WCAG 2.4.7).
test('el anillo del foco se ve en cada parada del tabulador dentro de un campo de fecha o de hora', async ({ page }) => {
  await page.goto('/casos');
  await page.getByRole('button', { name: 'Nuevo caso' }).click();
  await expect(page.getByRole('form', { name: 'Nuevo caso' }).getByLabel('Fecha del caso', { exact: true })).toBeVisible();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  // dd/mm/aaaa and the calendar; hh:mm and the clock.
  expectRingAtEveryStop(await stopsIn(page, page.getByRole('button', { name: 'Cerrar el formulario de caso nuevo' }), ['nt-date', 'nt-time']), { 'nt-date': 4, 'nt-time': 3 });

  // The period of the dashboard.
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByLabel('Desde', { exact: true })).toBeVisible();
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
  expectRingAtEveryStop(await stopsIn(page, page.getByRole('button', { name: 'Este mes' }), ['Desde', 'Hasta']), { Desde: 4, Hasta: 4 });
});

test.describe('con "reducir movimiento"', () => {
  test.use({ reducedMotion: 'reduce' });

  const BOARD_READ = (url: URL): boolean => url.pathname === '/api/tickets';

  /** Holds the reads of the board from now on, until the function it gives back lets them go. */
  async function holdBoard(page: Page): Promise<() => Promise<void>> {
    const held: Route[] = [];
    await page.route(BOARD_READ, (route) => {
      held.push(route);
    });
    return async () => {
      await page.unroute(BOARD_READ);
      // A read the board cancelled for a newer one is gone already.
      await Promise.all(held.map((route) => route.continue().catch(() => undefined)));
    };
  }

  // The icon of "Actualizar" that turns was all the eye was shown of a read of the board, and the rule of less motion
  // stops it. That rule left every element a short transition of all its properties: a list of a select slid into place.
  test('nada tiene transición, y el tablero dice con palabras que se está actualizando', async ({ page }) => {
    await page.goto('/tablero');
    await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
    await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);

    const moving = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((element) => getComputedStyle(element).transitionProperty !== 'none').length);
    expect(moving, 'elementos con alguna transición').toBe(0);

    const refresh = page.getByRole('button', { name: 'Actualizar', exact: true });
    const icon = refresh.locator('svg');
    const words = page.getByText('Actualizando…', { exact: true });
    await expect(words).toHaveCount(0);
    const release = await holdBoard(page);
    await refresh.click();
    await expect(words).toBeVisible();
    // Who hears the page is told by the status of the board.
    await expect(words).toHaveAttribute('aria-hidden', 'true');
    // The icon stands still: its one short turn is over.
    await expect.poll(() => icon.evaluate((svg) => svg.getAnimations().length)).toBe(0);
    await release();
    await expect(words).toHaveCount(0);

    // Where motion is welcome, the icon that turns says it, and the words are not shown.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    const releaseAgain = await holdBoard(page);
    await refresh.click();
    await expect(words).toBeAttached();
    await expect(words).toBeHidden();
    await expect.poll(() => icon.evaluate((svg) => svg.getAnimations().length)).toBe(1);
    await releaseAgain();
    await expect(words).toHaveCount(0);
  });
});
