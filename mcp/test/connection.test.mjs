// How server.mjs finds the API and its credentials, each case with a server of its own.
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, test } from 'node:test';
import { TEST_PASSWORD, TEST_USERNAME, startFakeApi } from './fake-api.mjs';
import { startMcp } from './mcp-client.mjs';

let api;
let dir;
const started = [];

before(async () => {
  api = await startFakeApi();
  dir = await mkdtemp(join(tmpdir(), 'soporte-mcp-pruebas-'));
});

after(async () => {
  await Promise.all(started.map((mcp) => mcp.close()));
  await api?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

beforeEach(() => api.reset());

async function mcpWith(env) {
  const mcp = await startMcp(env);
  started.push(mcp);
  return mcp;
}

test('the first call logs in once, even when it makes several requests at a time', async () => {
  const mcp = await mcpWith({ SUPPORT_API_URL: `${api.url}/`, SUPPORT_USERNAME: TEST_USERNAME, SUPPORT_PASSWORD: TEST_PASSWORD });
  const result = await mcp.call('listar_catalogos');
  assert.equal(result.isError, false, result.text);
  assert.equal(api.calls('POST', 'auth/login').length, 1);
  // The slash at the end of the URL is not doubled.
  assert.deepEqual(api.requests.map((r) => r.path).sort(), ['assignees', 'auth/login', 'companies', 'modules', 'support-types']);
});

test('reads the credentials from SUPPORT_ENV_FILE, and SUPPORT_USERNAME / SUPPORT_PASSWORD win over it', async () => {
  const file = join(dir, 'pruebas.env');
  await writeFile(file, `# assistant\nMCP_USERNAME=${TEST_USERNAME}\nMCP_PASSWORD="${TEST_PASSWORD}"\n`);
  const fromFile = await mcpWith({ SUPPORT_API_URL: api.url, SUPPORT_ENV_FILE: file });
  assert.equal((await fromFile.call('ver_caso', { caso: '7' })).isError, false);
  assert.deepEqual(api.calls('POST', 'auth/login')[0].body, { username: TEST_USERNAME, password: TEST_PASSWORD });

  api.reset();
  const overridden = await mcpWith({ SUPPORT_API_URL: api.url, SUPPORT_ENV_FILE: file, SUPPORT_USERNAME: 'otro-usuario' });
  const result = await overridden.call('ver_caso', { caso: '7' });
  assert.equal(result.isError, true);
  assert.match(result.text, /rechazó el ingreso del usuario "otro-usuario" \(HTTP 401\)/);
  assert.deepEqual(api.calls('POST', 'auth/login')[0].body, { username: 'otro-usuario', password: TEST_PASSWORD });
});

test('without a password it says where to set it and calls nothing', async () => {
  const mcp = await mcpWith({ SUPPORT_API_URL: api.url });
  const result = await mcp.call('buscar_casos');
  assert.equal(result.isError, true);
  assert.match(result.text, /Falta la contraseña del usuario asistente\. Define MCP_PASSWORD/);
  assert.equal(api.requests.length, 0);
});

test('an API that is not running is reported with its URL', async () => {
  // A port that was free a moment ago: nothing answers there.
  const port = await new Promise((done) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port: free } = probe.address();
      probe.close(() => done(free));
    });
  });
  const url = `http://127.0.0.1:${port}/api`;
  const mcp = await mcpWith({ SUPPORT_API_URL: url, SUPPORT_USERNAME: TEST_USERNAME, SUPPORT_PASSWORD: TEST_PASSWORD });
  const result = await mcp.call('listar_catalogos');
  assert.equal(result.isError, true);
  assert.equal(result.text, `Error: No se pudo conectar con el sistema de soporte en ${url}. Verifica que esté encendido.`);
});
