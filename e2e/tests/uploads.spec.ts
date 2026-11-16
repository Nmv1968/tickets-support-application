import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { basename, join } from 'node:path';
import ExcelJS from 'exceljs';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BASE_URL, E2E_DIR } from '../support/env';
import { expect, test } from '../support/fixtures';
import { adminToken } from '../support/session';
import { openCase, toast } from '../support/ui';

const MB = 1024 * 1024;
/** What the API takes in one upload of attachments (api/src/tickets/attachments.controller.ts). */
const MAX_FILES = 10;
const MAX_FILE_BYTES = 15 * MB;
/** client_max_body_size of web/nginx.conf: those files, and at most 1 MB for the headers of the form around them. */
const NGINX_LIMIT = 151 * MB;

interface Attachment {
  id: number;
  filename: string;
  size: number;
}

const session = (): Record<string, string> => ({ Authorization: `Bearer ${adminToken()}` });

/** A file of the repository, as text with \n line ends whatever the checkout left. */
const repoFile = (...path: string[]): string => readFileSync(join(E2E_DIR, '..', ...path), 'utf8').split('\r\n').join('\n');

async function attachments(request: APIRequestContext, ticketId: number): Promise<Attachment[]> {
  const answer = await request.get(`/api/tickets/${ticketId}`, { headers: session() });
  expect(answer.ok()).toBe(true);
  return ((await answer.json()) as { attachments: Attachment[] }).attachments;
}

/** The preview of an import of the sheet in `path`, which writes nothing. */
function importPreview(request: APIRequestContext, path: string): Promise<APIResponse> {
  const file = { name: basename(path), mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: readFileSync(path) };
  return request.post('/api/import', { headers: session(), params: { dryRun: '1' }, multipart: { file }, timeout: 150_000 });
}

/**
 * What nginx answers to a request that says it carries `length` bytes, sent without them: a body
 * over its limit is refused on what the request says, before any of it arrives.
 */
function declaredUpload(path: string, length: number): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(new URL(path, BASE_URL), {
      method: 'POST',
      headers: { ...session(), 'Content-Type': 'multipart/form-data; boundary=limite', 'Content-Length': String(length) },
    });
    req.on('response', (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => (body += chunk));
      res.on('end', () => {
        resolve({ status: res.statusCode ?? 0, headers: res.headers, body });
        req.destroy();
      });
    });
    req.on('error', reject);
    req.flushHeaders();
  });
}

test('nginx admite el envío más grande del API y poco más, y el API tiene un límite de memoria sin swap', () => {
  // The upload of attachments is the largest request: its limits as the API declares them.
  const controller = repoFile('api', 'src', 'tickets', 'attachments.controller.ts');
  expect(controller).toContain(`const MAX_FILE_BYTES = ${MAX_FILE_BYTES / MB} * 1024 * 1024;`);
  expect(controller).toContain(`const MAX_FILES = ${MAX_FILES};`);
  const nginx = repoFile('web', 'nginx.conf')
    .split('\n')
    .map((line) => line.trim());
  expect(NGINX_LIMIT).toBe(Math.ceil((MAX_FILES * MAX_FILE_BYTES + 1) / MB) * MB);
  expect(nginx).toContain(`client_max_body_size ${NGINX_LIMIT / MB}m;`);

  // The api service of docker-compose.yml: its lines, from "  api:" to the next service.
  const lines = repoFile('docker-compose.yml').split('\n');
  const start = lines.indexOf('  api:');
  const end = lines.findIndex((line, index) => index > start && /^ {2}\S/.test(line));
  const api = lines.slice(start + 1, end).map((line) => line.trim());
  expect(start).toBeGreaterThan(0);
  expect(api).toContain('mem_limit: 1536m');
  // Without it Docker gives the container as much swap again, and a full API would crawl instead of starting again.
  expect(api).toContain('memswap_limit: 1536m');
});

test('el envío más grande de adjuntos pasa por nginx y el API, y uno mayor recibe un 413 en español', async ({ request, api, uid }) => {
  test.setTimeout(120_000);
  const company = await api.createCompany(`Litografía Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `Adjuntos grandes ${uid}` });

  // Ten files of 15 MB, each of its own byte: 150 MB in one request, the most the web or the MCP send.
  const files = Array.from({ length: MAX_FILES }, (_, index) => ({ name: `registro-${index}.bin`, buffer: Buffer.alloc(MAX_FILE_BYTES, index) }));
  const form = new FormData();
  for (const file of files) form.append('files', new Blob([file.buffer], { type: 'application/octet-stream' }), file.name);
  const answer = await request.post(`/api/tickets/${ticket.id}/attachments`, { headers: session(), multipart: form, timeout: 90_000 });
  expect(answer.status(), await answer.text()).toBe(201);
  const stored = await attachments(request, ticket.id);
  expect(stored.map((file) => file.size)).toEqual(Array(MAX_FILES).fill(MAX_FILE_BYTES));
  const seventh = stored.find((file) => file.filename === 'registro-7.bin');
  const download = await request.get(`/api/attachments/${seventh?.id}`, { headers: session() });
  expect((await download.body()).equals(files[7].buffer)).toBe(true);

  // One byte over what nginx admits: refused before the body is sent, in the shape of the API's errors.
  const refused = await declaredUpload(`/api/tickets/${ticket.id}/attachments`, NGINX_LIMIT + 1);
  expect(refused.status).toBe(413);
  expect(refused.headers['content-type']).toBe('application/json; charset=utf-8');
  expect(JSON.parse(refused.body)).toEqual({
    statusCode: 413,
    error: 'Payload Too Large',
    message: 'Lo enviado pesa más de 151 MB, lo máximo que el servidor recibe de una vez. Cada adjunto puede pesar hasta 15 MB.',
  });
  // Like every answer of nginx, with the security headers (web/security-headers.conf).
  expect(refused.headers['content-security-policy']).toContain("default-src 'self'");
  expect(refused.headers['x-content-type-options']).toBe('nosniff');
  expect(await attachments(request, ticket.id)).toHaveLength(MAX_FILES);
});

test('un adjunto de más de 15 MB se rechaza con un aviso en español y el caso queda como estaba', async ({ page, api, uid }) => {
  const company = await api.createCompany(`Encuadernadora Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `Adjunto pesado ${uid}` });

  const panel = await openCase(page, ticket.code);
  await panel.getByLabel('Adjuntar').setInputFiles({ name: 'video.mp4', mimeType: 'video/mp4', buffer: Buffer.alloc(MAX_FILE_BYTES + 1) });

  await expect(toast(page, 'Cada archivo puede pesar hasta 15 MB.')).toBeVisible();
  await expect(panel.getByText('video.mp4')).toHaveCount(0);
  expect(await attachments(page.request, ticket.id)).toEqual([]);
});

test('una hoja que ocupa más de 50 MB sin comprimir se rechaza en español, aunque el archivo pese poco', async ({ request, uid }, testInfo) => {
  test.setTimeout(120_000);
  // 11,000 descriptions of their own, of some 4,800 characters: about 53 MB of text, which compresses to little.
  const path = testInfo.outputPath('casos-largos.xlsx');
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: false });
  const sheet = book.addWorksheet('Casos');
  sheet.addRow(['Fecha', 'Empresa', 'Descripción']).commit();
  for (let index = 0; index < 11_000; index++) sheet.addRow([new Date(Date.UTC(2026, 9, 5)), `Empresa ${uid}`, `${index} ${'No imprime la factura. '.repeat(210)}`]).commit();
  sheet.commit();
  await book.commit();

  const answer = await importPreview(request, path);

  expect(answer.status()).toBe(400);
  expect(((await answer.json()) as { message: string }).message).toMatch(
    /^El archivo Excel ocupa 5\d MB sin comprimir y se pueden importar hasta 50 MB a la vez\. Divídelo en varios archivos\.$/,
  );
});

// The memory of the API container (mem_limit of docker-compose.yml) is sized for this sheet: the
// heaviest per byte that the import accepts, 20,000 rows of a hundred small numbers, just under
// 50 MB uncompressed. Out of memory, the API would never answer and its container would stop (in
// this stack nothing starts it again).
test('la hoja más pesada que el API acepta se lee dentro de la memoria de su contenedor', async ({ request }, testInfo) => {
  test.setTimeout(180_000);
  const path = testInfo.outputPath('celdas.xlsx');
  const book = new ExcelJS.stream.xlsx.WorkbookWriter({ filename: path, useStyles: false, useSharedStrings: false });
  const sheet = book.addWorksheet('Casos');
  const columns = 97;
  sheet.addRow(['Fecha', 'Empresa', 'Descripción', ...Array.from({ length: columns - 3 }, (_, index) => `Dato ${index + 1}`)]).commit();
  for (let row = 0; row < 20_000; row++) sheet.addRow(Array.from({ length: columns }, (_, index) => (row + index) % 10)).commit();
  sheet.commit();
  await book.commit();

  const answer = await importPreview(request, path);

  expect(answer.status(), await answer.text()).toBe(200);
  expect(await answer.json()).toMatchObject({ totalRows: 20_000 });
  // And it goes on answering.
  expect((await request.get('/api/branding')).ok()).toBe(true);
});
