import type { BrowserContextOptions, Page } from '@playwright/test';
import { expectAccessible } from '../support/a11y';
import { expect, test } from '../support/fixtures';
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
import type { Showcase } from '../support/screens';
import { announced, toast } from '../support/ui';

/**
 * The automated part of the accessibility target (WCAG 2.2 AA, in both themes): axe on every main
 * screen and dialog, as an administrator and, where they differ, as an agent. One browser per
 * theme and role, which goes from screen to screen; each scan says what it found at the end of its
 * test, so one run tells every screen that fails. What axe cannot tell (the keyboard, what a screen
 * reader says) is in the Karma tests of each component.
 *
 * Each screen is scanned on a desktop (1280 × 800). What only a phone shows is scanned again on a
 * phone (375 × 812, emulated as one: touch and no hover): the cards of the list, the header and the
 * bar of tabs, the panel and the bell as wide as the screen, and the link to skip to the content
 * as the first Tab shows it. How the rest fits each size is for tests/responsive.spec.ts.
 *
 * Without animations ("reducir movimiento", which the app honours): a colour is measured where
 * it ends, not halfway through a transition.
 */
const THEMES = [
  { name: 'claro', colorScheme: 'light' },
  { name: 'oscuro', colorScheme: 'dark' },
] as const;

const SCREEN: BrowserContextOptions = { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' };

/** A phone as a phone lays out a page: what is shown only on hover on a desktop is always in sight there. */
const PHONE: BrowserContextOptions = { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' };

/** The theme is the one asked for: a scan in the wrong one would pass for the other. */
async function expectTheme(page: Page, colorScheme: 'light' | 'dark'): Promise<void> {
  await expect(page.locator('html.dark')).toHaveCount(colorScheme === 'dark' ? 1 : 0);
}

/** The case list as the user of `page` sees it. */
async function scanList(page: Page, showcase: Showcase): Promise<void> {
  await test.step('lista de casos', async () => {
    await openList(page, showcase);
    await expectAccessible(page, 'la lista de casos');
  });
}

/**
 * The panel of the case with everything, and the bell: what an agent is told differs there (who
 * turns the AI and the reminders on), and a phone shows them as wide as the screen. `where` follows
 * the name of each scan in what a failure says ("en un teléfono").
 */
async function scanPanelAndBell(page: Page, showcase: Showcase, where = ''): Promise<void> {
  await test.step(`panel del caso${where}`, async () => {
    const panel = await openFullCase(page, showcase);
    await expectAccessible(page, `el panel del caso${where}`, ['[role=dialog]']);
    await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await expect(panel).toBeHidden();
  });

  await test.step(`avisos de la campana${where}`, async () => {
    const bell = await openBell(page);
    await expectAccessible(page, `los avisos${where}`, ['[role=dialog]']);
    await bell.getByRole('button', { name: 'Cerrar' }).click();
    await expect(bell).toBeHidden();
  });
}

for (const theme of THEMES) {
  test.describe(`tema ${theme.name}`, () => {
    test.use({ colorScheme: theme.colorScheme, ...SCREEN });

    test.describe('sin sesión', () => {
      test.use({ storageState: { cookies: [], origins: [] } });

      test('la pantalla de ingreso y su error no tienen fallas graves de accesibilidad', async ({ page, newUser }) => {
        const user = await newUser();
        await page.goto('/login');
        await expectTheme(page, theme.colorScheme);
        await expect(page.getByLabel('Usuario')).toBeVisible();
        await expectAccessible(page, 'la pantalla de ingreso');

        await page.getByLabel('Usuario').fill(user.username);
        await page.getByLabel('Contraseña').fill(`${user.password}-mal`);
        await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
        await expect(page.locator('#login-error')).toHaveText('Usuario o contraseña incorrectos');
        await expect(announced(page, 'assertive')).toHaveText('Usuario o contraseña incorrectos');
        await expectAccessible(page, 'el error de ingreso');
      });
    });

    test('como administrador, ninguna pantalla ni diálogo tiene fallas graves de accesibilidad', async ({ api, uid, newUser, pageAs }) => {
      test.slow();
      const [showcase, admin] = await Promise.all([makeShowcase(api, uid), newUser('ADMIN')]);
      const page = await pageAs(admin, { colorScheme: theme.colorScheme, ...SCREEN });
      await watchShowcase(page, showcase);

      await scanList(page, showcase);
      await expectTheme(page, theme.colorScheme);

      await test.step('filtros y un desplegable abierto', async () => {
        await page.getByRole('button', { name: /^Filtros/ }).click();
        const filters = page.getByRole('group', { name: 'Filtros' });
        await expect(filters).toBeVisible();
        await settled(page);
        await expectAccessible(page, 'los filtros', ['#ticket-filters']);
        const company = filters.getByRole('combobox', { name: 'Empresa' });
        await openSelect(company);
        await expectAccessible(page, 'la lista de empresas de los filtros', ['#ticket-filters', OPEN_LIST]);
        await closeSelect(company);
      });

      await test.step('lista vacía', async () => {
        await page.getByRole('searchbox', { name: 'Buscar casos' }).fill(`sin-resultados-${showcase.uid}`);
        await expect(page.getByText('Ningún caso coincide con los filtros.')).toBeVisible();
        await settled(page);
        await expectAccessible(page, 'la lista sin casos');
      });

      await scanPanelAndBell(page, showcase);

      await test.step('panel del caso: sus estados, sus preguntas y la imagen ampliada', async () => {
        const panel = await openFullCase(page, showcase);
        // A list of the form, inside the dialog.
        const types = panel.getByRole('combobox', { name: 'Tipos de soporte' });
        await openSelect(types);
        await expectAccessible(page, 'la lista de tipos de soporte del panel', ['[role=dialog]', OPEN_LIST]);
        await closeSelect(types);

        // A field left empty, with its message, and the notice of a change made elsewhere meanwhile.
        await panel.getByLabel('Descripción').fill('');
        await api.updateTicket(showcase.full.id, { priority: 'HIGH' });
        await expect(panel.getByText('Este caso cambió en otra pantalla.')).toBeVisible();
        await expect(panel.getByText('La descripción no puede quedar vacía.')).toBeVisible();
        // The notice is said by the Announcer, whose region the panel owns meanwhile: VoiceOver reads nothing outside it.
        await expect(announced(page)).toContainText('Este caso cambió en otra pantalla.');
        await expect(panel).toHaveAttribute('aria-owns', 'announcer-polite');
        await settled(page);
        await expectAccessible(page, 'el panel con un campo vacío y un cambio de otra pantalla', ['[role=dialog]']);

        await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
        const leave = page.getByRole('alertdialog', { name: 'Hay cambios sin guardar' });
        await expect(leave).toBeVisible();
        await expectAccessible(page, 'la pregunta antes de salir con cambios', ['[role=alertdialog]']);
        await leave.getByRole('button', { name: 'Seguir editando' }).click();
        await expect(leave).toBeHidden();

        await panel.getByRole('button', { name: 'Ver la versión actual' }).click();
        await expect(panel.getByText('Este caso cambió en otra pantalla.')).toBeHidden();
        await panel.getByLabel('Estimado (minutos)').fill('120');
        await panel.getByRole('button', { name: 'Actualizar' }).click();
        await expect(toast(page, 'Caso actualizado')).toBeVisible();
        await expect(panel).toHaveAttribute('aria-owns', 'announcer-polite');
        await expectAccessible(page, 'un aviso de la aplicación', ['app-toasts']);

        await panel.getByRole('button', { name: 'Eliminar caso' }).click();
        const remove = page.getByRole('alertdialog');
        await expect(remove).toBeVisible();
        await expectAccessible(page, 'la pregunta antes de eliminar', ['[role=alertdialog]']);
        await remove.getByRole('button', { name: 'Cancelar' }).click();
        await expect(remove).toBeHidden();

        await panel.getByRole('button', { name: 'captura.png', exact: true }).click();
        const image = page.getByRole('dialog', { name: 'Imagen: captura.png' });
        await expect(image.getByRole('img', { name: 'captura.png' })).toBeVisible();
        await expectAccessible(page, 'la imagen ampliada', ['[role=dialog][aria-label^="Imagen:"]']);
        await image.getByRole('button', { name: 'Cerrar' }).click();
        await expect(image).toBeHidden();
        await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
        await expect(panel).toBeHidden();
      });

      await test.step('columnas, exportar y caso nuevo', async () => {
        await openList(page, showcase);
        await page.getByRole('button', { name: 'Columnas' }).click();
        await expect(page.getByRole('group', { name: 'Columnas de la lista' })).toBeVisible();
        await expectAccessible(page, 'las columnas', ['#ticket-columns']);
        await page.getByRole('button', { name: 'Columnas' }).click();

        await page.getByRole('button', { name: 'Exportar' }).click();
        await expect(page.locator('#export-menu')).toBeVisible();
        await expectAccessible(page, 'el menú de exportar', ['#export-menu']);
        await page.getByRole('button', { name: 'Exportar' }).click();

        await page.getByRole('button', { name: 'Nuevo caso' }).click();
        const form = page.getByRole('form', { name: 'Nuevo caso' });
        await form.getByRole('button', { name: 'Registrar' }).click();
        await expect(form.getByText('Elige una empresa.')).toBeVisible();
        await settled(page);
        await expectAccessible(page, 'el caso nuevo con campos que faltan', ['app-new-ticket']);
      });

      await test.step('importar una hoja con filas rechazadas', async () => {
        const dialog = await openImport(page, showcase);
        await expectAccessible(page, 'la vista previa de una importación', ['[role=dialog]']);
        await dialog.getByRole('button', { name: 'Cerrar' }).click();
        await expect(dialog).toBeHidden();
      });

      await test.step('nuevo con IA, los dos pasos', async () => {
        await openAiDialog(page);
        await expectAccessible(page, 'el primer paso de un caso con IA', ['[role=dialog]']);
        const review = await openAiReview(page);
        await expectAccessible(page, 'el segundo paso de un caso con IA, con campos que faltan', ['[role=dialog]']);
        await review.getByRole('button', { name: 'Cerrar' }).click();
        await expect(review).toBeHidden();
      });

      await test.step('tablero', async () => {
        await openBoard(page, showcase);
        await expectAccessible(page, 'el tablero');
      });

      await test.step('dashboard', async () => {
        await openDashboard(page, showcase);
        await expectAccessible(page, 'el dashboard');
      });

      await test.step('configuración, cada pestaña', async () => {
        await page.goto('/configuracion');
        for (const tab of settingsTabs(showcase, admin)) {
          await openSettingsTab(page, tab);
          await expectAccessible(page, `la pestaña ${tab.name} de Configuración`);
        }
      });
    });

    test('en un teléfono, la lista, el panel del caso y los avisos no tienen fallas graves de accesibilidad', async ({ api, uid, newUser, pageAs }) => {
      const [showcase, admin] = await Promise.all([makeShowcase(api, uid), newUser('ADMIN')]);
      const page = await pageAs(admin, { colorScheme: theme.colorScheme, ...PHONE });
      await watchShowcase(page, showcase);

      await test.step('el enlace para saltar al contenido, con el foco', async () => {
        await page.goto('/casos');
        await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
        await expectTheme(page, theme.colorScheme);
        // Hidden until the first Tab of the page shows it, over the header.
        await page.keyboard.press('Tab');
        await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused();
        await settled(page);
        await expectAccessible(page, 'el enlace para saltar al contenido', ['a[href="#contenido"]']);
      });

      await test.step('lista de casos en tarjetas, con el encabezado y la barra de pestañas', async () => {
        await openList(page, showcase);
        // The layout of a phone: a card per case instead of the table, the bars above and below.
        await expect(page.getByRole('table')).toHaveCount(0);
        await expect(page.getByRole('banner')).toBeVisible();
        await expect(page.getByRole('navigation', { name: 'Principal' }).getByRole('link', { name: 'Casos' })).toBeVisible();
        await expectAccessible(page, 'la lista de casos en un teléfono');
      });

      await scanPanelAndBell(page, showcase, ' en un teléfono');
    });

    test('como agente, lo que cambia para un agente no tiene fallas graves de accesibilidad', async ({ api, uid, newUser, pageAs }) => {
      const [showcase, agent] = await Promise.all([makeShowcase(api, uid), newUser()]);
      const page = await pageAs(agent, { colorScheme: theme.colorScheme, ...SCREEN });
      await watchShowcase(page, showcase);

      await scanList(page, showcase);
      await expectTheme(page, theme.colorScheme);
      await scanPanelAndBell(page, showcase);

      // Fewer tabs; what is in each one is what an administrator has, scanned with theirs.
      await test.step('configuración, con las pestañas de un agente', async () => {
        await page.goto('/configuracion');
        await openSettingsTab(page, settingsTabs(showcase, agent).find((tab) => tab.name === 'Responsables')!);
        await expectAccessible(page, 'Configuración de un agente');
      });
    });
  });
}
