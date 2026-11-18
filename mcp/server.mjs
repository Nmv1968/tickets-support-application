#!/usr/bin/env node
// MCP server for the support-case system. Lets an AI assistant search, register,
// update and close cases through the same HTTP API the web app uses.
//
// It logs in by itself as the assistant user (MCP_USERNAME / MCP_PASSWORD), so every
// change it makes shows that user's name in the case history.
//
// Configuration, all optional:
//   SUPPORT_API_URL   base URL of the API. Default: the Docker Compose installation on this
//                     machine, http://localhost:<WEB_PORT of .env, or 4300>/api.
//                     In development (npm run start:dev) use http://localhost:3300/api.
//   SUPPORT_ENV_FILE  .env file to read MCP_USERNAME and MCP_PASSWORD from. Default: ../.env
//   SUPPORT_USERNAME / SUPPORT_PASSWORD  credentials given directly; they win over the file.
//   SUPPORT_ATTACH_DIRS  the only folders files may be attached from, separated as in PATH (";" on
//                     Windows, ":" elsewhere). Default: any folder that is not hidden.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readFileSync } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { basename, delimiter, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { z } from 'zod';

const here = import.meta.dirname;
const GUIDE_FILE = resolve(here, 'GUIA.md');
// The writing guide for client messages. The API uses the same files for the replies it drafts:
// a team's own guide (estilo-respuestas.local.md, not under version control) when it exists,
// otherwise the general one the project ships.
const STYLE_FILES = ['estilo-respuestas.local.md', 'estilo-respuestas.md'].map((name) => resolve(here, '..', 'api', 'assets', name));

/** Read on every call, so edits to either file apply without restarting the assistant. */
function guide() {
  const rules = readFileSync(GUIDE_FILE, 'utf8');
  const style = STYLE_FILES.filter((file) => existsSync(file)).map((file) => readFileSync(file, 'utf8')).find((text) => text.trim()) ?? '';
  return style ? `${rules}\n\n---\n\n# Guía de estilo para mensajes al cliente\n\n${style}` : rules;
}

function loadEnvFile(path) {
  const values = {};
  if (!existsSync(path)) return values;
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match && !line.trim().startsWith('#')) values[match[1]] = match[2].replace(/^["']|["']$/g, '');
  }
  return values;
}

const fileEnv = loadEnvFile(process.env.SUPPORT_ENV_FILE ?? resolve(here, '..', '.env'));
const API_URL = (process.env.SUPPORT_API_URL ?? `http://localhost:${fileEnv.WEB_PORT || 4300}/api`).replace(/\/+$/, '');
const USERNAME = process.env.SUPPORT_USERNAME ?? fileEnv.MCP_USERNAME ?? 'claude';
const PASSWORD = process.env.SUPPORT_PASSWORD ?? fileEnv.MCP_PASSWORD;

// ---------------------------------------------------------------------------
// HTTP client with automatic login
// ---------------------------------------------------------------------------

let token;
/** The login under way: the calls that need a token at the same time wait for the same one. */
let pendingLogin;

async function request(url, init) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(60_000) });
  } catch {
    throw new Error(`No se pudo conectar con el sistema de soporte en ${API_URL}. Verifica que esté encendido.`);
  }
}

async function login() {
  if (!PASSWORD) {
    throw new Error('Falta la contraseña del usuario asistente. Define MCP_PASSWORD en el archivo .env del sistema de soporte y reinicia su API.');
  }
  const res = await request(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  if (res.status === 429) {
    // Too many attempts from this machine or with this user: the password may well be right.
    const message = (await res.json().catch(() => null))?.message;
    throw new Error(`El sistema de soporte no deja ingresar por ahora al usuario "${USERNAME}" (HTTP 429). ${message ?? 'Espera un minuto y vuelve a intentarlo.'}`);
  }
  if (!res.ok) {
    throw new Error(`El sistema de soporte rechazó el ingreso del usuario "${USERNAME}" (HTTP ${res.status}). Revisa MCP_PASSWORD y que el usuario esté activo.`);
  }
  token = (await res.json()).token;
}

/** Calls the API. Logs in on first use and once more when the token has expired. */
async function api(method, path, { query, body, form } = {}) {
  const url = new URL(`${API_URL}/${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  for (let attempt = 0; ; attempt++) {
    if (!token) await (pendingLogin ??= login().finally(() => (pendingLogin = undefined)));
    const used = token;
    const res = await request(url, {
      method,
      headers: { Authorization: `Bearer ${used}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    if (res.status === 401 && attempt === 0) {
      // Another call may have logged in again meanwhile: only the token that was refused is dropped.
      if (token === used) token = undefined;
      continue;
    }
    const text = await res.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Not JSON: a proxy in front of the API answers with a page when the API is down.
      if (res.ok) throw new Error(`El sistema de soporte respondió algo que no es JSON (HTTP ${res.status}).`);
    }
    if (!res.ok) {
      const message = Array.isArray(data?.message) ? data.message.join('. ') : data?.message;
      throw new Error(message ?? `El sistema de soporte respondió HTTP ${res.status}`);
    }
    return data;
  }
}

// ---------------------------------------------------------------------------
// Translation between the Spanish words an assistant uses and the API values
// ---------------------------------------------------------------------------

const STATUS = { 'Sin resolver': 'UNRESOLVED', Pendiente: 'PENDING', Resuelto: 'RESOLVED' };
const PRIORITY = { Baja: 'LOW', Media: 'MEDIUM', Alta: 'HIGH', Crítica: 'CRITICAL' };
const STATUS_LABEL = Object.fromEntries(Object.entries(STATUS).map(([label, value]) => [value, label]));
const PRIORITY_LABEL = Object.fromEntries(Object.entries(PRIORITY).map(([label, value]) => [value, label]));

const PROMISE_LABEL = { overdue: 'vencida', today: 'vence hoy', soon: 'próxima a vencer', later: 'vigente' };
/** Filter values of `buscar_casos` → `promise` parameter of the API. */
const PROMISE_FILTER = { 'con promesa': 'any', 'por atender': 'due', vencida: 'overdue', hoy: 'today', proxima: 'soon' };
/** Filter values of `buscar_casos` → `archived` parameter of the API. Without it the API leaves the archived cases out. */
const ARCHIVED_FILTER = { no: undefined, solo: 'only', todos: 'all' };
/** Colour of a support type created without one: the grey the import gives to the ones it adds. */
const DEFAULT_TYPE_COLOR = '#64748b';

const estado = z.enum(Object.keys(STATUS));
const prioridad = z.enum(Object.keys(PRIORITY));
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Usa el formato HH:MM de 24 horas, por ejemplo 14:35');
const caso = z.string().describe('Código del caso, por ejemplo "SOP-00020" o solo "20"');

/** Lowercase without accents, to compare names the way people type them. */
function key(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function caseId(reference) {
  const match = /(\d+)\s*$/.exec(String(reference));
  if (!match) throw new Error(`"${reference}" no es un código de caso. Ejemplo: SOP-00020.`);
  return Number(match[1]);
}

/** The module called `name`, by its full name ("Ventas > Notas de crédito") or by its own, among `modules`. */
function findModule(modules, name) {
  const wanted = key(name);
  return modules.find((m) => key(m.fullName) === wanted) ?? modules.find((m) => key(m.name) === wanted);
}

/**
 * A name that is not in a catalog is never settled here: not by picking the closest one, not by
 * creating it. The error tells the assistant to put the choice to the person.
 */
async function moduleId(name) {
  if (!key(name)) return null;
  const modules = await api('GET', 'modules', { query: { all: 1 } });
  const active = modules.filter((m) => m.active);
  const found = findModule(active, name);
  if (found) return found.id;
  const list = `Módulos existentes: ${active.map((m) => m.fullName).join('; ')}.`;
  const inactive = findModule(modules, name);
  if (inactive) {
    throw new Error(
      `El módulo "${inactive.fullName}" existe pero está inactivo. No uses otro por tu cuenta: pregunta a la persona si lo reactiva ` +
        `(Configuración > Módulos), si el caso va en otro módulo o si queda sin módulo. ${list}`,
    );
  }
  throw new Error(
    `No existe el módulo "${name}". No lo crees ni elijas otro por tu cuenta: pregunta a la persona si quiere que lo crees ` +
      `(herramienta crear_modulo), usar uno de los existentes o dejar el caso sin módulo. ${list}`,
  );
}

/** "ninguno", "sin asignar" or empty: a name that means nobody, not a person to look for. */
function meansNobody(name) {
  const wanted = key(name);
  return !wanted || wanted === 'ninguno' || wanted === 'sin asignar';
}

/**
 * The id of the responsible of `everyone` (the whole catalog) called `name`, or of the only one
 * whose name starts with it. Two situations take an inactive responsible too, as with a support
 * type. `carried`, the responsibles the case already has: sending its list again must not take one
 * off. And `reading`, for a filter: their cases are still there to be found.
 */
function findAssignee(everyone, name, { reading = false, carried = [] } = {}) {
  const wanted = key(name);
  const offered = everyone.filter((person) => person.active || reading);
  const people = everyone.filter((person) => person.active || reading || carried.some((own) => own.id === person.id));
  const exact = people.filter((person) => key(person.name) === wanted);
  const matches = exact.length ? exact : people.filter((person) => key(person.name).startsWith(wanted));
  if (matches.length === 1) return matches[0].id;

  // As with a module: the choice is put to the person, never made here.
  const list = offered.length ? `Responsables existentes: ${offered.map((person) => person.name).join(', ')}.` : 'Todavía no hay responsables en la lista.';
  if (matches.length > 1) {
    throw new Error(`Hay varios responsables que coinciden con "${name}": ${matches.map((person) => person.name).join(', ')}. Pregunta a la persona cuál es.`);
  }
  if (reading) {
    throw new Error(`No existe el responsable "${name}". ${list} Si no sabes cuál es, pregunta a la persona.`);
  }
  const inactive = everyone.find((person) => key(person.name) === wanted);
  if (inactive) {
    throw new Error(
      `"${inactive.name}" está en la lista de responsables pero inactivo. No asignes el caso a otro por tu cuenta: pregunta a la persona ` +
        `si lo reactiva (Configuración > Responsables), si el caso va a otro responsable o si queda sin asignar. ${list}`,
    );
  }
  throw new Error(
    `No existe el responsable "${name}". No lo agregues ni elijas otro por tu cuenta: pregunta a la persona si quiere que lo agregues ` +
      `a la lista (herramienta crear_responsable), asignar el caso a uno de los existentes o dejarlo sin asignar. ${list}`,
  );
}

/** For a filter: nobody (null) for the words that mean it, otherwise the id of the responsible called `name` (see findAssignee). */
async function assigneeId(name, { reading = false } = {}) {
  if (meansNobody(name)) return null;
  return findAssignee(await api('GET', 'assignees'), name, { reading });
}

/**
 * The ids of the responsibles called `names`, each once (see findAssignee). The words that mean
 * nobody add no one: an empty list, or only those words, leaves the case without responsibles.
 */
async function assigneeIds(names, { carried = [] } = {}) {
  const wanted = names.filter((name) => !meansNobody(name));
  if (!wanted.length) return [];
  const everyone = await api('GET', 'assignees');
  return [...new Set(wanted.map((name) => findAssignee(everyone, name, { carried })))];
}

/**
 * The names of the responsibles a tool was given: `responsables`, the list, or `responsable`, the
 * one name the tools took before a case could have several ("ninguno" for nobody), which an
 * assistant may still send. Undefined when it sent neither.
 */
function responsibleNames(args) {
  if (args.responsables !== undefined && args.responsable !== undefined) {
    throw new Error('Envía los responsables solo en `responsables`, la lista completa; `responsable` es para un solo nombre y no se combina con ella.');
  }
  if (args.responsables !== undefined) return args.responsables;
  return args.responsable !== undefined ? [args.responsable] : undefined;
}

/** The words of a name that tell it from another one: "de", "la" or the letters of "S.A." are in too many. */
function nameWords(name) {
  return key(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
}

/**
 * The companies a person may have meant by `name`: the ones whose name contains it, then the ones
 * that share a word with it. Ten at most: a catalog of clients is too long to put in an error.
 */
function similarCompanies(companies, name) {
  const wanted = key(name);
  const words = nameWords(name);
  const shared = (company) => nameWords(company.name).filter((word) => words.includes(word)).length;
  const containing = companies.filter((company) => key(company.name).includes(wanted));
  const sharing = companies.filter((company) => !containing.includes(company) && shared(company) > 0).sort((a, b) => shared(b) - shared(a));
  return [...containing, ...sharing].slice(0, 10);
}

/**
 * The company of the catalog called `name`, by its exact name. `reading` is for a filter: it takes
 * an inactive company too, because its cases are still there to be found.
 * As with a module, a name that is not there is put to the person. The error offers the companies
 * with a similar name: the one the person means is often registered under another spelling.
 */
async function companyId(name, { reading = false } = {}) {
  const wanted = key(name);
  if (!wanted) throw new Error('Falta la empresa. No la supongas: pregunta a la persona cuál es.');
  const companies = await api('GET', 'companies');
  const found = companies.find((company) => key(company.name) === wanted);
  if (found && (found.active || reading)) return found.id;

  const similar = similarCompanies(companies.filter((company) => company.active || reading), name);
  const list = similar.length ? `Empresas con un nombre parecido: ${similar.map((company) => company.name).join('; ')}.` : 'No hay otra empresa con un nombre parecido.';
  if (found) {
    throw new Error(
      `La empresa "${found.name}" existe pero está inactiva. No uses otra por tu cuenta: pregunta a la persona si la reactiva ` +
        `(Configuración > Empresas) o si el caso es de otra empresa. ${list}`,
    );
  }
  if (reading) {
    throw new Error(
      `No existe la empresa "${name}": el filtro necesita el nombre exacto. ${list} Si no sabes cuál es, pregunta a la persona, ` +
        'o busca por una parte del nombre con `texto`.',
    );
  }
  throw new Error(
    `No existe la empresa "${name}". No la crees ni elijas otra por tu cuenta: pregunta a la persona si quiere que la crees ` +
      `(herramienta crear_empresa) o si es una de las existentes. ${list}`,
  );
}

/**
 * The ids of the support types called `names`, each by its exact name, as with a company. Two
 * situations take an inactive type too. `carried`, the types the case already has: sending its
 * list again must not take one off. And `reading`, for a filter: the cases that carry it are
 * still there to be found.
 */
async function supportTypeIds(names, { carried = [], reading = false } = {}) {
  const wanted = names.filter((name) => key(name));
  if (!wanted.length) return [];
  const types = await api('GET', 'support-types');
  const offered = types.filter((type) => type.active || reading).map((type) => type.name);
  const list = offered.length ? `Tipos de soporte existentes: ${offered.join('; ')}.` : 'Todavía no hay tipos de soporte en el catálogo.';
  const ids = wanted.map((name) => {
    const found = types.find((type) => key(type.name) === key(name));
    if (found && (found.active || reading || carried.some((own) => own.id === found.id))) return found.id;
    if (found) {
      throw new Error(
        `El tipo de soporte "${found.name}" existe pero está inactivo. No uses otro por tu cuenta: pregunta a la persona si lo reactiva ` +
          `(Configuración > Tipos de soporte), si el caso lleva otro tipo o si queda sin ese tipo. ${list}`,
      );
    }
    if (reading) {
      throw new Error(`No existe el tipo de soporte "${name}": el filtro necesita el nombre exacto. ${list} Si no sabes cuál es, pregunta a la persona.`);
    }
    throw new Error(
      `No existe el tipo de soporte "${name}". No lo crees ni elijas otro por tu cuenta: pregunta a la persona si quiere que lo crees ` +
        `(herramienta crear_tipo_soporte), usar uno de los existentes o dejar el caso sin ese tipo. ${list}`,
    );
  });
  // A type named twice counts once.
  return [...new Set(ids)];
}

function brief(t) {
  return {
    codigo: t.code,
    // Two dates: the day the client reported it (editable) and the moment it was registered (automatic).
    fecha_caso: t.date,
    // Optional: the time of day the client reported it.
    hora_caso: t.time,
    fecha_registro: t.createdAt,
    empresa: t.company,
    descripcion: t.description,
    estado: STATUS_LABEL[t.status],
    // By name, as the support types. Empty for a case nobody is responsible for.
    responsables: t.assignees.map((person) => person.name),
    prioridad: t.priority ? PRIORITY_LABEL[t.priority] : null,
    modulo: t.moduleName,
    tipos_soporte: t.supportTypes.map((type) => type.name),
    vencido: t.overdue,
    // Day promised to the client, and where the open case stands against it.
    promesa_entrega: t.promisedDate,
    estado_promesa: t.promiseState ? PROMISE_LABEL[t.promiseState] : null,
    olvidado: t.stale,
    ultimo_movimiento: t.lastActivityAt,
    // Put away: out of the lists and the reminders unless asked for, with everything it had.
    archivado: t.archivedAt !== null,
    ultima_observacion: t.lastNote,
  };
}

function detail(t) {
  const { ultima_observacion: _omit, ...base } = brief(t);
  return {
    ...base,
    minutos_estimados: t.estimatedMinutes,
    minutos_reales: t.spentMinutes,
    fecha_limite: t.dueAt,
    resuelto_el: t.resolvedAt,
    observaciones: [...t.notes].reverse().map((n) => ({ fecha: n.createdAt, autor: n.authorName, texto: n.text })),
    adjuntos: t.attachments.map((a) => a.filename),
    respuesta_cliente: t.customerReply,
  };
}

// ---------------------------------------------------------------------------
// Files to attach
// ---------------------------------------------------------------------------
// The paths come from the assistant, which may have read them in a case it was asked to register:
// only the files of these types leave the machine, and never a hidden one (.env, .ssh...).

/** The types of file that are attached. Any other one is refused. */
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain' };
/** "PNG, JPG, ... o TXT", for the messages. */
const TYPES = Object.keys(MIME)
  .map((extension) => extension.slice(1).toUpperCase())
  .join(', ')
  .replace(/, (\w+)$/, ' o $1');
/** The limits of the API per file and per request: FilesInterceptor of api/src/tickets/attachments.controller.ts. */
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_FILES = 10;
const ATTACH_DIRS = (process.env.SUPPORT_ATTACH_DIRS ?? '')
  .split(delimiter)
  .map((dir) => dir.trim())
  .filter(Boolean);

/** Megabytes with one decimal, rounded up: a file just over the limit does not read as the limit. */
const megabytes = (bytes) => (Math.ceil((bytes / 1024 / 1024) * 10) / 10).toLocaleString('es');

/** Whether `path` is inside `dir`. On Windows the comparison ignores case, as `relative` does there. */
function isInside(dir, path) {
  const rest = relative(dir, path);
  return rest !== '' && rest !== '..' && !rest.startsWith(`..${sep}`) && !isAbsolute(rest);
}

/** The folders of SUPPORT_ATTACH_DIRS, as written and as they are on disk (links resolved). */
function attachDirs() {
  return Promise.all(
    ATTACH_DIRS.map(async (dir) => {
      if (!isAbsolute(dir)) throw new Error(`SUPPORT_ATTACH_DIRS tiene "${dir}", que no es una ruta absoluta. Dile a la persona que corrija la configuración del servidor MCP.`);
      const given = resolve(dir);
      // A folder that does not exist yet holds nothing, and stays as written.
      return { given, real: await realpath(given).catch(() => given) };
    }),
  );
}

/** Why a file may not be attached, judged by its path alone, or null when it may. Touches nothing on disk. */
function refusedPath(path, dirs) {
  // \\server\share, \\?\ and \\.\ paths, and the mapped network drives they resolve to: reading one
  // connects to the server it names. Only a folder of SUPPORT_ATTACH_DIRS may be one.
  const network = process.platform === 'win32' && /^[\\/]{2}/.test(path);
  if (network && !dirs.some(({ given, real }) => isInside(given, path) || isInside(real, path))) {
    return 'es una ruta de red o de dispositivo; solo se adjuntan archivos de los discos de esta máquina';
  }
  if (path.split(/[\\/]/).some((segment) => segment.startsWith('.'))) return 'es un archivo oculto o está dentro de una carpeta oculta (empieza con punto)';
  if (!MIME[extname(path).toLowerCase()]) return `no es de un tipo que se adjunte (solo ${TYPES})`;
  return null;
}

/** The content of a file the assistant asked to attach, once it is known that it may be sent. */
async function readAttachment(path, dirs) {
  const refused = (reason) => new Error(`No se adjunta "${path}": ${reason}.`);
  const unreadable = () => new Error(`No se pudo leer el archivo "${path}".`);
  if (!isAbsolute(path)) throw refused('indica la ruta completa del archivo');
  const byPath = refusedPath(path, dirs);
  if (byPath) throw refused(byPath);

  // A link is judged by the file it points to.
  const real = await realpath(path).catch(() => {
    throw unreadable();
  });
  const byTarget = refusedPath(real, dirs);
  if (byTarget) throw refused(`su ubicación real, "${real}", ${byTarget}`);
  if (dirs.length && !dirs.some((dir) => isInside(dir.real, real))) {
    throw refused(`solo se adjuntan archivos de las carpetas permitidas en SUPPORT_ATTACH_DIRS: ${ATTACH_DIRS.join('; ')}`);
  }

  // The size before anything is read; a folder or a device is refused before it is opened.
  const info = await stat(real).catch(() => {
    throw unreadable();
  });
  if (!info.isFile()) throw refused('no es un archivo');
  if (info.size > MAX_FILE_BYTES) throw refused(`pesa ${megabytes(info.size)} MB y el máximo por archivo es ${megabytes(MAX_FILE_BYTES)} MB`);

  const handle = await open(real, 'r').catch(() => {
    throw unreadable();
  });
  try {
    // Never more than the size checked, even if the file grows meanwhile.
    const data = Buffer.alloc(info.size);
    let filled = 0;
    while (filled < data.length) {
      const { bytesRead } = await handle.read(data, filled, data.length - filled, filled);
      if (!bytesRead) break;
      filled += bytesRead;
    }
    return data.subarray(0, filled);
  } catch {
    throw unreadable();
  } finally {
    await handle.close();
  }
}

/** Uploads the files of `paths` to case `id`: all of them, or none when any is refused. */
async function attach(id, paths) {
  const dirs = await attachDirs();
  const form = new FormData();
  const problems = [];
  for (const path of paths) {
    try {
      form.append('files', new Blob([await readAttachment(path, dirs)], { type: MIME[extname(path).toLowerCase()] }), basename(path));
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) throw new Error(`${problems.join(' ')} No se adjuntó ningún archivo. Dile a la persona por qué; no busques otra ruta por tu cuenta.`);
  return api('POST', `tickets/${id}/attachments`, { form });
}

// ---------------------------------------------------------------------------
// Server and tools
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'soporte', version: '1.0.0' },
  {
    instructions:
      'Sistema de casos de soporte técnico del equipo interno. Antes de registrar, modificar o cerrar un caso, llama a `leer_guia` y sigue sus reglas: explican cómo redactar un caso desde una imagen o un texto, cómo elegir prioridad y módulo, y cómo escribir la respuesta para el cliente al cerrar.',
  },
);

/** Registers a tool whose handler returns a plain value; errors become readable tool errors. */
function tool(name, title, description, inputSchema, handler) {
  server.registerTool(name, { title, description, inputSchema }, async (args) => {
    try {
      const result = await handler(args);
      return { content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }] };
    } catch (error) {
      return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
    }
  });
}

tool('leer_guia', 'Leer la guía de soporte', 'Devuelve las reglas del equipo para registrar, dar seguimiento y cerrar casos, y para redactar la respuesta al cliente. Incluye la guía de estilo del equipo para mensajes a clientes. Léela una vez antes de usar las demás herramientas.', {}, () => guide());

tool('listar_catalogos', 'Listar catálogos', 'Devuelve las empresas, los módulos, los responsables, los tipos de soporte, los estados y las prioridades vigentes. Úsalo antes de registrar o modificar un caso: los catálogos cambian. Si la persona nombra una empresa, un módulo, un responsable o un tipo de soporte que no está aquí, pregúntale qué hacer antes de crear nada.', {}, async () => {
  const [companies, modules, people, types] = await Promise.all([api('GET', 'companies'), api('GET', 'modules'), api('GET', 'assignees'), api('GET', 'support-types')]);
  // What a new case can use: an inactive entry keeps its cases and is not offered.
  const names = (entries) => entries.filter((entry) => entry.active).map((entry) => entry.name);
  return {
    empresas: names(companies),
    modulos: modules.map((m) => m.fullName),
    responsables: names(people),
    tipos_soporte: names(types),
    estados: Object.keys(STATUS),
    prioridades: Object.keys(PRIORITY),
  };
});

tool(
  'crear_empresa',
  'Agregar una empresa',
  'Agrega una empresa cliente al catálogo para poder registrar casos a su nombre. Úsalo solo cuando la persona lo pidió o lo confirmó después de que le preguntaste; nunca por tu cuenta porque un nombre no existía: puede ser una empresa que ya está con otro nombre.',
  { nombre: z.string().min(1).max(200).describe('Nombre de la empresa, como debe verse en los casos') },
  async (args) => {
    const created = await api('POST', 'companies', { body: { name: args.nombre } });
    return { empresa: created.name, mensaje: `"${created.name}" ya está en el catálogo de empresas. Úsala con ese nombre.` };
  },
);

tool(
  'crear_responsable',
  'Agregar un responsable',
  'Agrega una persona a la lista de responsables para poder asignarle casos. Basta el nombre: no necesita ser usuario del sistema. Úsalo solo cuando la persona lo pidió o lo confirmó después de que le preguntaste; nunca por tu cuenta porque un nombre no existía.',
  { nombre: z.string().min(1).max(80).describe('Nombre de la persona, como debe verse en los casos') },
  async (args) => {
    const created = await api('POST', 'assignees', { body: { name: args.nombre } });
    return { responsable: created.name, mensaje: `"${created.name}" ya está en la lista de responsables. Úsalo con ese nombre.` };
  },
);

tool(
  'crear_modulo',
  'Agregar un módulo',
  'Agrega un módulo al catálogo para poder clasificar casos en él. Úsalo solo cuando la persona lo pidió o lo confirmó después de que le preguntaste; nunca por tu cuenta porque un nombre no existía. Si no sabes si es un módulo principal o va dentro de otro, pregúntalo.',
  {
    nombre: z.string().min(1).max(80).describe('Nombre del módulo'),
    dentro_de: z.string().optional().describe('Nombre del módulo principal al que pertenece, si es un submódulo. Sin este dato se crea como módulo principal'),
  },
  async (args) => {
    const name = args.nombre.replace(/\s+/g, ' ').trim();
    if (!name) throw new Error('El nombre del módulo es obligatorio.');
    const modules = await api('GET', 'modules', { query: { all: 1 } });
    let parent = null;
    if (key(args.dentro_de)) {
      const mains = modules.filter((m) => m.parentId === null && m.active);
      parent = mains.find((m) => key(m.name) === key(args.dentro_de)) ?? null;
      if (!parent) {
        throw new Error(`No existe el módulo principal "${args.dentro_de}". Pregunta a la persona dentro de cuál va. Módulos principales: ${mains.map((m) => m.name).join('; ')}.`);
      }
    }
    const fullName = parent ? `${parent.name} > ${name}` : name;
    const same = modules.find((m) => key(m.fullName) === key(fullName));
    if (same) {
      throw new Error(
        same.active
          ? `El módulo "${same.fullName}" ya existe: úsalo con ese nombre.`
          : `El módulo "${same.fullName}" ya existe pero está inactivo. Se reactiva en Configuración > Módulos; dile a la persona.`,
      );
    }
    await api('POST', 'modules', { body: { name, parentId: parent?.id ?? null } });
    return { modulo: fullName, mensaje: `El módulo "${fullName}" ya está en el catálogo. Úsalo con ese nombre.` };
  },
);

tool(
  'crear_tipo_soporte',
  'Agregar un tipo de soporte',
  'Agrega un tipo de soporte al catálogo: una etiqueta que dice qué clase de soporte fue un caso (falla del sistema, capacitación...). Úsalo solo cuando la persona lo pidió o lo confirmó después de que le preguntaste; nunca por tu cuenta porque un nombre no existía.',
  {
    nombre: z.string().min(1).max(60).describe('Nombre del tipo de soporte, como debe verse en los casos'),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/, 'Usa un color hexadecimal, por ejemplo #1a2b3c')
      .optional()
      .describe('Color de la etiqueta, en hexadecimal (#rrggbb), solo si la persona lo indicó. Sin este dato queda en gris; se cambia en Configuración > Tipos de soporte'),
  },
  async (args) => {
    const created = await api('POST', 'support-types', { body: { name: args.nombre, color: args.color ?? DEFAULT_TYPE_COLOR } });
    return { tipo_soporte: created.name, color: created.color, mensaje: `"${created.name}" ya está en el catálogo de tipos de soporte. Úsalo con ese nombre.` };
  },
);

tool(
  'buscar_casos',
  'Buscar casos',
  'Busca casos por texto y filtros. El texto se compara con empresa, descripción, observaciones y código, sin distinguir tildes ni mayúsculas. Devuelve primero los de número de caso más alto (los más recientes). Los filtros `empresa`, `responsable` y `tipo_soporte` aceptan también una entrada inactiva del catálogo: sus casos siguen ahí. Los casos archivados quedan fuera, salvo que los pidas con `archivados`.',
  {
    texto: z.string().optional().describe('Palabras de la empresa, la descripción o una observación'),
    estado: estado.optional(),
    empresa: z.string().optional().describe('Nombre exacto de una empresa del catálogo: solo sus casos. Para buscar por una parte del nombre usa `texto`'),
    responsable: z.string().optional().describe('Nombre de un responsable: los casos que tiene, solo o con otros. "ninguno" para los casos sin asignar'),
    tipo_soporte: z.string().optional().describe('Nombre de un tipo de soporte del catálogo: solo los casos que lo llevan'),
    desde: fecha.optional().describe('Fecha del caso desde, AAAA-MM-DD'),
    hasta: fecha.optional().describe('Fecha del caso hasta, AAAA-MM-DD'),
    solo_vencidos: z.boolean().optional().describe('Solo casos abiertos fuera de plazo'),
    solo_olvidados: z.boolean().optional().describe('Solo casos abiertos sin movimiento desde hace más del tiempo configurado en Recordatorios'),
    promesa: z
      .enum(Object.keys(PROMISE_FILTER))
      .optional()
      .describe('Filtra por promesa de entrega al cliente: "con promesa" (cualquiera), "vencida", "hoy", "proxima" (dentro del aviso anticipado configurado) o "por atender" (vencidas, de hoy y próximas, de casos abiertos)'),
    archivados: z
      .enum(Object.keys(ARCHIVED_FILTER))
      .optional()
      .describe('Casos archivados: "no" los deja fuera (por defecto), "solo" devuelve únicamente los archivados y "todos" incluye unos y otros'),
    limite: z.number().int().min(1).max(100).optional().describe('Máximo de casos a devolver. Por defecto 20'),
  },
  async (args) => {
    // A name left empty does not filter. The responsible is the exception: empty, like "ninguno", asks for the cases nobody has.
    const company = key(args.empresa) ? await companyId(args.empresa, { reading: true }) : undefined;
    const responsible = args.responsable !== undefined ? ((await assigneeId(args.responsable, { reading: true })) ?? 'none') : undefined;
    const [supportType] = key(args.tipo_soporte) ? await supportTypeIds([args.tipo_soporte], { reading: true }) : [];
    const page = await api('GET', 'tickets', {
      query: {
        q: args.texto,
        status: args.estado ? STATUS[args.estado] : undefined,
        companyId: company,
        assignee: responsible,
        supportType,
        archived: ARCHIVED_FILTER[args.archivados ?? 'no'],
        from: args.desde,
        to: args.hasta,
        overdue: args.solo_vencidos ? '1' : undefined,
        stale: args.solo_olvidados ? '1' : undefined,
        promise: args.promesa ? PROMISE_FILTER[args.promesa] : undefined,
        // Highest ticket number first, stated explicitly: with a limit, the newest cases must come back.
        dir: 'desc',
        pageSize: args.limite ?? 20,
      },
    });
    return { total: page.total, casos: page.items.map(brief) };
  },
);

tool('ver_caso', 'Ver un caso', 'Devuelve un caso completo: datos, observaciones en orden cronológico, adjuntos y la respuesta para el cliente si existe.', { caso }, async (args) => detail(await api('GET', `tickets/${caseId(args.caso)}`)));

tool(
  'crear_caso',
  'Registrar un caso',
  'Registra un caso nuevo. Sigue la guía: confirma el borrador con la persona antes de crear, salvo que haya pedido registrarlo directamente. Devuelve el caso con su código.',
  {
    empresa: z.string().min(1).max(200).describe('Empresa cliente que reporta, con el nombre que tiene en listar_catalogos. No la supongas: si no la sabes, pregunta. Si la persona nombra una que no existe, pregúntale antes de crearla'),
    descripcion: z.string().min(1).max(5000).describe('Qué problema reporta el cliente, en una o dos frases estilo bitácora'),
    fecha_caso: fecha.optional().describe('Día en que el cliente reportó el problema, AAAA-MM-DD, si se conoce. Por defecto hoy. La fecha de registro la pone el sistema'),
    hora_caso: hora.optional().describe('Hora en que el cliente lo reportó, HH:MM de 24 horas, solo si la evidencia la muestra (la hora de un mensaje) o la persona la dijo'),
    estado: estado.optional().describe('Por defecto Pendiente'),
    prioridad: prioridad.optional(),
    modulo: z.string().optional().describe('Nombre de un módulo de listar_catalogos. Si la persona nombra uno que no existe, pregúntale antes de crearlo'),
    minutos_estimados: z.number().int().min(1).max(100000).optional(),
    promesa_entrega: fecha.optional().describe('Día en que se le prometió al cliente tener el caso resuelto, AAAA-MM-DD. Solo si la persona lo indicó; no la propongas tú'),
    responsables: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Nombres de responsables de listar_catalogos: quienes van a atender el caso, uno o varios. Sin este dato el caso queda sin asignar. Si la persona nombra a alguien que no está en la lista, pregúntale antes de agregarlo'),
    responsable: z.string().optional().describe('Un solo responsable, como `responsables` con un nombre. Queda por compatibilidad: usa `responsables`'),
    tipos_soporte: z.array(z.string()).max(20).optional().describe('Nombres de tipos de soporte de listar_catalogos. Solo los que la persona indicó o confirmó: no los elijas tú. Sin este dato el caso queda sin tipo'),
    observacion: z.string().max(5000).optional().describe('Datos útiles de la evidencia: mensaje de error, pantalla, documento, usuario'),
    imagenes: z
      .array(z.string())
      .max(MAX_FILES)
      .optional()
      .describe(`Rutas absolutas en disco de los archivos de la evidencia para adjuntar al caso: ${TYPES}, hasta ${megabytes(MAX_FILE_BYTES)} MB cada uno. Nunca archivos ocultos ni de carpetas ocultas`),
  },
  async (args) => {
    let ticket = await api('POST', 'tickets', {
      body: {
        companyId: await companyId(args.empresa),
        description: args.descripcion,
        date: args.fecha_caso,
        time: args.hora_caso,
        status: args.estado ? STATUS[args.estado] : undefined,
        priority: args.prioridad ? PRIORITY[args.prioridad] : null,
        moduleId: await moduleId(args.modulo),
        estimatedMinutes: args.minutos_estimados ?? null,
        promisedDate: args.promesa_entrega ?? null,
        // Without an explicit responsible the case stays unassigned: the assistant does not own cases.
        assigneeIds: await assigneeIds(responsibleNames(args) ?? []),
        supportTypeIds: await supportTypeIds(args.tipos_soporte ?? []),
        note: args.observacion,
        aiGenerated: true,
      },
    });
    let warning;
    if (args.imagenes?.length) {
      try {
        ticket = await attach(ticket.id, args.imagenes);
      } catch (error) {
        warning = `El caso se registró, pero no se pudieron adjuntar los archivos: ${error.message}`;
      }
    }
    return { ...detail(ticket), ...(warning ? { aviso: warning } : {}) };
  },
);

tool(
  'actualizar_caso',
  'Actualizar un caso',
  'Cambia campos de un caso, y lo archiva o desarchiva. Envía solo los que cambian. Para cerrar un caso usa cerrar_caso.',
  {
    caso,
    estado: estado.optional(),
    prioridad: prioridad.nullable().optional().describe('null quita la prioridad'),
    modulo: z.string().optional().describe('Nombre de un módulo. Cadena vacía quita el módulo'),
    responsables: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Lista completa de los responsables del caso, con nombres de listar_catalogos: reemplaza la que tenía. Para agregar uno, envía también los que ya tiene (ver_caso los muestra). Lista vacía deja el caso sin asignar'),
    responsable: z
      .string()
      .optional()
      .describe('Un solo responsable, que reemplaza a los que tenga el caso, o "ninguno" para dejarlo sin asignar. Queda por compatibilidad: usa `responsables`'),
    tipos_soporte: z
      .array(z.string())
      .max(20)
      .optional()
      .describe('Lista completa de los tipos de soporte del caso, con nombres de listar_catalogos: reemplaza la que tenía. Para agregar uno, envía también los que ya tiene (ver_caso los muestra). Lista vacía los quita todos'),
    empresa: z.string().min(1).max(200).optional().describe('Nombre de una empresa de listar_catalogos'),
    descripcion: z.string().min(1).max(5000).optional(),
    fecha_caso: fecha.optional().describe('Día en que el cliente reportó el problema, AAAA-MM-DD. La fecha de registro no se puede cambiar'),
    hora_caso: hora.nullable().optional().describe('Hora en que el cliente lo reportó, HH:MM de 24 horas. null quita la hora'),
    promesa_entrega: fecha.nullable().optional().describe('Día prometido al cliente para tener el caso resuelto, AAAA-MM-DD. null quita la promesa'),
    minutos_estimados: z.number().int().min(0).max(100000).nullable().optional(),
    minutos_reales: z.number().int().min(0).max(100000).optional(),
    respuesta_cliente: z.string().max(5000).optional().describe('Mensaje para el cliente. Cadena vacía lo borra'),
    archivar: z
      .boolean()
      .optional()
      .describe('true archiva el caso: deja de aparecer en las listas, el tablero y los avisos, y se conserva completo. false lo desarchiva. Solo cuando la persona lo pida'),
  },
  async (args) => {
    const id = caseId(args.caso);
    const body = {};
    if (args.estado !== undefined) body.status = STATUS[args.estado];
    if (args.prioridad !== undefined) body.priority = args.prioridad ? PRIORITY[args.prioridad] : null;
    if (args.modulo !== undefined) body.moduleId = await moduleId(args.modulo);
    // The lists replace the ones the case has, so an inactive responsible or type the case already
    // has is allowed to stay in them. The case is read once, for either.
    let current;
    const stored = async () => (current ??= await api('GET', `tickets/${id}`));
    const people = responsibleNames(args);
    if (people !== undefined) body.assigneeIds = await assigneeIds(people, { carried: (await stored()).assignees });
    if (args.tipos_soporte !== undefined) body.supportTypeIds = await supportTypeIds(args.tipos_soporte, { carried: (await stored()).supportTypes });
    if (args.empresa !== undefined) body.companyId = await companyId(args.empresa);
    if (args.descripcion !== undefined) body.description = args.descripcion;
    if (args.fecha_caso !== undefined) body.date = args.fecha_caso;
    if (args.hora_caso !== undefined) body.time = args.hora_caso;
    if (args.promesa_entrega !== undefined) body.promisedDate = args.promesa_entrega;
    if (args.minutos_estimados !== undefined) body.estimatedMinutes = args.minutos_estimados;
    if (args.minutos_reales !== undefined) body.spentMinutes = args.minutos_reales;
    if (args.respuesta_cliente !== undefined) body.customerReply = args.respuesta_cliente;
    if (args.archivar !== undefined) body.archived = args.archivar;
    if (!Object.keys(body).length) throw new Error('No se indicó ningún cambio.');
    return detail(await api('PATCH', `tickets/${id}`, { body }));
  },
);

tool(
  'agregar_observacion',
  'Agregar una observación',
  'Agrega una observación interna a un caso. Queda con fecha y con tu usuario como autor.',
  { caso, texto: z.string().min(1).max(5000) },
  async (args) => detail(await api('POST', `tickets/${caseId(args.caso)}/notes`, { body: { text: args.texto } })),
);

tool(
  'adjuntar_archivos',
  'Adjuntar archivos',
  `Adjunta a un caso archivos que están en el disco de esta máquina: ${TYPES}, máximo ${megabytes(MAX_FILE_BYTES)} MB por archivo. No adjunta archivos ocultos ni de carpetas ocultas (.env, .ssh...), ni de rutas de red, y si el servidor tiene carpetas permitidas, solo de ellas. Adjunta solo los archivos que la persona te dio o señaló.`,
  { caso, rutas: z.array(z.string()).min(1).max(MAX_FILES).describe('Rutas absolutas de los archivos') },
  async (args) => detail(await attach(caseId(args.caso), args.rutas)),
);

tool(
  'cerrar_caso',
  'Cerrar un caso',
  'Marca un caso como Resuelto, guarda cómo se resolvió como observación interna y guarda la respuesta para el cliente. Redacta la respuesta según la guía y devuélvela después a la persona, completa, lista para copiar.',
  {
    caso,
    respuesta_cliente: z.string().min(1).max(5000).describe('Mensaje para quien pidió el soporte, redactado según la guía'),
    solucion: z.string().max(5000).optional().describe('Cómo se resolvió, según lo dijo el técnico. Queda como observación interna'),
  },
  async (args) => {
    const id = caseId(args.caso);
    if (args.solucion?.trim()) await api('POST', `tickets/${id}/notes`, { body: { text: `Solución: ${args.solucion.trim()}` } });
    return detail(await api('PATCH', `tickets/${id}`, { body: { status: 'RESOLVED', customerReply: args.respuesta_cliente } }));
  },
);

// The guide is also a resource, for clients that prefer reading it that way.
server.registerResource('guia', 'soporte://guia', { title: 'Guía de soporte', mimeType: 'text/markdown' }, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: 'text/markdown', text: guide() }],
}));

await server.connect(new StdioServerTransport());
