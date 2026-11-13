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
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
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
    if (!token) await login();
    const res = await request(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: form ?? (body ? JSON.stringify(body) : undefined),
    });
    if (res.status === 401 && attempt === 0) {
      token = undefined;
      continue;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
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

/**
 * "ninguno", "sin asignar" or empty → nobody (null); otherwise the id of the responsible of the
 * catalog called `name`, or of the only one whose name starts with it. `reading` is for a filter:
 * it takes an inactive responsible too, because their cases are still there to be found.
 */
async function assigneeId(name, { reading = false } = {}) {
  const wanted = key(name);
  if (!wanted || wanted === 'ninguno' || wanted === 'sin asignar') return null;
  const everyone = await api('GET', 'assignees');
  const people = everyone.filter((person) => person.active || reading);
  const exact = people.filter((person) => key(person.name) === wanted);
  const matches = exact.length ? exact : people.filter((person) => key(person.name).startsWith(wanted));
  if (matches.length === 1) return matches[0].id;

  // As with a module: the choice is put to the person, never made here.
  const list = people.length ? `Responsables existentes: ${people.map((person) => person.name).join(', ')}.` : 'Todavía no hay responsables en la lista.';
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
    responsable: t.assigneeName ?? 'Sin asignar',
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

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf', '.txt': 'text/plain' };

async function attach(id, paths) {
  const form = new FormData();
  for (const path of paths) {
    let data;
    try {
      data = await readFile(path);
    } catch {
      throw new Error(`No se pudo leer el archivo "${path}".`);
    }
    form.append('files', new Blob([data], { type: MIME[extname(path).toLowerCase()] ?? 'application/octet-stream' }), basename(path));
  }
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
    responsable: z.string().optional().describe('Nombre de un responsable, o "ninguno" para los casos sin asignar'),
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
    responsable: z.string().optional().describe('Nombre de un responsable de listar_catalogos. Sin este dato el caso queda sin asignar. Si la persona nombra a alguien que no está en la lista, pregúntale antes de agregarlo'),
    tipos_soporte: z.array(z.string()).max(20).optional().describe('Nombres de tipos de soporte de listar_catalogos. Solo los que la persona indicó o confirmó: no los elijas tú. Sin este dato el caso queda sin tipo'),
    observacion: z.string().max(5000).optional().describe('Datos útiles de la evidencia: mensaje de error, pantalla, documento, usuario'),
    imagenes: z.array(z.string()).max(10).optional().describe('Rutas en disco de imágenes o archivos para adjuntar al caso'),
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
        assigneeId: await assigneeId(args.responsable),
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
    responsable: z.string().optional().describe('Nombre de un responsable, o "ninguno" para dejar el caso sin asignar'),
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
    if (args.responsable !== undefined) body.assigneeId = await assigneeId(args.responsable);
    if (args.tipos_soporte !== undefined) {
      // The list replaces the one the case has, so an inactive type the case already carries is allowed to stay in it.
      const current = await api('GET', `tickets/${id}`);
      body.supportTypeIds = await supportTypeIds(args.tipos_soporte, { carried: current.supportTypes });
    }
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
  'Adjunta a un caso imágenes u otros archivos que están en el disco de esta máquina. Máximo 15 MB por archivo.',
  { caso, rutas: z.array(z.string()).min(1).max(10).describe('Rutas absolutas de los archivos') },
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
