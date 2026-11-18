import type { BrowserContextOptions, Locator, Page } from '@playwright/test';
import { expect, test } from '../support/fixtures';
import { SCREENS, expectLayout, layoutProblems } from '../support/layout';
import { selectBox } from '../support/ui';
import {
  OPEN_LIST,
  closeSelect,
  makeShowcase,
  openAiDialog,
  openAiReview,
  openBell,
  openBoard,
  openDashboard,
  openFullCase,
  openImport,
  openList,
  openSelect,
  openSettingsTab,
  settingsTabs,
  settled,
  watchShowcase,
} from '../support/screens';

/**
 * The layout guard: the main screens and dialogs at the size of two phones held upright, a phone on
 * its side (the one short screen, 740 × 360, where the menu of the header is opened too), a tablet
 * and two desktops (SCREENS, support/layout.ts). None may scroll the page sideways, every control
 * must be in the screen or reachable by scrolling, not cut by its box, and a button that shows only
 * its icon must be 24 px a side, 44 below 768 px. One browser goes through the sizes: what stays
 * open (a screen, a panel, a dialog) is checked at each of them as the window changes size, and
 * what places itself when it opens (a menu, the list of a select) is opened at each.
 *
 * Without animations: a panel is measured where it ends, not while it slides in.
 */
const OPTIONS: BrowserContextOptions = { viewport: { width: SCREENS[0].width, height: SCREENS[0].height }, reducedMotion: 'reduce' };

/** The `short:` layout of styles.css: 30rem high at most. */
const SHORT_UP_TO = 480;

/** Checks what is on screen at every size, opening it at each with `open` (and closing it with `close`) when given. */
async function atEverySize(page: Page, screen: string, open?: () => Promise<void>, close?: () => Promise<void>): Promise<void> {
  for (const size of SCREENS) {
    await page.setViewportSize({ width: size.width, height: size.height });
    await settled(page);
    await open?.();
    await expectLayout(page, screen, size);
    await close?.();
  }
}

test.describe('sin sesión', () => {
  test.use({ storageState: { cookies: [], origins: [] }, ...OPTIONS });

  test('la pantalla de ingreso y su error caben en cada tamaño', async ({ page, newUser }) => {
    const user = await newUser();
    await page.goto('/login');
    await expect(page.getByLabel('Usuario')).toBeVisible();
    for (const size of SCREENS) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await expectLayout(page, 'la pantalla de ingreso', size);
    }
    await page.getByLabel('Usuario').fill(user.username);
    await page.getByLabel('Contraseña').fill(`${user.password}-mal`);
    await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    await expect(page.locator('#login-error')).toBeVisible();
    for (const size of SCREENS) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await expectLayout(page, 'el error de ingreso', size);
    }
  });
});

/**
 * The guard itself, on a page of its own: a button whose icon is a glyph written as text (the "×"
 * of ng-select and of a chip, the "?" of a hint) is a button of an icon too. It saw only an SVG, and
 * a new button of a glyph 24 px a side on a phone went by unseen. The ones that are 24 px on
 * purpose (SMALL_ON_PURPOSE) are named apart, and still need their 24 px.
 */
test.describe('la guarda del tamaño de los botones', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  const PAGE = `
    <style>
      body { margin: 0; padding: 8px; display: flex; flex-wrap: wrap; gap: 8px; font: 16px sans-serif; }
      button, [role=button] { all: unset; display: inline-grid; place-items: center; box-sizing: border-box; }
      .s20 { width: 20px; height: 20px; } .s24 { width: 24px; height: 24px; } .s44 { width: 44px; height: 44px; }
    </style>
    <button id="glyph" class="s24" aria-label="Cerrar"><span aria-hidden="true">×</span></button>
    <button id="dots" class="s24" aria-label="Más opciones">…</button>
    <button id="svg" class="s24" aria-label="Actualizar"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M2 2h20v20H2z" /></svg></button>
    <button id="big-glyph" class="s44" aria-label="Cerrar aviso"><span aria-hidden="true">×</span></button>
    <button id="word" class="s24">OK</button>
    <button id="number" class="s24" aria-label="Página 2">2</button>
    <app-hint><button id="hint" class="s24" aria-label="Ayuda sobre Fecha"><span aria-hidden="true">?</span></button></app-hint>
    <app-hint><button id="hint-small" class="s20" aria-label="Ayuda sobre Hora"><span aria-hidden="true">?</span></button></app-hint>
    <app-type-chip><span>Facturación</span><button id="chip" class="s24" aria-label="Quitar Facturación">×</button></app-type-chip>
    <div class="ng-select"><span id="clear" class="ng-clear-wrapper s24" role="button" tabindex="0" title="Quitar"><span aria-hidden="true">×</span></span></div>
  `;

  /** The buttons the guard finds too small, by their id. */
  const tooSmall = async (page: Page): Promise<string[]> => (await layoutProblems(page)).map((problem) => /#([\w-]+)/.exec(problem)?.[1] ?? problem);

  test('ve los de un glifo escrito como texto, y deja en 24 px en un teléfono solo los que lo son a propósito', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.setContent(PAGE);
    expect(await tooSmall(page)).toEqual(['glyph', 'dots', 'svg', 'hint-small']);

    await page.setViewportSize({ width: 1280, height: 800 });
    expect(await tooSmall(page)).toEqual(['hint-small']);
  });
});

/**
 * A phone, as a phone lays out a page: a list that ran past the right edge of the screen, even
 * for the moment before it was put in place, made the page wider, the select moved from under the
 * finger and the end of the tap closed the list it had just opened. The selects of the case panel
 * on the right half of the screen (Responsables, Módulo) could not be opened with a finger.
 */
test('en un teléfono, un toque abre la lista de cada select del panel del caso y la deja abierta', async ({ api, uid, newUser, pageAs }) => {
  const [showcase, admin] = await Promise.all([makeShowcase(api, uid), newUser('ADMIN')]);
  const page = await pageAs(admin, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await watchShowcase(page, showcase);
  const panel = await openFullCase(page, showcase);
  const list = page.locator(OPEN_LIST);
  for (const name of ['Estado', 'Responsables', 'Prioridad', 'Módulo', 'Empresa', 'Tipos de soporte']) {
    const combobox = panel.getByRole('combobox', { name });
    await combobox.scrollIntoViewIfNeeded();
    await selectBox(combobox).locator('.ng-select-container').tap({ position: { x: 24, y: 16 } });
    await settled(page);
    await expect(list, `la lista de ${name} sigue abierta tras el toque`).toBeVisible();
    const right = await list.evaluate((element) => element.getBoundingClientRect().right - document.documentElement.clientWidth);
    expect(right, `la lista de ${name} no pasa del borde derecho de la pantalla`).toBeLessThanOrEqual(0);
    await closeSelect(combobox);
  }
});

test('las pantallas principales caben en cada tamaño y se llega a cada control', async ({ api, uid, newUser, pageAs }) => {
  test.slow();
  const [showcase, admin] = await Promise.all([makeShowcase(api, uid), newUser('ADMIN')]);
  const page = await pageAs(admin, OPTIONS);
  await watchShowcase(page, showcase);

  await test.step('lista de casos, con sus filtros y el caso nuevo', async () => {
    await openList(page, showcase);
    await atEverySize(page, 'la lista de casos');
    await page.getByRole('button', { name: /^Filtros/ }).click();
    await page.getByRole('button', { name: 'Nuevo caso' }).click();
    await expect(page.getByRole('group', { name: 'Filtros' })).toBeVisible();
    await expect(page.getByRole('form', { name: 'Nuevo caso' })).toBeVisible();
    await atEverySize(page, 'la lista con los filtros y el caso nuevo');

    const company = page.getByRole('group', { name: 'Filtros' }).getByRole('combobox', { name: 'Empresa' });
    await atEverySize(page, 'la lista de empresas de los filtros', () => openSelect(company), () => closeSelect(company));
    await atEverySize(
      page,
      'el menú de exportar',
      async () => {
        await page.getByRole('button', { name: 'Exportar' }).click();
        await expect(page.locator('#export-menu')).toBeVisible();
      },
      () => page.getByRole('button', { name: 'Exportar' }).click(),
    );
    // On a short screen the four screens are behind "Menú", under the header.
    for (const size of SCREENS.filter((screen) => screen.height <= SHORT_UP_TO)) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await settled(page);
      const menu = page.getByRole('banner').getByRole('button', { name: 'Menú' });
      await menu.click();
      await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Tablero' })).toBeVisible();
      await expectLayout(page, 'el menú de una pantalla baja', size);
      await menu.click();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
    }
    await atEverySize(
      page,
      'las columnas',
      async () => {
        await page.getByRole('button', { name: 'Columnas' }).click();
        await expect(page.getByRole('group', { name: 'Columnas de la lista' })).toBeVisible();
      },
      () => page.getByRole('button', { name: 'Columnas' }).click(),
    );
  });

  await test.step('panel del caso', async () => {
    await page.setViewportSize({ width: SCREENS[0].width, height: SCREENS[0].height });
    const panel = await openFullCase(page, showcase);
    await atEverySize(page, 'el panel del caso');
    const types = panel.getByRole('combobox', { name: 'Tipos de soporte' });
    await atEverySize(page, 'la lista de tipos de soporte del panel', () => openSelect(types), () => closeSelect(types));
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(panel).toBeHidden();
  });

  const dialog = async (screen: string, open: () => Promise<Locator>) => {
    const opened = await open();
    await atEverySize(page, screen);
    await opened.getByRole('button', { name: 'Cerrar' }).click();
    await expect(opened).toBeHidden();
  };

  await test.step('importar, nuevo con IA y avisos', async () => {
    await dialog('la vista previa de una importación', () => openImport(page, showcase));
    await openAiDialog(page);
    await dialog('el segundo paso de un caso con IA', () => openAiReview(page));
    await dialog('los avisos', () => openBell(page));
  });

  await test.step('tablero', async () => {
    await openBoard(page, showcase);
    await atEverySize(page, 'el tablero');
  });

  await test.step('dashboard', async () => {
    await openDashboard(page, showcase);
    await atEverySize(page, 'el dashboard');
  });

  await test.step('configuración, cada pestaña', async () => {
    await page.goto('/configuracion');
    for (const tab of settingsTabs(showcase, admin)) {
      await openSettingsTab(page, tab);
      await atEverySize(page, `la pestaña ${tab.name} de Configuración`);
    }
  });
});
