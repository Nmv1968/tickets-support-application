import ExcelJS from 'exceljs';
import type { APIResponse } from '@playwright/test';
import { repoFile } from '../support/env';
import { expect, test } from '../support/fixtures';
import { settle, watchPolicies } from '../support/policies';
import { adminHeaders } from '../support/session';
import { casePanel, caseRow, chooseOption, search, toast } from '../support/ui';

/** The Content-Security-Policy of web/security-headers.conf, directive by directive. */
const POLICY = {
  'default-src': "'self'",
  'script-src': "'self'",
  'style-src': "'self' 'unsafe-inline'",
  'img-src': "'self' blob: data:",
  'connect-src': "'self'",
  'object-src': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'frame-ancestors': "'none'",
};

/** The only features of the Permissions-Policy the app may use, and who may: the page itself. */
const ALLOWED_FEATURES = { 'clipboard-read': '(self)', 'clipboard-write': '(self)' };

/** A picture of 1 x 1 pixel, for the attachments, the AI dialog and the logo. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function directives(policy: string | undefined): Record<string, string> {
  return Object.fromEntries((policy ?? '').split(';').map((part) => part.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...values]) => [name, values.join(' ')]));
}

function features(policy: string | undefined): Record<string, string> {
  return Object.fromEntries((policy ?? '').split(',').map((part) => part.trim().split('=')).filter(([name]) => name).map(([name, value]) => [name, value]));
}

/** The blocks of an nginx configuration, each with the directives written directly in it (not in the blocks inside). */
function nginxBlocks(config: string): { name: string; directives: string }[] {
  const blocks: { name: string; directives: string }[] = [];
  const open = [{ name: '(main)', directives: '' }];
  let text = '';
  // Inside quotes, double or single, braces and semicolons are text: the JSON of the 413 page has them.
  let quote: string | null = null;
  for (const char of config.replace(/#.*$/gm, '')) {
    if (quote ? char === quote : char === '"' || char === "'") quote = quote ? null : char;
    if (quote || !'{};'.includes(char)) {
      text += char;
    } else if (char === '{') {
      open.push({ name: text.trim(), directives: '' });
      text = '';
    } else {
      open[open.length - 1].directives += `${text.trim()};\n`;
      text = '';
      if (char === '}') blocks.push(open.pop()!);
    }
  }
  return blocks;
}

const INCLUDE = 'include /etc/nginx/snippets/security-headers.conf;';

test('cada bloque de nginx.conf con add_header propio incluye las cabeceras de seguridad', () => {
  const blocks = nginxBlocks(repoFile('web', 'nginx.conf'));
  const server = blocks.find((block) => block.name === 'server');
  expect(server?.directives, 'el bloque server').toContain(INCLUDE);
  expect(server?.directives).toContain('server_tokens off;');
  // nginx gives a block none of the add_header of the block around it once it sets one of its own.
  const own = blocks.filter((block) => /^add_header /m.test(block.directives));
  expect(own.length).toBeGreaterThan(0);
  for (const block of own) expect(block.directives, block.name).toContain(INCLUDE);
});

test('nginx envía las cabeceras de seguridad en cada respuesta y no dice su versión', async ({ request, api, uid }) => {
  const index = await request.get('/');
  const html = await index.text();
  const script = /<script src="([^"]+\.js)"/.exec(html)?.[1];
  const styles = /<link rel="stylesheet" href="([^"]+\.css)"/.exec(html)?.[1];
  expect(script && styles, 'el index.html enlaza su script y su hoja de estilos').toBeTruthy();
  const permissions = index.headers()['permissions-policy'];

  // A file of a case: the API marks it nosniff itself, and the header must still go out once.
  const session = adminHeaders();
  const company = await api.createCompany(`Vidriería Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `Adjunto de las cabeceras ${uid}` });
  const uploaded = await request.post(`/api/tickets/${ticket.id}/attachments`, {
    headers: session,
    multipart: { files: { name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from(`Nota ${uid}`) } },
  });
  expect(uploaded.ok(), await uploaded.text()).toBe(true);
  const [attachment] = ((await uploaded.json()) as { attachments: { id: number }[] }).attachments;

  const answers: [string, APIResponse, number][] = [
    ['la página', index, 200],
    ['una ruta de la aplicación', await request.get('/casos'), 200],
    ['un script', await request.get(`/${script}`), 200],
    ['la hoja de estilos', await request.get(`/${styles}`), 200],
    ['el icono', await request.get('/favicon.ico'), 200],
    ['un archivo que no existe', await request.get('/no-existe.js'), 404],
    ['el API', await request.get('/api/branding'), 200],
    ['el API sin sesión', await request.get('/api/tickets'), 401],
    ['el flujo en vivo sin sesión', await request.get('/api/events'), 401],
    ['un adjunto', await request.get(`/api/attachments/${attachment.id}`, { headers: session }), 200],
  ];
  for (const [what, answer, status] of answers) {
    const headers = answer.headers();
    expect.soft(answer.status(), what).toBe(status);
    expect.soft(directives(headers['content-security-policy']), what).toEqual(POLICY);
    expect.soft(headers['x-content-type-options'], what).toBe('nosniff');
    expect.soft(headers['referrer-policy'], what).toBe('no-referrer');
    expect.soft(headers['x-frame-options'], what).toBe('DENY');
    expect.soft(headers['permissions-policy'], what).toBe(permissions);
    // server_tokens off: the name, not the version.
    expect.soft(headers.server, what).toBe('nginx');
    expect.soft(headers['x-powered-by'], what).toBeUndefined();
    // Served over plain HTTP: a browser told to use only HTTPS could not come back.
    expect.soft(headers['strict-transport-security'], what).toBeUndefined();
  }
  expect(await answers[5][1].text(), 'la página de error de nginx').not.toMatch(/nginx\/\d/);

  const allowed = features(permissions);
  expect(allowed).toEqual(expect.objectContaining({ camera: '()', microphone: '()', geolocation: '()', payment: '()', usb: '()', ...ALLOWED_FEATURES }));
  for (const [feature, allowlist] of Object.entries(allowed)) {
    expect(allowlist, feature).toBe(ALLOWED_FEATURES[feature as keyof typeof ALLOWED_FEATURES] ?? '()');
  }
});

test('el navegador aplica las políticas: no corre un script en línea ni da la cámara', async ({ page }) => {
  const reports = await watchPolicies(page);
  await page.goto('/casos');
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
  await settle(page);
  expect(reports, 'la aplicación misma no infringe nada').toEqual({ violations: [], console: [] });

  const ran = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'document.documentElement.dataset.inline = "ran"';
    document.head.append(script);
    return document.documentElement.dataset.inline === 'ran';
  });
  expect(ran, 'un script en línea').toBe(false);
  await expect.poll(() => reports.violations).toEqual([expect.stringMatching(/^script-src-elem inline /)]);
  await expect.poll(() => reports.console).toEqual([expect.stringContaining('Content Security Policy')]);

  // What the Permissions-Policy leaves to the page: the clipboard, and no camera, microphone or location.
  const allowed = await page.evaluate(() => {
    const policy = (document as unknown as { featurePolicy: { allowsFeature(feature: string): boolean } }).featurePolicy;
    return Object.fromEntries(['camera', 'microphone', 'geolocation', 'clipboard-read', 'clipboard-write'].map((feature) => [feature, policy.allowsFeature(feature)]));
  });
  expect(allowed).toEqual({ camera: false, microphone: false, geolocation: false, 'clipboard-read': true, 'clipboard-write': true });
});

test.describe('con la sesión desde la pantalla de ingreso', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('ninguna pantalla infringe la política de contenido ni la de permisos', async ({ page, api, uid, newUser }, testInfo) => {
    test.slow();
    const admin = await newUser('ADMIN');
    const company = await api.createCompany(`Óptica Demo ${uid}`);
    const reports = await watchPolicies(page);
    const clean = async (screen: string) => {
      await settle(page);
      expect(reports, screen).toEqual({ violations: [], console: [] });
    };

    await test.step('ingreso', async () => {
      await page.goto('/');
      await expect(page).toHaveURL(/\/login$/);
      await page.getByLabel('Usuario').fill(admin.username);
      await page.getByLabel('Contraseña').fill(admin.password);
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
      await clean('ingreso');
    });

    let code = '';
    await test.step('lista de casos y aviso en vivo', async () => {
      await search(page, uid);
      await expect(page.getByText('Ningún caso coincide con los filtros.')).toBeVisible();
      // Registered by someone else: it reaches this screen through the live stream (/api/events).
      ({ code } = await api.createTicket({ companyId: company.id, description: `Lentes sin graduación en la factura ${uid}` }));
      await expect(toast(page, `registró el caso ${code}`)).toBeVisible();
      await expect(caseRow(page, code)).toBeVisible();
      await clean('lista de casos');
    });

    await test.step('panel del caso, desplegables y adjuntos', async () => {
      await caseRow(page, code).getByRole('button', { name: code, exact: true }).click();
      const panel = casePanel(page);
      await chooseOption(panel.getByRole('combobox', { name: 'Prioridad' }), 'Alta');
      await panel.getByRole('button', { name: 'Actualizar' }).click();
      await expect(toast(page, 'Caso actualizado')).toBeVisible();

      // The thumbnail and the enlarged view are object URLs (blob:).
      await panel.getByLabel('Adjuntar').setInputFiles({ name: 'captura.png', mimeType: 'image/png', buffer: PNG });
      await panel.getByRole('img', { name: 'captura.png' }).click();
      const enlarged = page.getByRole('dialog', { name: 'Imagen: captura.png' });
      await expect(enlarged.getByRole('img', { name: 'captura.png' })).toBeVisible();
      await enlarged.getByRole('button', { name: 'Cerrar' }).click();
      await expect(enlarged).toBeHidden();
      await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
      await expect(panel).toBeHidden();
      await clean('panel del caso');
    });

    await test.step('importación', async () => {
      await page.getByRole('button', { name: 'Importar' }).click();
      const dialog = page.getByRole('dialog', { name: 'Importar hoja de casos' });
      const sheet = new ExcelJS.Workbook();
      const cases = sheet.addWorksheet('Casos');
      cases.addRow(['Fecha', 'Empresa', 'Descripción', 'Estado']);
      cases.addRow([new Date(Date.UTC(2026, 9, 5)), company.name, `Montura rota al entregar ${uid}`, 'Pendiente']);
      const sheetPath = testInfo.outputPath('casos.xlsx');
      await sheet.xlsx.writeFile(sheetPath);
      await dialog.getByLabel('Archivo').setInputFiles(sheetPath);
      await expect(dialog.getByText(`Montura rota al entregar ${uid}`)).toBeVisible();
      await dialog.getByRole('button', { name: 'Cerrar' }).click();
      await expect(dialog).toBeHidden();
      await clean('importación');
    });

    await test.step('diálogo de IA', async () => {
      await page.getByRole('button', { name: 'Nuevo con IA' }).click();
      const dialog = page.getByRole('dialog', { name: 'Nuevo caso con IA' });
      await dialog.getByLabel('Elegir imágenes').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG });
      await expect(dialog.getByRole('img', { name: 'foto.png' })).toBeVisible();
      await dialog.getByRole('button', { name: 'Llenar a mano' }).click();
      const review = page.getByRole('dialog', { name: 'Revisar el caso' });
      await chooseOption(review.getByRole('combobox', { name: 'Empresa' }), company.name, company.name);
      await review.getByRole('button', { name: 'Cerrar' }).click();
      await expect(review).toBeHidden();
      await clean('diálogo de IA');
    });

    await test.step('tablero', async () => {
      await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Tablero' }).click();
      await page.getByRole('searchbox', { name: 'Buscar en el tablero' }).fill(uid);
      await expect(page.getByRole('button', { name: new RegExp(`^${code} `) })).toBeVisible();
      await clean('tablero');
    });

    await test.step('dashboard y sus gráficos', async () => {
      await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Dashboard' }).click();
      await expect(page.getByRole('img', { name: 'Casos por mes, resueltos y abiertos' })).toBeVisible();
      // The dark theme draws the charts again with its colours.
      await page.getByRole('button', { name: 'Tema oscuro' }).click();
      await page.getByRole('button', { name: 'Tema claro' }).click();
      await clean('dashboard');
    });

    await test.step('avisos', async () => {
      await page.getByRole('button', { name: /^Avisos: / }).first().click();
      const reminders = page.getByRole('dialog', { name: 'Avisos' });
      await expect(reminders).toBeVisible();
      await reminders.getByRole('button', { name: 'Cerrar' }).click();
      await expect(reminders).toBeHidden();
      await clean('avisos');
    });

    await test.step('configuración, cada pestaña', async () => {
      await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Configuración' }).click();
      const tabs = page.getByRole('tablist').getByRole('tab');
      await expect(tabs.first()).toBeVisible();
      for (const name of await tabs.allTextContents()) {
        await page.getByRole('tab', { name: name.trim(), exact: true }).click();
        await expect(page.getByRole('tab', { name: name.trim(), exact: true })).toHaveAttribute('aria-selected', 'true');
      }
      await clean('configuración');
    });

    await test.step('logo', async () => {
      try {
        await page.getByRole('tab', { name: 'Logo', exact: true }).click();
        // Made smaller in the browser from an object URL, then shown from the API, also as the icon of the tab.
        await page.getByLabel('Imagen del logo').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: PNG });
        await expect(toast(page, 'Logo actualizado')).toBeVisible();
        await clean('logo');
      } finally {
        // The logo is the same for every test: none stays behind. Removed through the API and not on
        // the screen, where another run of this test could have just removed it.
        await api.attempt('DELETE', '/api/branding/logo');
      }
    });
  });
});
