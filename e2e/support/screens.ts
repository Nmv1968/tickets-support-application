import { createHash } from 'node:crypto';
import ExcelJS from 'exceljs';
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import type { Api, Assignee, Company, FileUpload, SupportType, TestUser, Ticket } from './api';
import { TIME_ZONE } from './env';
import { casePanel, search, selectBox } from './ui';

/** A picture of 1 x 1 pixel: the image of an attachment and of the AI dialog. */
export const PNG: FileUpload = {
  name: 'captura.png',
  mimeType: 'image/png',
  buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
};

/**
 * What the accessibility and layout guards (tests/accessibility.spec.ts, tests/responsive.spec.ts)
 * look at, made by each test for itself: every kind of content a screen shows, at its longest.
 * Names with and without spaces, every status, priority and promise state, chips of extreme
 * colours, inactive entries in each catalog, notes, an attachment and a forgotten case. Whatever
 * another test adds meanwhile is more of the same kinds, so a scan does not depend on it.
 */
export interface Showcase {
  uid: string;
  /** The day of every case here: one of its own, years ago, with no other case, that the dashboard is narrowed to. */
  day: string;
  companies: { long: Company; noSpaces: Company; short: Company; inactive: Company };
  assignee: Assignee;
  inactiveAssignee: Assignee;
  supportTypes: SupportType[];
  inactiveSupportType: SupportType;
  module: string;
  inactiveModule: string;
  /** The case with every field filled, notes, a reply and an attachment. */
  full: Ticket;
  /** The ids of the cases the list and the board show for `uid`, the imported one included, in order. */
  listed: number[];
}

/** Today in the zone of the application, and a day `days` away from it, as AAAA-MM-DD. */
function dayFrom(days: number, from = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE }).format(new Date())): string {
  const date = new Date(`${from}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * A day between 2000 and 2009 with no case on it, taken from `uid`, in the stretch of those years of
 * the worker that makes it: two showcases made at once are made by two workers, whose stretches do
 * not overlap, and a worker makes one at a time. Taken from `uid` alone, two made at once started
 * now and then from the same day, and the dashboard of each counted the cases of both ("Total 10").
 */
async function freeDay(api: Api, uid: string): Promise<string> {
  const { parallelIndex, config } = test.info();
  const stretch = Math.max(1, Math.floor(3650 / Math.max(1, config.workers)));
  let day = dayFrom(parallelIndex * stretch + (createHash('sha256').update(uid).digest().readUInt32BE(0) % stretch), '2000-01-01');
  while ((await api.casesBetween(day, day)) > 0) day = dayFrom(1, day);
  return day;
}

const DESCRIPTION = [
  'El cliente reporta que al emitir una factura electrónica desde el módulo de ventas el sistema muestra «No se pudo firmar el comprobante» y no deja continuar.',
  'Se revisó el certificado de firma y está vigente; el error persiste solo en la sucursal del norte, después de reiniciar el servicio de sincronización.',
  'La usuaria indica además que el reporte de cartera vencida tarda más de diez minutos en generarse y a veces el navegador se cierra sin aviso.',
].join(' ');

/** A word no screen can wrap unless it breaks it: an address with its query, as people paste them. */
const LONG_WORD = 'https://erp.ejemplo.test/ventas/facturacion/electronica/comprobantes/autorizacion?claveDeAcceso=1411202601179999999900120010020000123451234567813&ambiente=pruebas';

const REPLY =
  'Estimado cliente: el inconveniente reportado ya fue solucionado. El equipo de soporte corrigió la configuración de su empresa y verificó que los comprobantes se emiten con normalidad. Si vuelve a ocurrir, responda a este mensaje con una captura de pantalla y la hora aproximada del error.';

/** Makes the data of a showcase through the API, in a few seconds. */
export async function makeShowcase(api: Api, uid: string): Promise<Showcase> {
  const day = await freeDay(api, uid);
  const [long, noSpaces, short, inactive] = await Promise.all([
    api.createCompany(`Comercializadora Demo de Productos Agroindustriales y Alimenticios del Litoral, la Sierra y la Amazonía, con Sucursales en Todo el País ${uid} S.A.`),
    api.createCompany(`DistribuidoraDemoDeRepuestosAutomotricesYMaquinariaPesadaSinUnSoloEspacio${uid}CíaLtda`),
    api.createCompany(`Ñu Demo ${uid}`),
    api.createCompany(`Óptica Demo que ya no opera ${uid}`),
  ]);
  const [assignee, inactiveAssignee] = await Promise.all([
    api.createAssignee(`María de los Ángeles Villavicencio-Quiñónez de la Torre ${uid}`),
    api.createAssignee(`Trinidad Benítez Demo ${uid}`),
  ]);
  // The extremes of a chip: white, black and a pale yellow, a strong colour, and a long name.
  const supportTypes = await Promise.all([
    api.createSupportType(`Blanco demo ${uid}`, '#ffffff'),
    api.createSupportType(`Negro demo ${uid}`, '#000000'),
    api.createSupportType(`Amarillo claro demo ${uid}`, '#fff7a8'),
    api.createSupportType(`Violeta demo ${uid}`, '#7c3aed'),
    api.createSupportType(`Capacitación del personal nuevo de caja ${uid}`, '#0d9488'),
  ]);
  const inactiveSupportType = await api.createSupportType(`Gris inactivo demo ${uid}`, '#d4d4d4');
  const parent = await api.createModule(`Facturación electrónica demo ${uid}`);
  const moduleName = `Notas de crédito, débito y retenciones ${uid}`;
  const inactiveModule = `Módulo retirado demo ${uid}`;
  const [module, retired] = await Promise.all([api.createModule(moduleName, parent.id), api.createModule(inactiveModule)]);
  await Promise.all([
    api.deactivate('companies', inactive.id),
    api.deactivate('assignees', inactiveAssignee.id),
    api.deactivate('support-types', inactiveSupportType.id),
    api.deactivate('modules', retired.id),
  ]);

  const [full] = await Promise.all([
    api.createTicket({
      companyId: long.id,
      description: `${DESCRIPTION}\n\nEnlace del error: ${LONG_WORD}\n\nRef. ${uid}`,
      date: day,
      status: 'PENDING',
      priority: 'CRITICAL',
      assigneeId: assignee.id,
      moduleId: module.id,
      supportTypeIds: supportTypes.map((type) => type.id),
      promisedDate: dayFrom(0),
      estimatedMinutes: 90,
      customerReply: REPLY,
    }),
    api.createTicket({
      companyId: noSpaces.id,
      description: `Promesa vencida: el cierre de caja deja una diferencia de un centavo ${uid}`,
      date: day,
      status: 'UNRESOLVED',
      priority: 'HIGH',
      supportTypeIds: [supportTypes[1].id, supportTypes[2].id],
      promisedDate: dayFrom(-3),
    }),
    api.createTicket({ companyId: short.id, description: `Resuelto: la impresora térmica ya corta el ticket ${uid}`, date: day, status: 'RESOLVED', priority: 'LOW', supportTypeIds: [supportTypes[0].id], customerReply: REPLY }),
    api.createTicket({ companyId: short.id, description: `Pendiente sin más datos ${uid}`, date: day, priority: 'MEDIUM' }),
  ]);
  await Promise.all([
    api.addNote(full.id, `Se pidió acceso remoto para revisar los permisos del rol «Cajero». ${DESCRIPTION}`),
    api.addNote(full.id, `Traza: ${LONG_WORD}`),
    api.attach(full.id, [PNG, { name: 'registro de errores de la sucursal del norte.txt', mimeType: 'text/plain', buffer: Buffer.from(`Registro ${uid}`) }]),
  ]);

  // Imported with its old day, an open case is forgotten at once: its last movement is that day.
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Casos');
  sheet.addRow(['Fecha', 'Empresa', 'Descripción', 'Estado']);
  sheet.addRow([new Date(`${day}T12:00:00Z`), short.name, `Olvidado: no llegan los correos de las facturas ${uid}`, 'Pendiente']);
  await api.importSheet({ name: 'olvidado.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) });
  const listed = (await api.searchTickets(uid)).map((ticket) => ticket.id).sort((a, b) => a - b);
  expect(listed, 'los casos de la muestra').toHaveLength(5);

  return {
    uid,
    day,
    companies: { long, noSpaces, short, inactive },
    assignee,
    inactiveAssignee,
    supportTypes,
    inactiveSupportType,
    module: moduleName,
    inactiveModule,
    full,
    listed,
  };
}

/**
 * Readies a page for the guards, before it opens anything: it sees only the changes of the
 * showcase, and counts its requests to the API for `settled`.
 *
 * The other tests write meanwhile, and the live stream (/api/events) brings their changes to every
 * screen: a notice for each case they register, which piled up over the controls, and lists drawn
 * again in the middle of a scan. The stream passes on here only the changes of the cases of the
 * showcase, which the test makes from outside the page (the notice of a case changed elsewhere).
 */
export async function watchShowcase(page: Page, showcase: Showcase): Promise<void> {
  await page.addInitScript((own) => {
    const fetchFromPage = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const response = await fetchFromPage(input, init);
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (!url.includes('/api/events') || !response.body) return response;
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let pending = '';
      // An event is a block of lines that ends in an empty line; a block without data keeps the stream open.
      const kept = (block: string): boolean => {
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('');
        if (!data) return true;
        try {
          const change = JSON.parse(data) as { scope?: string; ticketId?: number };
          return change.scope === 'tickets' && own.includes(change.ticketId ?? 0);
        } catch {
          return false;
        }
      };
      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const blocks = (pending + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n').split('\n\n');
            pending = blocks.pop() ?? '';
            for (const block of blocks) if (kept(block)) controller.enqueue(encoder.encode(`${block}\n\n`));
          },
        }),
      );
      return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
    };
  }, showcase.listed);
  await trackApi(page);
}

/**
 * Counts, in the page, the requests to the API that have not been answered yet (the live stream
 * aside, which stays open): `settled` waits for them. Called before the page opens anything.
 */
async function trackApi(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let pending = 0;
    (window as unknown as { pendingApi: () => number }).pendingApi = () => pending;
    const tracked = new WeakSet<XMLHttpRequest>();
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['open']>) {
      if (String(args[1]).includes('/api/')) tracked.add(this);
      return open.apply(this, args);
    } as XMLHttpRequest['open'];
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args: Parameters<XMLHttpRequest['send']>) {
      if (tracked.has(this)) {
        pending++;
        this.addEventListener('loadend', () => pending--, { once: true });
      }
      return send.apply(this, args);
    };
  });
}

/**
 * Waits until the screen shows what it asked the API for: no request left without its answer,
 * and two frames for Angular to draw them.
 */
export async function settled(page: Page): Promise<void> {
  const frames = () => page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
  await frames();
  await page.waitForFunction(() => (window as unknown as { pendingApi?: () => number }).pendingApi?.() === 0);
  await frames();
}

/** The cases on screen, by the id every row, card and tile carries. */
function shownCases(page: Page): Promise<number[]> {
  return page.locator('[data-case-id]').evaluateAll((elements) => elements.map((element) => Number(element.getAttribute('data-case-id'))).sort((a, b) => a - b));
}

/** The case list with the cases of the showcase only, as the screen draws it: the table, or a card each. */
export async function openList(page: Page, showcase: Showcase): Promise<void> {
  await page.goto('/casos');
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
  await search(page, showcase.uid);
  await expect.poll(() => shownCases(page)).toEqual(showcase.listed);
  await settled(page);
}

/** The panel of the case with everything, over the list of the showcase, with its history open. */
export async function openFullCase(page: Page, showcase: Showcase): Promise<Locator> {
  await openList(page, showcase);
  await page.locator(`[data-case-id="${showcase.full.id}"]`).click();
  const panel = casePanel(page);
  await expect(panel).toHaveAccessibleName(`Caso ${showcase.full.code}`);
  await expect(panel.getByRole('img', { name: PNG.name })).toBeVisible();
  await panel.getByText(/^Historial de cambios/).click();
  await settled(page);
  return panel;
}

/** The board with the cases of the showcase only. */
export async function openBoard(page: Page, showcase: Showcase): Promise<void> {
  await page.goto('/tablero');
  await expect(page.getByRole('heading', { name: 'Tablero' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Buscar en el tablero' }).fill(showcase.uid);
  await expect.poll(() => shownCases(page)).toEqual(showcase.listed);
  await settled(page);
}

/** The dashboard of the day of the showcase: its cases and nobody else's, every chart drawn. */
export async function openDashboard(page: Page, showcase: Showcase): Promise<void> {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await page.getByLabel('Desde', { exact: true }).fill(showcase.day);
  await page.getByLabel('Hasta', { exact: true }).fill(showcase.day);
  await expect(page.getByRole('img', { name: 'Casos por tipo de soporte' })).toBeVisible();
  await settled(page);
  await expect(page.locator('.card').filter({ hasText: /^\s*Total/ })).toContainText(String(showcase.listed.length));
}

/** The tabs of Configuración, each with what shows that its content came. */
export function settingsTabs(showcase: Showcase, user: TestUser): { name: string; admin: boolean; ready: (page: Page) => Locator }[] {
  const panel = (page: Page) => page.getByRole('tabpanel');
  return [
    { name: 'Usuarios', admin: true, ready: (page) => panel(page).getByRole('row').filter({ hasText: user.username }) },
    { name: 'Responsables', admin: false, ready: (page) => panel(page).getByRole('button', { name: `Activar ${showcase.inactiveAssignee.name}` }) },
    { name: 'Empresas', admin: false, ready: (page) => panel(page).getByRole('button', { name: `Activar ${showcase.companies.inactive.name}` }) },
    { name: 'Tipos de soporte', admin: false, ready: (page) => panel(page).getByRole('button', { name: `Activar ${showcase.inactiveSupportType.name}` }) },
    { name: 'Módulos', admin: false, ready: (page) => panel(page).getByRole('button', { name: `Activar ${showcase.inactiveModule}` }) },
    { name: 'SLA', admin: true, ready: (page) => panel(page).getByRole('heading', { name: 'Horas para resolver, por prioridad' }) },
    { name: 'Recordatorios', admin: true, ready: (page) => panel(page).getByRole('heading', { name: 'Casos olvidados' }) },
    { name: 'IA', admin: true, ready: (page) => panel(page).getByRole('heading', { name: 'Proveedor de IA' }) },
    { name: 'Logo', admin: true, ready: (page) => panel(page).getByRole('heading', { name: 'Logo de la empresa' }) },
    { name: 'Mi cuenta', admin: false, ready: (page) => panel(page).getByRole('heading', { name: 'Cambiar mi contraseña' }) },
  ];
}

/** Opens a tab of Configuración and waits for its content. */
export async function openSettingsTab(page: Page, tab: { name: string; ready: (page: Page) => Locator }): Promise<void> {
  await page.getByRole('tab', { name: tab.name, exact: true }).click();
  await expect(page.getByRole('tab', { name: tab.name, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(tab.ready(page)).toBeVisible();
  await settled(page);
}

/** A sheet for the dialog "Importar": a row it takes, and rows it rejects for each kind of reason. */
async function sheetWithRejections(showcase: Showcase): Promise<FileUpload> {
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet('Casos');
  sheet.addRow(['Fecha', 'Empresa', 'Descripción', 'Estado', 'Prioridad', 'Tipo de soporte']);
  sheet.addRow([new Date(`${showcase.day}T12:00:00Z`), showcase.companies.long.name, `Fila que se importa ${showcase.uid}`, 'Pendiente', 'Alta', showcase.supportTypes[4].name]);
  sheet.addRow([new Date(`${showcase.day}T12:00:00Z`), `Empresa que no existe con un nombre bastante largo ${showcase.uid}`, `Fila de una empresa que no existe ${showcase.uid}`, 'Pendiente', '', '']);
  sheet.addRow([new Date(`${showcase.day}T12:00:00Z`), showcase.companies.noSpaces.name, `Fila con prioridad y tipo desconocidos ${showcase.uid}`, 'Archivado', 'Urgentísima', `TipoQueNoExisteSinEspacios${showcase.uid}`]);
  return { name: 'casos con rechazos.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(await book.xlsx.writeBuffer()) };
}

/** The dialog "Importar" with the preview of a sheet that has rejected rows. */
export async function openImport(page: Page, showcase: Showcase): Promise<Locator> {
  await page.getByRole('button', { name: 'Importar', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar hoja de casos' });
  await dialog.getByLabel('Archivo').setInputFiles(await sheetWithRejections(showcase));
  await expect(dialog.getByRole('region', { name: /^Filas rechazadas \(\d+\)$/ })).toBeVisible();
  await settled(page);
  return dialog;
}

/** The dialog "Nuevo con IA" with an image, ready to be analysed. */
export async function openAiDialog(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /IA$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Nuevo caso con IA' });
  await dialog.getByLabel('Elegir imágenes').setInputFiles(PNG);
  await expect(dialog.getByRole('img', { name: PNG.name })).toBeVisible();
  await settled(page);
  return dialog;
}

/** The second step of the dialog, filled by hand, after "Guardar caso" with the company missing. */
export async function openAiReview(page: Page): Promise<Locator> {
  await page.getByRole('dialog', { name: 'Nuevo caso con IA' }).getByRole('button', { name: 'Llenar a mano' }).click();
  const dialog = page.getByRole('dialog', { name: 'Revisar el caso' });
  await dialog.getByRole('button', { name: 'Guardar caso' }).click();
  await expect(dialog.getByText('Elige una empresa.')).toBeVisible();
  await settled(page);
  return dialog;
}

/** The panel of the bell. */
export async function openBell(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: /^Avisos: / }).filter({ visible: true }).click();
  const bell = page.getByRole('dialog', { name: 'Avisos' });
  await expect(bell.getByRole('heading', { name: /^Casos olvidados/ })).toBeVisible();
  await settled(page);
  return bell;
}

/** The open list of an ng-select, which hangs from the body. */
export const OPEN_LIST = '.ng-dropdown-panel';

/** Opens the list of a select, as a press on it does. */
export async function openSelect(combobox: Locator): Promise<void> {
  await selectBox(combobox).locator('.ng-select-container').click();
  await expect(combobox.page().locator(OPEN_LIST)).toBeVisible();
  await settled(combobox.page());
}

/**
 * Escape closes the list and stops there (core/select.ts): the dialog around it stays. A list that
 * closed already (a scroll of the dialog closes it) is left as it is: Escape would close the dialog.
 */
export async function closeSelect(combobox: Locator): Promise<void> {
  const list = combobox.page().locator(OPEN_LIST);
  // The scroll events of the page have reached the select by then.
  await settled(combobox.page());
  if (await list.isVisible()) await combobox.page().keyboard.press('Escape');
  await expect(list).toBeHidden();
}
