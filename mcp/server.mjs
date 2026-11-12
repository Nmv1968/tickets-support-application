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

const estado = z.enum(Object.keys(STATUS));
const prioridad = z.enum(Object.keys(PRIORITY));
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Usa el formato AAAA-MM-DD');
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

async function moduleId(name) {
  if (!key(name)) return null;
  const modules = await api('GET', 'modules');
  const found = modules.find((m) => key(m.fullName) === key(name)) ?? modules.find((m) => key(m.name) === key(name));
  if (!found) throw new Error(`No existe el módulo "${name}". Módulos disponibles: ${modules.map((m) => m.fullName).join('; ')}`);
  return found.id;
}

/** "cliente" → the client is responsible; "ninguno" or empty → nobody; otherwise a person's name. */
async function assignee(name) {
  const wanted = key(name);
  if (!wanted || wanted === 'ninguno' || wanted === 'sin asignar') return { assigneeId: null, assignedToClient: false };
  if (wanted === 'cliente') return { assigneeId: null, assignedToClient: true };
  const users = (await api('GET', 'users')).filter((u) => u.active);
  const exact = users.filter((u) => key(u.name) === wanted || u.username === wanted);
  const matches = exact.length ? exact : users.filter((u) => key(u.name).startsWith(wanted));
  if (matches.length !== 1) {
    throw new Error(`${matches.length ? 'Hay varios responsables que coinciden con' : 'No existe el responsable'} "${name}". Responsables: ${users.map((u) => u.name).join(', ')}, Cliente.`);
  }
  return { assigneeId: matches[0].id, assignedToClient: false };
}

function brief(t) {
  return {
    codigo: t.code,
    // Two dates: the day the client reported it (editable) and the moment it was registered (automatic).
    fecha_caso: t.date,
    fecha_registro: t.createdAt,
    empresa: t.company,
    descripcion: t.description,
    estado: STATUS_LABEL[t.status],
    responsable: t.assigneeName ?? 'Sin asignar',
    prioridad: t.priority ? PRIORITY_LABEL[t.priority] : null,
    modulo: t.moduleName,
    vencido: t.overdue,
    // Day promised to the client, and where the open case stands against it.
    promesa_entrega: t.promisedDate,
    estado_promesa: t.promiseState ? PROMISE_LABEL[t.promiseState] : null,
    olvidado: t.stale,
    ultimo_movimiento: t.lastActivityAt,
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

tool('listar_catalogos', 'Listar catálogos', 'Devuelve los módulos, responsables, estados y prioridades vigentes. Úsalo antes de registrar o modificar un caso: el catálogo de módulos cambia.', {}, async () => {
  const [modules, users] = await Promise.all([api('GET', 'modules'), api('GET', 'users')]);
  return {
    modulos: modules.map((m) => m.fullName),
    responsables: [...users.filter((u) => u.active && u.username !== USERNAME).map((u) => u.name), 'Cliente'],
    estados: Object.keys(STATUS),
    prioridades: Object.keys(PRIORITY),
  };
});

tool(
  'buscar_casos',
  'Buscar casos',
  'Busca casos por texto y filtros. El texto se compara con empresa, descripción, observaciones y código, sin distinguir tildes ni mayúsculas. Devuelve primero los de número de caso más alto (los más recientes).',
  {
    texto: z.string().optional().describe('Palabras de la empresa, la descripción o una observación'),
    estado: estado.optional(),
    responsable: z.string().optional().describe('Nombre del responsable, "Cliente" o "ninguno"'),
    desde: fecha.optional().describe('Fecha del caso desde, AAAA-MM-DD'),
    hasta: fecha.optional().describe('Fecha del caso hasta, AAAA-MM-DD'),
    solo_vencidos: z.boolean().optional().describe('Solo casos abiertos fuera de plazo'),
    solo_olvidados: z.boolean().optional().describe('Solo casos abiertos sin movimiento desde hace más del tiempo configurado en Recordatorios'),
    promesa: z
      .enum(Object.keys(PROMISE_FILTER))
      .optional()
      .describe('Filtra por promesa de entrega al cliente: "con promesa" (cualquiera), "vencida", "hoy", "proxima" (dentro del aviso anticipado configurado) o "por atender" (vencidas, de hoy y próximas, de casos abiertos)'),
    limite: z.number().int().min(1).max(100).optional().describe('Máximo de casos a devolver. Por defecto 20'),
  },
  async (args) => {
    let assigneeFilter;
    if (args.responsable !== undefined) {
      const who = await assignee(args.responsable);
      assigneeFilter = who.assignedToClient ? 'client' : (who.assigneeId ?? 'none');
    }
    const page = await api('GET', 'tickets', {
      query: {
        q: args.texto,
        status: args.estado ? STATUS[args.estado] : undefined,
        assignee: assigneeFilter,
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
    empresa: z.string().min(1).max(200).describe('Empresa cliente que reporta. No la supongas: si no la sabes, pregunta'),
    descripcion: z.string().min(1).max(5000).describe('Qué problema reporta el cliente, en una o dos frases estilo bitácora'),
    fecha_caso: fecha.optional().describe('Día en que el cliente reportó el problema, AAAA-MM-DD, si se conoce. Por defecto hoy. La fecha de registro la pone el sistema'),
    estado: estado.optional().describe('Por defecto Pendiente'),
    prioridad: prioridad.optional(),
    modulo: z.string().optional().describe('Nombre de un módulo de listar_catalogos'),
    minutos_estimados: z.number().int().min(1).max(100000).optional(),
    promesa_entrega: fecha.optional().describe('Día en que se le prometió al cliente tener el caso resuelto, AAAA-MM-DD. Solo si la persona lo indicó; no la propongas tú'),
    responsable: z.string().optional().describe('Nombre de quien atiende el caso, o "Cliente". Sin este dato el caso queda sin asignar'),
    observacion: z.string().max(5000).optional().describe('Datos útiles de la evidencia: mensaje de error, pantalla, documento, usuario'),
    imagenes: z.array(z.string()).max(10).optional().describe('Rutas en disco de imágenes o archivos para adjuntar al caso'),
  },
  async (args) => {
    let ticket = await api('POST', 'tickets', {
      body: {
        company: args.empresa,
        description: args.descripcion,
        date: args.fecha_caso,
        status: args.estado ? STATUS[args.estado] : undefined,
        priority: args.prioridad ? PRIORITY[args.prioridad] : null,
        moduleId: await moduleId(args.modulo),
        estimatedMinutes: args.minutos_estimados ?? null,
        promisedDate: args.promesa_entrega ?? null,
        // Without an explicit responsible the case stays unassigned: the assistant does not own cases.
        ...(await assignee(args.responsable)),
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
  'Cambia campos de un caso. Envía solo los que cambian. Para cerrar un caso usa cerrar_caso.',
  {
    caso,
    estado: estado.optional(),
    prioridad: prioridad.nullable().optional().describe('null quita la prioridad'),
    modulo: z.string().optional().describe('Nombre de un módulo. Cadena vacía quita el módulo'),
    responsable: z.string().optional().describe('Nombre, "Cliente" o "ninguno"'),
    empresa: z.string().min(1).max(200).optional(),
    descripcion: z.string().min(1).max(5000).optional(),
    fecha_caso: fecha.optional().describe('Día en que el cliente reportó el problema, AAAA-MM-DD. La fecha de registro no se puede cambiar'),
    promesa_entrega: fecha.nullable().optional().describe('Día prometido al cliente para tener el caso resuelto, AAAA-MM-DD. null quita la promesa'),
    minutos_estimados: z.number().int().min(0).max(100000).nullable().optional(),
    minutos_reales: z.number().int().min(0).max(100000).optional(),
    respuesta_cliente: z.string().max(5000).optional().describe('Mensaje para el cliente. Cadena vacía lo borra'),
  },
  async (args) => {
    const body = {};
    if (args.estado !== undefined) body.status = STATUS[args.estado];
    if (args.prioridad !== undefined) body.priority = args.prioridad ? PRIORITY[args.prioridad] : null;
    if (args.modulo !== undefined) body.moduleId = await moduleId(args.modulo);
    if (args.responsable !== undefined) Object.assign(body, await assignee(args.responsable));
    if (args.empresa !== undefined) body.company = args.empresa;
    if (args.descripcion !== undefined) body.description = args.descripcion;
    if (args.fecha_caso !== undefined) body.date = args.fecha_caso;
    if (args.promesa_entrega !== undefined) body.promisedDate = args.promesa_entrega;
    if (args.minutos_estimados !== undefined) body.estimatedMinutes = args.minutos_estimados;
    if (args.minutos_reales !== undefined) body.spentMinutes = args.minutos_reales;
    if (args.respuesta_cliente !== undefined) body.customerReply = args.respuesta_cliente;
    if (!Object.keys(body).length) throw new Error('No se indicó ningún cambio.');
    return detail(await api('PATCH', `tickets/${caseId(args.caso)}`, { body }));
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
