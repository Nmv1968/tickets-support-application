import { expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BASE_URL } from './env';

export type Role = 'ADMIN' | 'AGENT';

/** What the API answers to a login, and what the web keeps in localStorage (core/auth.ts). */
export interface Session {
  token: string;
  user: { id: number; username: string; name: string; role: Role };
}

/** A user as the list of users gives it. */
export interface User {
  id: number;
  username: string;
  name: string;
  active: boolean;
  role: Role;
}

export interface Company {
  id: number;
  name: string;
}

export interface SupportType {
  id: number;
  name: string;
  color: string;
}

export interface Ticket {
  id: number;
  code: string;
  description: string;
  companyId: number;
  company: string;
  status: 'PENDING' | 'RESOLVED' | 'UNRESOLVED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | null;
  archivedAt: string | null;
  /** By name, as the support types. */
  assignees: Assignee[];
  supportTypes: SupportType[];
}

export interface TicketInput {
  companyId: number;
  description: string;
  date?: string;
  status?: Ticket['status'];
  priority?: Ticket['priority'];
  supportTypeIds?: number[];
  assigneeIds?: number[];
  moduleId?: number;
  promisedDate?: string;
  estimatedMinutes?: number;
  customerReply?: string;
}

/** A responsible person (Configuración > Responsables). */
export interface Assignee {
  id: number;
  name: string;
}

/** The catalogs of Configuración, by their path in the API. */
export type Catalog = 'companies' | 'assignees' | 'support-types' | 'modules';

/** A file sent from memory, as Playwright's multipart takes it. */
export interface FileUpload {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

/** A user made for one test, with the password to log in as it. An agent unless the test says otherwise. */
export interface TestUser {
  id: number;
  username: string;
  name: string;
  password: string;
  role?: Role;
}

/** Fails with the message of the API, not just a status, when it refused. */
async function succeeded(response: APIResponse): Promise<void> {
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(true);
}

async function body<T>(response: APIResponse): Promise<T> {
  await succeeded(response);
  return (await response.json()) as T;
}

/** A login as the web sends it, from a context of its own, and what `read` takes from the answer. */
async function postLogin<T>(username: string, password: string, read: (response: APIResponse) => Promise<T>): Promise<T> {
  const context = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    return await read(await context.post('/api/auth/login', { data: { username, password } }));
  } finally {
    await context.dispose();
  }
}

export function login(username: string, password: string): Promise<Session> {
  return postLogin(username, password, (response) => body<Session>(response));
}

/** The status the API answers to this login, a refusal included. */
export function loginStatus(username: string, password: string): Promise<number> {
  return postLogin(username, password, (response) => Promise.resolve(response.status()));
}

/**
 * The API as a test uses it to set up its own data, logged in as one user. The tests do through
 * it what is not the subject of the test, and look through it at what the screen stored.
 */
export class Api {
  private constructor(private readonly http: APIRequestContext) {}

  static async as(token: string): Promise<Api> {
    return new Api(await playwrightRequest.newContext({ baseURL: BASE_URL, extraHTTPHeaders: { Authorization: `Bearer ${token}` } }));
  }

  /** The API as this user in a session opened now: another one, besides those the user already has. */
  static async loggedIn(user: { username: string; password: string }): Promise<Api> {
    return Api.as((await login(user.username, user.password)).token);
  }

  dispose(): Promise<void> {
    return this.http.dispose();
  }

  async createCompany(name: string): Promise<Company> {
    return body<Company>(await this.http.post('/api/companies', { data: { name } }));
  }

  async createSupportType(name: string, color: string): Promise<SupportType> {
    return body<SupportType>(await this.http.post('/api/support-types', { data: { name, color } }));
  }

  async createAssignee(name: string): Promise<Assignee> {
    return body<Assignee>(await this.http.post('/api/assignees', { data: { name } }));
  }

  /** A main module, or one inside `parentId`. */
  async createModule(name: string, parentId?: number): Promise<{ id: number }> {
    return body<{ id: number }>(await this.http.post('/api/modules', { data: { name, parentId } }));
  }

  /** Turns an entry of a catalog off: Configuración shows it apart, and the case forms no longer offer it. */
  async deactivate(catalog: Catalog, id: number): Promise<void> {
    await succeeded(await this.http.patch(`/api/${catalog}/${id}`, { data: { active: false } }));
  }

  async createTicket(input: TicketInput): Promise<Ticket> {
    return body<Ticket>(await this.http.post('/api/tickets', { data: input }));
  }

  /** A change to a case made elsewhere, as another person or the assistant would make it. */
  async updateTicket(id: number, input: Partial<TicketInput>): Promise<Ticket> {
    return body<Ticket>(await this.http.patch(`/api/tickets/${id}`, { data: input }));
  }

  async addNote(ticketId: number, text: string): Promise<void> {
    await succeeded(await this.http.post(`/api/tickets/${ticketId}/notes`, { data: { text } }));
  }

  async attach(ticketId: number, files: FileUpload[]): Promise<void> {
    const multipart = new FormData();
    for (const file of files) multipart.append('files', new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }), file.name);
    await succeeded(await this.http.post(`/api/tickets/${ticketId}/attachments`, { multipart }));
  }

  /** Imports a sheet as the dialog "Importar" does once the person confirms it. */
  async importSheet(file: FileUpload): Promise<void> {
    await succeeded(await this.http.post('/api/import', { multipart: { file } }));
  }

  async ticket(id: number): Promise<Ticket> {
    return body<Ticket>(await this.http.get(`/api/tickets/${id}`));
  }

  /** Status of GET /tickets/:id, for a case that should no longer exist. */
  async ticketStatus(id: number): Promise<number> {
    return (await this.http.get(`/api/tickets/${id}`)).status();
  }

  /** The cases the search finds, archived or not. */
  async searchTickets(q: string): Promise<Ticket[]> {
    const page = await body<{ items: Ticket[] }>(await this.http.get('/api/tickets', { params: { q, archived: 'all', pageSize: 100 } }));
    return page.items;
  }

  /** How many cases the dashboard counts from one day to another, archived ones included. */
  async casesBetween(from: string, to: string): Promise<number> {
    return (await body<{ totals: { total: number } }>(await this.http.get('/api/dashboard', { params: { from, to } }))).totals.total;
  }

  async createUser(user: Omit<TestUser, 'id'>): Promise<TestUser> {
    const created = await body<{ id: number }>(await this.http.post('/api/users', { data: user }));
    return { ...user, id: created.id };
  }

  async users(): Promise<User[]> {
    return body<User[]>(await this.http.get('/api/users'));
  }

  /** Any request, for a test about what the API refuses: its status and its message, whatever they are. */
  async attempt(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, data?: unknown): Promise<{ status: number; message: unknown }> {
    const response = await this.http.fetch(path, { method, data });
    const answer = (await response.json().catch(() => null)) as { message?: unknown } | null;
    return { status: response.status(), message: answer?.message };
  }
}
