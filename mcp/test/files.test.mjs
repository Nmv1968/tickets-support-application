// Which files adjuntar_archivos and crear_caso may send. The paths come from the assistant, which
// may have read them in a case it was asked to register: each one is checked by its name before
// anything is read, then by the file it really leads to, before it leaves the machine.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, sep } from 'node:path';
import { after, before, beforeEach, describe, test } from 'node:test';
import { TEST_PASSWORD, TEST_USERNAME, startFakeApi } from './fake-api.mjs';
import { startMcp } from './mcp-client.mjs';

/** The per-file limit of the API. */
const LIMIT = 15 * 1024 * 1024;
const windows = process.platform === 'win32';

let api;
let files;
let mcp;
const started = [];

/** A server of its own: the fake API and its user, plus `env`. */
async function mcpWith(env = {}) {
  const server = await startMcp({ SUPPORT_API_URL: api.url, SUPPORT_USERNAME: TEST_USERNAME, SUPPORT_PASSWORD: TEST_PASSWORD, ...env });
  started.push(server);
  return server;
}

before(async () => {
  api = await startFakeApi();
  files = await mkdtemp(join(tmpdir(), 'soporte-mcp-archivos-'));
  mcp = await mcpWith();
});

after(async () => {
  await Promise.all(started.map((server) => server.close()));
  await api?.close();
  if (files) await rm(files, { recursive: true, force: true });
});

beforeEach(() => api.reset());

/** Writes a file at `path` (with "/") inside the test folder, and the folders it needs. Returns its full path. */
async function file(path, content = 'contenido') {
  const full = join(files, ...path.split('/'));
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, content);
  return full;
}

const uploads = () => api.calls('POST', 'tickets/7/attachments');

/** `server` refused to attach `paths`, saying every one of `fragments`, and uploaded nothing. */
async function refused(server, paths, ...fragments) {
  const result = await server.call('adjuntar_archivos', { caso: '7', rutas: paths });
  assert.equal(result.isError, true, `expected a refusal, got: ${result.text}`);
  for (const fragment of [...fragments, 'No se adjuntó ningún archivo.']) assert.ok(result.text.includes(fragment), `"${fragment}" missing in: ${result.text}`);
  assert.equal(uploads().length, 0, 'nothing may be uploaded');
  return result.text;
}

/** `server` attached `paths`: the files the API got. */
async function accepted(server, paths) {
  const result = await server.call('adjuntar_archivos', { caso: '7', rutas: paths });
  assert.equal(result.isError, false, result.text);
  assert.equal(uploads().length, 1);
  return uploads()[0].body.files;
}

describe('the path the assistant gives', () => {
  test('only the types of the list are sent, whatever the case of the extension', async () => {
    const others = [await file('registro.log'), await file('id_rsa'), await file('instalador.exe'), await file('pantalla.png.exe')];
    const text = await refused(mcp, others);
    for (const path of others) assert.ok(text.includes(`No se adjunta "${path}": no es de un tipo que se adjunte (solo PNG, JPG, JPEG, WEBP, GIF, PDF o TXT).`), text);

    const names = ['a.PNG', 'b.jpg', 'c.Jpeg', 'd.webp', 'e.gif', 'f.pdf', 'g.TXT'];
    const sent = await accepted(mcp, await Promise.all(names.map((name) => file(name))));
    assert.deepEqual(
      sent.map(({ name, type }) => [name, type]),
      [
        ['a.PNG', 'image/png'],
        ['b.jpg', 'image/jpeg'],
        ['c.Jpeg', 'image/jpeg'],
        ['d.webp', 'image/webp'],
        ['e.gif', 'image/gif'],
        ['f.pdf', 'application/pdf'],
        ['g.TXT', 'text/plain'],
      ],
    );
  });

  test('a hidden file, or a file inside a hidden folder, is refused', async () => {
    await file('captura.png');
    await mkdir(join(files, 'fotos'), { recursive: true });
    const hidden = [
      await file('.env'),
      await file('.secreto.png'),
      await file('.ssh/clave.png'),
      await file('proyecto/.git/captura.png'),
      // `..` and `.` are segments that start with a dot too, even when they lead to a visible file.
      [files, 'fotos', '..', 'captura.png'].join(sep),
      [files, '.', 'captura.png'].join(sep),
    ];
    const text = await refused(mcp, hidden);
    for (const path of hidden) assert.ok(text.includes(`No se adjunta "${path}": es un archivo oculto o está dentro de una carpeta oculta (empieza con punto).`), text);
  });

  test('a relative path is refused: the folder it would be read from is unknown', async () => {
    await refused(mcp, ['captura.png', 'fotos/captura.png'], 'No se adjunta "captura.png": indica la ruta completa del archivo.', 'No se adjunta "fotos/captura.png"');
  });

  test('a file over the limit of the API is refused before it is read; one at the limit is sent', async () => {
    const big = await file('grande.pdf', '');
    await truncate(big, LIMIT + 1);
    await refused(mcp, [big], `No se adjunta "${big}": pesa 15,1 MB y el máximo por archivo es 15 MB.`);

    const exact = await file('justo.pdf', '');
    await truncate(exact, LIMIT);
    const [sent] = await accepted(mcp, [exact]);
    assert.equal(sent.size, LIMIT);
  });

  test('a folder is not a file', async () => {
    const folder = join(files, 'carpeta.png');
    await mkdir(folder, { recursive: true });
    await refused(mcp, [folder], `No se adjunta "${folder}": no es un archivo.`);
  });

  test('every refused file is reported, and none is sent when one of them is refused', async () => {
    const good = await file('bien.png');
    const wrong = await file('mal.exe');
    const missing = join(files, 'no-existe.png');
    const text = await refused(mcp, [good, wrong, missing], `No se adjunta "${wrong}"`, `No se pudo leer el archivo "${missing}".`, 'no busques otra ruta por tu cuenta');
    assert.ok(!text.includes(good), 'the file that may be sent is not among the problems');
  });

  test('more files than the API takes in one request are refused by the schema', async () => {
    const path = await file('una.png');
    const result = await mcp.call('adjuntar_archivos', { caso: '7', rutas: Array(11).fill(path) });
    assert.equal(result.isError, true);
    assert.equal(uploads().length, 0);
  });

  test('crear_caso registers the case and says why its files were not attached', async () => {
    const result = await mcp.call('crear_caso', { empresa: 'Acme Logística', descripcion: 'Error.', imagenes: [await file('.ssh/id_rsa.png')] });
    assert.equal(result.isError, false, result.text);
    const created = result.json();
    assert.equal(created.codigo, 'SOP-00021');
    assert.match(created.aviso, /^El caso se registró, pero no se pudieron adjuntar los archivos: No se adjunta ".+": es un archivo oculto/);
    assert.equal(api.calls('POST', 'tickets/21/attachments').length, 0);
  });

  test('the tools tell the assistant which files are attached', async () => {
    const { tools } = await mcp.client.listTools();
    const attach = tools.find((t) => t.name === 'adjuntar_archivos');
    assert.match(attach.description, /PNG, JPG, JPEG, WEBP, GIF, PDF o TXT, máximo 15 MB por archivo/);
    assert.match(attach.description, /ocultos/);
    const images = tools.find((t) => t.name === 'crear_caso').inputSchema.properties.imagenes;
    assert.match(images.description, /PNG, JPG, JPEG, WEBP, GIF, PDF o TXT, hasta 15 MB/);
    assert.equal(images.maxItems, 10);
  });
});

describe('links', () => {
  test('a link to a folder is judged by the folder it leads to', async () => {
    await file('.oculta/captura.png');
    const link = join(files, 'enlace-carpeta');
    // A junction on Windows, where it needs no special rights; a link to a folder elsewhere.
    await symlink(join(files, '.oculta'), link, 'junction');
    await refused(mcp, [join(link, 'captura.png')], `No se adjunta "${join(link, 'captura.png')}": su ubicación real, "`, 'es un archivo oculto o está dentro de una carpeta oculta');
  });

  test('a link to a file is judged by that file', async (t) => {
    const secret = await file('.ssh/id_ed25519', 'clave privada');
    const program = await file('programa.exe');
    const toSecret = join(files, 'foto.png');
    const toProgram = join(files, 'imagen.png');
    try {
      await symlink(secret, toSecret, 'file');
      await symlink(program, toProgram, 'file');
    } catch (error) {
      if (error.code === 'EPERM') return t.skip('this user may not create links to files');
      throw error;
    }
    await refused(mcp, [toSecret], `No se adjunta "${toSecret}": su ubicación real, "`, 'oculta');
    await refused(mcp, [toProgram], 'no es de un tipo que se adjunte');
  });
});

describe('network and device paths', { skip: !windows && 'they exist only on Windows' }, () => {
  test('are refused before anything is read', async () => {
    const local = await file('red.png');
    const paths = ['\\\\localhost\\no-existe\\red.png', '//localhost/no-existe/red.png', `\\\\?\\${local}`, `\\\\.\\${local}`];
    const text = await refused(mcp, paths);
    for (const path of paths) assert.ok(text.includes(`No se adjunta "${path}": es una ruta de red o de dispositivo; solo se adjuntan archivos de los discos de esta máquina.`), text);
  });
});

describe('SUPPORT_ATTACH_DIRS', () => {
  let allowed;
  let second;
  let limited;

  before(async () => {
    allowed = join(files, 'permitida');
    second = join(files, 'segunda');
    await mkdir(allowed, { recursive: true });
    await mkdir(second, { recursive: true });
    // Spaces around an entry and empty entries do not count.
    limited = await mcpWith({ SUPPORT_ATTACH_DIRS: [allowed, ` ${second} `, ''].join(delimiter) });
  });

  test('only the files inside the folders of the list are sent, at any depth', async () => {
    const sent = await accepted(limited, [await file('permitida/sub/captura.png'), await file('segunda/factura.pdf')]);
    assert.deepEqual(sent.map((f) => f.name), ['captura.png', 'factura.pdf']);

    api.reset();
    // A folder whose name starts with the name of an allowed one is another folder.
    const outside = [await file('fuera.png'), await file('permitida-no/captura.png')];
    const text = await refused(limited, outside);
    for (const path of outside) assert.ok(text.includes(`No se adjunta "${path}": solo se adjuntan archivos de las carpetas permitidas en SUPPORT_ATTACH_DIRS: ${allowed}; ${second}.`), text);
  });

  test('a link is judged by where its file really is', async () => {
    await file('afuera/captura.png');
    await file('permitida/adentro/captura.png');
    const leavingLink = join(allowed, 'atajo');
    const enteringLink = join(files, 'acceso');
    await symlink(join(files, 'afuera'), leavingLink, 'junction');
    await symlink(join(allowed, 'adentro'), enteringLink, 'junction');
    await refused(limited, [join(leavingLink, 'captura.png')], 'carpetas permitidas en SUPPORT_ATTACH_DIRS');
    const [sent] = await accepted(limited, [join(enteringLink, 'captura.png')]);
    assert.equal(sent.name, 'captura.png');
  });

  test('on Windows the case of the letters does not matter', { skip: !windows && 'Windows only' }, async () => {
    const inside = await file('permitida/Mayusculas.png');
    const [sent] = await accepted(limited, [inside.toUpperCase()]);
    assert.equal(sent.name, 'MAYUSCULAS.PNG');
  });

  test('a network or device path inside a folder of the list is allowed', { skip: !windows && 'Windows only' }, async () => {
    const network = await mcpWith({ SUPPORT_ATTACH_DIRS: `\\\\?\\${allowed}` });
    const inside = await file('permitida/red.png');
    await accepted(network, [`\\\\?\\${inside}`]);

    api.reset();
    const outside = await file('fuera-red.png');
    await refused(network, [`\\\\?\\${outside}`], 'es una ruta de red o de dispositivo');
  });

  test('a folder of the list that is not an absolute path is an error of the configuration', async () => {
    const wrong = await mcpWith({ SUPPORT_ATTACH_DIRS: ['capturas', allowed].join(delimiter) });
    const result = await wrong.call('adjuntar_archivos', { caso: '7', rutas: [await file('permitida/c.png')] });
    assert.equal(result.isError, true);
    assert.match(result.text, /SUPPORT_ATTACH_DIRS tiene "capturas", que no es una ruta absoluta/);
    assert.equal(uploads().length, 0);
  });
});
