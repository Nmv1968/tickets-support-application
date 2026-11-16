// Keeps server.mjs and the fake API of these tests honest against the real API: reads the source of
// api/src as text and checks that the routes, parameters, fields and answer shapes they rely on are
// still there. A change in the API that breaks the MCP server fails here instead of in use.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, test } from 'node:test';
import { listItem, seed } from './fake-api.mjs';

const ROOT = resolve(import.meta.dirname, '..', '..');
const API_SRC = join(ROOT, 'api', 'src');
/** A file of the repository, its line ends turned into \n whatever the checkout left. */
const read = (...path) => readFileSync(join(ROOT, ...path), 'utf8').replace(/\r\n/g, '\n');
const SERVER = read('mcp', 'server.mjs');
const FAKE = read('mcp', 'test', 'fake-api.mjs');
/**
 * The source of the cases in the API, file after file: the input of a case, the filters of the
 * list and the shapes of its answers are each in a file of their own in api/src/tickets.
 */
const TICKETS_SOURCES = readdirSync(join(API_SRC, 'tickets'))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .sort()
  .map((file) => read('api', 'src', 'tickets', file));
const TICKETS = TICKETS_SOURCES.join('\n');

/** The text from `start` up to the first `end` after it. */
function block(text, start, end) {
  const from = text.indexOf(start);
  assert.ok(from >= 0, `"${start}" not found`);
  const to = text.indexOf(end, from + start.length);
  assert.ok(to >= 0, `end of "${start}" not found`);
  return text.slice(from + start.length, to);
}

const all = (text, regex) => [...text.matchAll(regex)].map((m) => m[1]);
const sorted = (values) => [...new Set(values)].sort();

/** "METHOD path" of every route of the API, e.g. "POST tickets/:id/notes". */
function apiRoutes() {
  const routes = new Set();
  const files = readdirSync(API_SRC, { recursive: true }).filter((file) => String(file).endsWith('.controller.ts'));
  for (const file of files) {
    const source = read('api', 'src', String(file));
    for (const part of source.split('@Controller(').slice(1)) {
      const prefix = /^\s*(?:'([^']*)')?\s*\)/.exec(part)?.[1] ?? '';
      for (const [, method, sub = ''] of part.matchAll(/@(Get|Post|Patch|Put|Delete)\(\s*(?:'([^']*)')?\s*\)/g)) {
        routes.add(`${method.toUpperCase()} ${[prefix, sub].filter(Boolean).join('/')}`);
      }
    }
  }
  return routes;
}

/**
 * Field names of a TypeScript class, interface or object type: the `name?:`, `name!:` or `name:`
 * whose type closes the line, after any decorators (whose messages may hold colons too).
 */
const fields = (source) => sorted(all(source, /(\w+)[?!]?:[^:\n]*;[ \t]*$/gm));

/** The keys of the object a DTO function of api/src/tickets returns, without the nested ones. */
const dtoKeys = (name) => all(block(TICKETS, `function ${name}(`, '\n}\n'), /^ {4}(\w+):/gm);

/** Values of a `const NAME = { label: 'VALUE', ... }` of server.mjs. */
const serverValues = (name) => all(block(SERVER, `const ${name} = {`, '};'), /:\s*'(\w+)'/g);

describe('routes', () => {
  const routes = apiRoutes();

  test('the API source has the routes it is expected to have', () => {
    assert.ok(routes.size > 20, `only ${routes.size} routes read from api/src: the reading broke`);
  });

  test('every route server.mjs calls exists in the API', () => {
    const used = all(SERVER, /api\('(\w+',\s*['`][^'`]+)['`]/g).map((call) => {
      const [method, path] = call.split(/',\s*['`]/);
      return `${method} ${path.replace(/\$\{[^}]+\}/g, ':id')}`;
    });
    const login = /request\(`\$\{API_URL\}\/([^`]+)`,\s*\{\s*method: '(\w+)'/.exec(SERVER);
    used.push(`${login[2]} ${login[1]}`);
    assert.ok(used.length >= 14, `only ${used.length} calls read from server.mjs: the reading broke`);
    for (const route of used) assert.ok(routes.has(route), `server.mjs calls ${route}, which is not in api/src`);
  });

  test('every route the fake API answers exists in the API', () => {
    const answered = all(FAKE, /case '((?:GET|POST|PATCH|PUT|DELETE) [^']+)'/g);
    assert.ok(answered.length >= 14);
    for (const route of answered) assert.ok(routes.has(route), `the fake answers ${route}, which is not in api/src`);
  });
});

describe('parameters and bodies', () => {
  test('the query parameters of buscar_casos are filters of the list of cases', () => {
    const sent = all(block(SERVER, "api('GET', 'tickets', {", '});'), /^\s+(\w+)[,:]/gm).filter((name) => name !== 'query');
    assert.ok(sent.length >= 12, `only ${sent.length} parameters read from server.mjs`);
    const filters = fields(block(TICKETS, 'export type TicketFilters = {', '\n};'));
    const parse = block(TICKETS, 'export function parseTicketFilters(', '\n}\n');
    for (const name of sent) {
      assert.ok(filters.includes(name), `buscar_casos sends "${name}", not a field of TicketFilters`);
      assert.ok(parse.includes(`'${name}'`) || parse.includes(`query.${name}`), `parseTicketFilters does not read "${name}"`);
    }
  });

  test('the values server.mjs sends for those parameters are the ones the API takes', () => {
    const promises = all(block(TICKETS, 'const PROMISE_FILTERS', ';'), /'(\w+)'/g);
    assert.deepEqual(sorted(serverValues('PROMISE_FILTER')), sorted(promises));
    const archived = all(block(TICKETS, 'const ARCHIVED_FILTERS', ';'), /'(\w+)'/g);
    assert.deepEqual(sorted(serverValues('ARCHIVED_FILTER')), sorted(archived));
    const parse = block(TICKETS, 'export function parseTicketFilters(', '\n}\n');
    assert.match(parse, /oneOf\('assignee', \['none'\]/);
    assert.match(parse, /text\('overdue'\) === '1'/);
    assert.match(parse, /text\('stale'\) === '1'/);
    assert.match(SERVER, /overdue: args\.solo_vencidos \? '1'/);
  });

  test('the modules are read with ?all=1 for the inactive ones', () => {
    const catalog = read('api', 'src', 'catalog', 'catalog.controller.ts');
    assert.match(catalog, /@Query\('all'\) all/);
    assert.match(catalog, /all === '1'/);
    assert.match(SERVER, /api\('GET', 'modules', \{ query: \{ all: 1 \} \}\)/);
  });

  test('the fields server.mjs writes on a case are fields of TicketInput', () => {
    const input = fields(block(TICKETS, 'export class TicketInput {', '\n}\n'));
    const created = all(block(SERVER, "api('POST', 'tickets', {", '});'), /^\s+(\w+):/gm).filter((name) => name !== 'body');
    const updated = all(SERVER, /body\.(\w+) = /g);
    const closed = all(block(SERVER, "body: { status: 'RESOLVED'", '}'), /(\w+):/g);
    assert.ok(created.length >= 12 && updated.length >= 12, 'the reading of server.mjs broke');
    for (const name of [...created, ...updated, 'status', ...closed]) assert.ok(input.includes(name), `server.mjs writes "${name}", not a field of TicketInput`);
  });

  test('the bodies of the catalogs, the notes, the files and the login', () => {
    const expected = [
      ['api/src/companies/companies.service.ts', 'export class CompanyInput {', ['name']],
      ['api/src/assignees/assignees.service.ts', 'export class AssigneeInput {', ['name']],
      ['api/src/support-types/support-types.service.ts', 'export class SupportTypeInput {', ['name', 'color']],
      ['api/src/catalog/modules.service.ts', 'export class ModuleInput {', ['name', 'parentId']],
      ['api/src/tickets/tickets.controller.ts', 'export class NoteDto {', ['text']],
      ['api/src/auth/auth.controller.ts', 'class LoginDto {', ['username', 'password']],
    ];
    for (const [file, start, names] of expected) {
      const declared = fields(block(read(...file.split('/')), start, '\n}\n'));
      for (const name of names) assert.ok(declared.includes(name), `${start} has no "${name}"`);
    }
    assert.match(read('api', 'src', 'auth', 'auth.controller.ts'), /Promise<\{ token: string/);
    assert.match(read('api', 'src', 'tickets', 'attachments.controller.ts'), /FilesInterceptor\('files'/);
    assert.match(SERVER, /form\.append\('files'/);
  });

  test('the files server.mjs attaches fit the limits of the API, per file and per request', () => {
    const controller = read('api', 'src', 'tickets', 'attachments.controller.ts');
    // The constants of the limits may live in another file of the module.
    const tickets = TICKETS_SOURCES;
    /** The number `expression` stands for in `sources`: `15 * 1024 * 1024`, or a `const` set to one. */
    const number = (sources, expression) => {
      const constant = new RegExp(`const ${expression}(?::\\s*\\w+)?\\s*=\\s*([\\d\\s*_]+);`);
      const text = /^[A-Za-z_]\w*$/.test(expression) ? sources.map((source) => constant.exec(source)?.[1]).find(Boolean) : expression;
      assert.ok(text, `the value of ${expression} not found`);
      const factors = text.split('*').map((factor) => Number(factor.trim().replace(/_/g, '')));
      assert.ok(factors.every(Number.isFinite), `${expression} is not a number: ${text}`);
      return factors.reduce((product, factor) => product * factor, 1);
    };
    const size = /fileSize:\s*([\w\s*]+?)\s*[,}]/.exec(controller)?.[1];
    const count = /FilesInterceptor\('files',\s*([\w\s*]+?)\s*[,)]/.exec(controller)?.[1];
    assert.ok(size && count, 'the limits of FilesInterceptor not found in attachments.controller.ts');
    assert.equal(number([SERVER], 'MAX_FILE_BYTES'), number([controller, ...tickets], size));
    assert.equal(number([SERVER], 'MAX_FILES'), number([controller, ...tickets], count));
    assert.match(SERVER, /rutas: z\.array\(z\.string\(\)\)\.min\(1\)\.max\(MAX_FILES\)/);
  });

  test('the status and priority values are the enums of the database', () => {
    const schema = read('api', 'prisma', 'schema.prisma');
    const enumValues = (name) => all(block(schema, `enum ${name} {`, '}'), /^\s*(\w+)\s*$/gm);
    assert.deepEqual(sorted(serverValues('STATUS')), sorted(enumValues('TicketStatus')));
    assert.deepEqual(sorted(serverValues('PRIORITY')), sorted(enumValues('Priority')));
  });
});

describe('answers of the fake API', () => {
  const data = seed();
  const [detail] = data.tickets;

  test('a case has the fields of detailDto, and in a list those of listDto', () => {
    assert.deepEqual(sorted(Object.keys(detail)), sorted([...dtoKeys('baseDto'), ...dtoKeys('detailDto')]));
    assert.deepEqual(sorted(Object.keys(listItem(detail))), sorted([...dtoKeys('baseDto'), ...dtoKeys('listDto')]));
  });

  test('the notes and attachments of a case have the fields of detailDto', () => {
    const detailDto = block(TICKETS, 'function detailDto(', '\n}\n');
    const notes = all(block(detailDto, 'notes: t.notes.map((n) => ({', '}))'), /(\w+):/g);
    const attachments = all(block(detailDto, 'attachments: t.attachments.map((a) => ({', '}))'), /(\w+):/g);
    assert.deepEqual(sorted(Object.keys(detail.notes[0])), sorted(notes));
    assert.deepEqual(sorted(Object.keys(detail.attachments[0])), sorted(attachments));
  });

  test('the catalogs have the fields of their DTOs', () => {
    // The companies, the responsibles and the support types answer an entry of a catalog of names,
    // the support types with fields of their own besides.
    const NAMED = 'common/named-catalog.ts';
    /** The fields of the DTO `name` of a file of api/src: its own, and those of the DTO it is or extends. */
    const dto = (file, name) => {
      const source = read('api', 'src', ...file.split('/'));
      const alias = `export type ${name} = `;
      if (source.includes(alias)) return dto(NAMED, block(source, alias, ';'));
      const head = block(source, `export interface ${name} `, '{');
      const base = head.replace('extends', '').trim();
      const own = fields(block(source, `export interface ${name} ${head}{`, '\n}'));
      return sorted([...own, ...(base ? dto(NAMED, base) : [])]);
    };
    assert.deepEqual(dto('companies/companies.service.ts', 'CompanyDto'), dto(NAMED, 'NamedEntryDto'));
    assert.deepEqual(sorted(Object.keys(data.companies[0])), dto('companies/companies.service.ts', 'CompanyDto'));
    assert.deepEqual(sorted(Object.keys(data.assignees[0])), dto('assignees/assignees.service.ts', 'AssigneeDto'));
    assert.deepEqual(sorted(Object.keys(data.supportTypes[0])), dto('support-types/support-types.service.ts', 'SupportTypeDto'));
    assert.ok(dto('support-types/support-types.service.ts', 'SupportTypeDto').includes('color'));
    assert.deepEqual(sorted(Object.keys(data.modules[0])), dto('catalog/modules.service.ts', 'ModuleDto'));
  });
});
