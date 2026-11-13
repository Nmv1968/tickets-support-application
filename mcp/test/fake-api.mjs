// A stand-in for the support API, for the tests of the MCP server. It answers the routes
// server.mjs uses with data kept in memory, in the shapes of the real DTOs (api/src), and records
// every request so a test can check what the MCP server sent. contract.test.mjs checks that the
// shapes and the routes still match the API.
import { createServer } from 'node:http';

export const TEST_USERNAME = 'asistente-pruebas';
export const TEST_PASSWORD = 'clave-de-pruebas';

/** Lowercase without accents, as the API compares catalog names (`searchKey`). */
function key(text) {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const byActiveThenName = (a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'es');

/** The catalogs and cases every test starts from. Invented names only. */
export function seed() {
  const modules = [
    { id: 1, name: 'Ventas', parentId: null, active: true },
    { id: 2, name: 'Notas de crédito', parentId: 1, active: true },
    { id: 3, name: 'Inventario', parentId: null, active: true },
    { id: 4, name: 'Nómina', parentId: null, active: false },
    { id: 5, name: 'Cotizaciones', parentId: 1, active: false },
  ];
  const data = {
    // CompanyDto
    companies: [
      { id: 1, name: 'Acme Industrial S.A.', active: true, tickets: 1 },
      { id: 2, name: 'Acme Logística', active: true, tickets: 0 },
      { id: 3, name: 'Ferretería Andina', active: true, tickets: 1 },
      { id: 4, name: 'Acme Antigua', active: false, tickets: 0 },
      { id: 5, name: 'Panadería El Trigo', active: true, tickets: 0 },
    ],
    // AssigneeDto
    assignees: [
      { id: 1, name: 'María Pérez', active: true, tickets: 1 },
      { id: 2, name: 'Mario Ruiz', active: true, tickets: 0 },
      { id: 3, name: 'Lucía Gómez', active: false, tickets: 0 },
      { id: 4, name: 'Cliente', active: true, tickets: 0 },
    ],
    // SupportTypeDto
    supportTypes: [
      { id: 1, name: 'Falla del sistema', color: '#dc2626', active: true, tickets: 1 },
      { id: 2, name: 'Capacitación', color: '#2563eb', active: true, tickets: 0 },
      { id: 3, name: 'Migración', color: '#64748b', active: false, tickets: 1 },
    ],
    // ModuleDto
    modules: modules.map((m) => ({ ...m, fullName: m.parentId ? `${modules.find((p) => p.id === m.parentId).name} > ${m.name}` : m.name })),
    tickets: [],
    nextId: 21,
  };
  data.tickets.push(
    ticket(data, {
      id: 7,
      date: '2026-11-10',
      time: '09:15',
      companyId: 1,
      description: 'No se puede emitir una nota de crédito.',
      status: 'UNRESOLVED',
      assigneeId: 1,
      supportTypeIds: [1, 3],
      priority: 'HIGH',
      estimatedMinutes: 60,
      moduleId: 2,
      dueAt: '2026-11-11T09:15:00.000Z',
      promisedDate: '2026-11-13',
      promiseState: 'today',
      overdue: true,
      notes: [
        { id: 2, text: 'Se revisó el log del servidor.', authorName: 'Ana Torres', createdAt: '2026-11-11T10:00:00.000Z' },
        { id: 1, text: 'El error aparece al guardar.', authorName: 'Ana Torres', createdAt: '2026-11-10T09:20:00.000Z' },
      ],
      attachments: [{ id: 1, filename: 'captura.png', mime: 'image/png', size: 2048, createdAt: '2026-11-10T09:20:00.000Z' }],
    }),
    ticket(data, {
      id: 12,
      date: '2026-10-02',
      companyId: 3,
      description: 'Consulta sobre el cierre de caja.',
      status: 'RESOLVED',
      resolvedAt: '2026-10-03T15:00:00.000Z',
      customerReply: 'El cierre ya cuadra.',
      archivedAt: '2026-10-20T08:00:00.000Z',
      stale: false,
    }),
  );
  return data;
}

/** A case as the API answers it (detailDto of api/src/tickets/tickets.service.ts). */
function ticket(data, fields) {
  const company = data.companies.find((c) => c.id === fields.companyId);
  const assignee = data.assignees.find((a) => a.id === fields.assigneeId);
  const module = data.modules.find((m) => m.id === fields.moduleId);
  const supportTypes = (fields.supportTypeIds ?? [])
    .map((id) => data.supportTypes.find((type) => type.id === id))
    .map(({ id, name, color }) => ({ id, name, color }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  const notes = fields.notes ?? [];
  const attachments = fields.attachments ?? [];
  const now = new Date().toISOString();
  return {
    id: fields.id,
    code: `SOP-${String(fields.id).padStart(5, '0')}`,
    date: fields.date ?? now.slice(0, 10),
    time: fields.time ?? null,
    companyId: fields.companyId,
    company: company?.name,
    description: fields.description,
    status: fields.status ?? 'PENDING',
    assigneeId: fields.assigneeId ?? null,
    assigneeName: assignee?.name ?? null,
    supportTypes,
    priority: fields.priority ?? null,
    estimatedMinutes: fields.estimatedMinutes ?? null,
    spentMinutes: fields.spentMinutes ?? 0,
    timerStartedAt: null,
    moduleId: fields.moduleId ?? null,
    moduleName: module?.fullName ?? null,
    dueAt: fields.dueAt ?? null,
    promisedDate: fields.promisedDate ?? null,
    promiseState: fields.promiseState ?? null,
    resolvedAt: fields.resolvedAt ?? null,
    overdue: fields.overdue ?? false,
    lastActivityAt: fields.lastActivityAt ?? now,
    stale: fields.stale ?? false,
    aiGenerated: fields.aiGenerated ?? false,
    customerReply: fields.customerReply ?? null,
    createdById: 1,
    createdAt: fields.createdAt ?? now,
    archivedAt: fields.archivedAt ?? null,
    createdByName: 'Ana Torres',
    lastNote: notes[0]?.text ?? null,
    notesCount: notes.length,
    attachmentsCount: attachments.length,
    notes,
    attachments,
    history: [],
  };
}

/** A case as a list answers it (listDto): the detail without its notes, attachments and history. */
export function listItem(detail) {
  const { createdByName: _name, notes: _notes, attachments: _attachments, history: _history, ...item } = detail;
  return item;
}

/** The body of an error, as NestJS writes it. */
function nestError(status, message) {
  const error = { 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 409: 'Conflict' }[status];
  return { message, ...(error ? { error } : {}), statusCode: status };
}

class HttpError extends Error {
  constructor(status, message) {
    super(typeof message === 'string' ? message : 'error');
    this.status = status;
    this.body = nestError(status, message);
  }
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/** The body as the test will look at it: parsed JSON, the files of a multipart form, or null. */
async function parseBody(req, raw) {
  if (!raw.length) return null;
  const type = req.headers['content-type'] ?? '';
  if (type.startsWith('multipart/form-data')) {
    const form = await new Response(raw, { headers: { 'content-type': type } }).formData();
    const files = [];
    for (const [field, value] of form.entries()) {
      files.push({ field, name: value.name, type: value.type, size: value.size, text: await value.text() });
    }
    return { files };
  }
  return JSON.parse(raw.toString('utf8'));
}

export async function startFakeApi() {
  let data = seed();
  const requests = [];
  const tokens = new Set();
  let issued = 0;
  /** Answers set by a test for the next request to a route, before the route itself. */
  let overrides = [];
  const state = { rejectLogin: false };

  const findTicket = (id) => {
    const found = data.tickets.find((t) => t.id === Number(id));
    if (!found) throw new HttpError(404, 'El caso no existe');
    return found;
  };

  /** Adds a name to a catalog the way the API does: refused when another entry has it. */
  const addToCatalog = (list, name, article, extra = {}) => {
    const tidy = String(name ?? '').replace(/\s+/g, ' ').trim();
    if (!tidy) throw new HttpError(400, 'El nombre es obligatorio');
    const taken = list.find((entry) => key(entry.name) === key(tidy));
    if (taken) throw new HttpError(409, `Ya existe ${article} con ese nombre${taken.active ? '' : ', pero está inactivo.'}`);
    const created = { id: Math.max(0, ...list.map((entry) => entry.id)) + 1, name: tidy, ...extra, active: true, tickets: 0 };
    list.push(created);
    return created;
  };

  /** Applies a TicketInput to a stored case, as `TicketsService.update` reads its fields. */
  const applyInput = (current, body) => {
    const fields = { ...current, supportTypeIds: current.supportTypes.map((type) => type.id) };
    for (const name of ['date', 'time', 'companyId', 'description', 'status', 'assigneeId', 'priority', 'estimatedMinutes', 'spentMinutes', 'moduleId', 'promisedDate']) {
      if (body[name] !== undefined) fields[name] = body[name];
    }
    if (body.supportTypeIds !== undefined) fields.supportTypeIds = [...new Set(body.supportTypeIds)];
    if (body.customerReply !== undefined) fields.customerReply = body.customerReply || null;
    if (body.archived !== undefined) fields.archivedAt = body.archived ? new Date().toISOString() : null;
    if (body.status === 'RESOLVED' && current.status !== 'RESOLVED') fields.resolvedAt = new Date().toISOString();
    return ticket(data, fields);
  };

  const replace = (updated) => {
    data.tickets = data.tickets.map((t) => (t.id === updated.id ? updated : t));
    return updated;
  };

  async function route(method, path, query, body, req) {
    if (method === 'POST' && path === 'auth/login') {
      if (state.rejectLogin || body?.username !== TEST_USERNAME || body?.password !== TEST_PASSWORD) {
        throw new HttpError(401, 'Usuario o contraseña incorrectos');
      }
      const token = `token-${++issued}`;
      tokens.add(token);
      return [200, { token, user: { id: 9, username: TEST_USERNAME, name: 'Asistente' } }];
    }
    const auth = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
    if (!auth || !tokens.has(auth[1])) throw new HttpError(401, 'Unauthorized');

    const segments = path.split('/');
    switch (`${method} ${segments[0]}${segments.length > 1 ? '/:id' : ''}${segments.slice(2).map((s) => `/${s}`).join('')}`) {
      case 'GET companies':
        return [200, [...data.companies].sort(byActiveThenName)];
      case 'POST companies':
        return [201, addToCatalog(data.companies, body?.name, 'una empresa')];
      case 'GET assignees':
        return [200, [...data.assignees].sort(byActiveThenName)];
      case 'POST assignees':
        return [201, addToCatalog(data.assignees, body?.name, 'un responsable')];
      case 'GET support-types':
        return [200, [...data.supportTypes].sort(byActiveThenName)];
      case 'POST support-types':
        if (!body?.color) throw new HttpError(400, 'El color debe ser un código hexadecimal como #1a2b3c');
        return [201, addToCatalog(data.supportTypes, body?.name, 'un tipo de soporte', { color: body.color.toLowerCase() })];
      case 'GET modules':
        // Active modules by default; `?all=1` also the deactivated ones.
        return [200, data.modules.filter((m) => query.all === '1' || m.active).sort((a, b) => a.fullName.localeCompare(b.fullName, 'es'))];
      case 'POST modules': {
        const id = Math.max(...data.modules.map((m) => m.id)) + 1;
        const parent = data.modules.find((m) => m.id === body.parentId);
        data.modules.push({ id, name: body.name, parentId: body.parentId ?? null, active: true, fullName: parent ? `${parent.name} > ${body.name}` : body.name });
        return [201, { id }];
      }
      case 'GET tickets': {
        const items = data.tickets.filter((t) => (query.archived === 'all' ? true : query.archived === 'only' ? t.archivedAt : !t.archivedAt));
        return [200, { items: items.map(listItem), total: items.length, page: 1, pageSize: Number(query.pageSize) || 50 }];
      }
      case 'GET tickets/:id':
        return [200, findTicket(segments[1])];
      case 'POST tickets': {
        if (!data.companies.some((c) => c.id === body.companyId)) throw new HttpError(400, 'La empresa no existe');
        const note = body.note?.trim();
        const created = ticket(data, {
          ...body,
          id: data.nextId++,
          supportTypeIds: [...new Set(body.supportTypeIds ?? [])],
          notes: note ? [{ id: 100, text: note, authorName: 'Asistente', createdAt: new Date().toISOString() }] : [],
        });
        data.tickets.push(created);
        return [201, created];
      }
      case 'PATCH tickets/:id':
        return [200, replace(applyInput(findTicket(segments[1]), body ?? {}))];
      case 'POST tickets/:id/notes': {
        const current = findTicket(segments[1]);
        const note = { id: 200 + current.notes.length, text: body.text, authorName: 'Asistente', createdAt: new Date().toISOString() };
        return [201, replace(ticket(data, { ...current, supportTypeIds: current.supportTypes.map((t) => t.id), notes: [note, ...current.notes] }))];
      }
      case 'POST tickets/:id/attachments': {
        const current = findTicket(segments[1]);
        if (!body?.files?.length) throw new HttpError(400, 'No se recibió ningún archivo');
        const added = body.files.map((file, index) => ({ id: 300 + index, filename: file.name, mime: file.type, size: file.size, createdAt: new Date().toISOString() }));
        return [201, replace(ticket(data, { ...current, supportTypeIds: current.supportTypes.map((t) => t.id), attachments: [...current.attachments, ...added] }))];
      }
      default:
        throw new HttpError(404, `Cannot ${method} /api/${path}`);
    }
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fake');
    const path = url.pathname.replace(/^\/api\//, '');
    const raw = await readBody(req);
    let body;
    try {
      body = await parseBody(req, raw);
    } catch {
      body = raw.toString('utf8');
    }
    const record = { method: req.method, path, query: Object.fromEntries(url.searchParams), body, authorization: req.headers.authorization ?? null };
    requests.push(record);

    let status;
    let answer;
    const override = overrides.find((o) => o.method === req.method && o.path === path);
    if (override) {
      overrides = overrides.filter((o) => o !== override);
      status = override.status;
      answer = override.body;
    } else {
      try {
        [status, answer] = await route(req.method, path, record.query, body, req);
      } catch (error) {
        status = error instanceof HttpError ? error.status : 500;
        answer = error instanceof HttpError ? error.body : nestError(500, 'Internal server error');
      }
    }
    if (typeof answer === 'string') {
      res.writeHead(status, { 'Content-Type': 'text/html' }).end(answer);
    } else if (answer === undefined || answer === null) {
      res.writeHead(status).end();
    } else {
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(answer));
    }
  });

  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/api`,
    requests,
    state,
    get data() {
      return data;
    },
    /** Back to the seed data, with no requests recorded. Logins stay valid. */
    reset() {
      data = seed();
      requests.length = 0;
      overrides = [];
      state.rejectLogin = false;
    },
    /** Every token stops being valid, as when the API restarts with a new secret. */
    expireTokens() {
      tokens.clear();
    },
    /** The next request to `method path` gets this answer: an object as JSON, a string as HTML, null as an empty body. */
    answerNext(method, path, status, body) {
      overrides.push({ method, path, status, body });
    },
    /** The requests to a route, without the logins unless asked for. */
    calls(method, path) {
      return requests.filter((r) => (!method || r.method === method) && (!path || r.path === path));
    },
    /** The requests that change something: anything but a read or a login. */
    writes() {
      return requests.filter((r) => r.method !== 'GET' && r.path !== 'auth/login');
    },
    close() {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    },
  };
}
