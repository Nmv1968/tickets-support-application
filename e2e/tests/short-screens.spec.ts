import type { Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { OPEN_LIST, closeSelect, makeShowcase, openFullCase, settled, watchShowcase } from '../support/screens';
import { selectBox } from '../support/ui';

/**
 * Short screens, in the browser itself: a phone on its side (740 × 360) and a page zoomed to 400 %
 * on a laptop (320 × 200 CSS px). The bars of the app scroll away with the page there.
 *
 * - The four screens are behind "Menú", in the header: after the content, the bar of tabs was
 *   thousands of pixels down a list of cases.
 * - The list of every select of the case panel is whole on the screen, wherever the select is: a
 *   select of several lines (the support types of a case) left room for it on neither side, and
 *   it went past the top.
 */

const PHONE_ON_ITS_SIDE = { width: 740, height: 360 };
const ZOOMED_400 = { width: 320, height: 200 };

/** The selects of the case panel, by their label. */
const PANEL_SELECTS = ['Empresa', 'Estado', 'Responsables', 'Prioridad', 'Módulo', 'Tipos de soporte'];

test.describe('en una pantalla baja', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const size of [PHONE_ON_ITS_SIDE, ZOOMED_400]) {
    test(`a ${size.width} × ${size.height}, "Menú" en el encabezado lleva a las cuatro pantallas`, async ({ newUser, pageAs }) => {
      const page = await pageAs(await newUser(), { viewport: size });
      await page.goto('/casos');
      await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
      const menu = page.getByRole('banner').getByRole('button', { name: 'Menú' });
      const nav = page.getByRole('navigation', { name: 'Principal' });

      // No bar of tabs after the screen: the menu stands for it.
      await expect(menu).toBeVisible();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await expect(nav).toHaveCount(0);

      // From the top of the page with the keyboard: the skip link, the bell, the theme, "Salir", "Menú".
      await page.keyboard.press('Tab');
      for (let stop = 0; stop < 4; stop++) await page.keyboard.press('Tab');
      await expect(menu).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await expect(nav.getByRole('link')).toHaveText(['Casos', 'Tablero', 'Dashboard', 'Configuración']);
      await expect(nav.getByRole('link', { name: 'Casos' })).toHaveAttribute('aria-current', 'page');
      // Under the header, in sight without scrolling.
      const box = (await nav.boundingBox())!;
      expect(box.y + box.height).toBeLessThanOrEqual(size.height);

      // Escape closes it and leaves the focus on its button.
      await page.keyboard.press('Tab');
      await expect(nav.getByRole('link', { name: 'Casos' })).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(nav).toHaveCount(0);
      await expect(menu).toBeFocused();

      // A link pressed in it goes to its screen, and the menu closes.
      await menu.click();
      await nav.getByRole('link', { name: 'Tablero' }).click();
      await expect(page).toHaveURL(/\/tablero$/);
      await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
      await expect(nav).toHaveCount(0);
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
    });
  }

  test('en un teléfono de altura normal sigue la barra de pestañas, sin "Menú"', async ({ newUser, pageAs }) => {
    const page = await pageAs(await newUser(), { viewport: { width: 375, height: 812 } });
    await page.goto('/casos');
    await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();

    await expect(page.getByRole('banner').getByRole('button', { name: 'Menú' })).toBeHidden();
    const tabs = page.getByRole('navigation', { name: 'Principal' });
    await expect(tabs.getByRole('link')).toHaveText(['Casos', 'Tablero', 'Dashboard', 'Configuración']);
    const box = (await tabs.boundingBox())!;
    expect(box.y + box.height).toBeCloseTo(812, 0);
  });

  /** Where the open list is, and whether it shows one option whole at the least. */
  function placeOf(page: Page): Promise<{ top: number; bottom: number; options: number; option: number }> {
    return page.locator(OPEN_LIST).evaluate((list) => {
      const options = list.querySelector<HTMLElement>('.ng-dropdown-panel-items')!;
      const box = options.getBoundingClientRect();
      const option = (list.querySelector<HTMLElement>('.ng-option-marked') ?? list.querySelector<HTMLElement>('.ng-option'))!;
      return { top: box.top, bottom: box.bottom, options: options.clientHeight, option: option.offsetHeight };
    });
  }

  /** Opens the list of a select with its arrow, the select brought to `at` of the screen first. */
  async function openAt(combobox: Locator, at: ScrollLogicalPosition): Promise<void> {
    const select = selectBox(combobox);
    await select.evaluate((element, block) => element.scrollIntoView({ block }), at);
    await settled(combobox.page());
    await select.locator('.ng-arrow-wrapper').click();
    await expect(combobox.page().locator(OPEN_LIST)).toBeVisible();
    await settled(combobox.page());
  }

  test('a 400 % la lista de cada select del panel del caso cabe entera en la pantalla', async ({ api, uid, newUser, pageAs }) => {
    test.slow();
    const [showcase, admin] = await Promise.all([makeShowcase(api, uid), newUser('ADMIN')]);
    const page = await pageAs(admin, { viewport: ZOOMED_400, reducedMotion: 'reduce' });
    await watchShowcase(page, showcase);
    const panel = await openFullCase(page, showcase);

    // The support types of the case: a select of several lines, higher than the room on either side of it.
    const types = (await selectBox(panel.getByRole('combobox', { name: 'Tipos de soporte' })).boundingBox())!;
    expect(types.height).toBeGreaterThan(ZOOMED_400.height / 2 - 40);

    for (const name of PANEL_SELECTS) {
      const combobox = panel.getByRole('combobox', { name, exact: true });
      for (const at of ['start', 'center', 'end'] as const) {
        await openAt(combobox, at);
        const place = await placeOf(page);
        const where = `la lista de ${name} (select al ${at === 'start' ? 'inicio' : at === 'center' ? 'centro' : 'final'} de la pantalla)`;
        expect(place.top, `${where} no pasa del borde de arriba`).toBeGreaterThanOrEqual(-0.5);
        expect(place.bottom, `${where} no pasa del borde de abajo`).toBeLessThanOrEqual(ZOOMED_400.height + 0.5);
        expect(place.options + 0.5, `${where} muestra una opción entera al menos`).toBeGreaterThanOrEqual(place.option);
        await closeSelect(combobox);
      }
    }
  });
});
