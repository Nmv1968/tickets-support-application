import { expect, request as playwrightRequest } from '@playwright/test';
import type { APIRequestContext, APIResponse } from '@playwright/test';
import { BASE_URL } from './env';

/** What the API answers to a login, and what the web keeps in localStorage (core/auth.ts). */
export interface Session {
  token: string;
  user: { id: number; username: string; name: string };
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
  supportTypes: SupportType[];
}

export interface TicketInput {
  companyId: number;
  description: string;
  date?: string;
  status?: Ticket['status'];
  priority?: Ticket['priority'];
  supportTypeIds?: number[];
}

/** A user made for one test, with the password to log in as it. */
export interface TestUser {
  id: number;
  username: string;
  name: string;
  password: string;
}

async function body<T>(response: APIResponse): Promise<T> {
  // The message of the API in the failure, not just a status.
  expect(response.ok(), `${response.url()} → ${response.status()} ${await response.text()}`).toBe(true);
  return (await response.json()) as T;
}

export async function login(username: string, password: string): Promise<Session> {
  const context = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    return await body<Session>(await context.post('/api/auth/login', { data: { username, password } }));
  } finally {
    await context.dispose();
  }
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

  dispose(): Promise<void> {
    return this.http.dispose();
  }

  async createCompany(name: string): Promise<Company> {
    return body<Company>(await this.http.post('/api/companies', { data: { name } }));
  }

  async createSupportType(name: string, color: string): Promise<SupportType> {
    return body<SupportType>(await this.http.post('/api/support-types', { data: { name, color } }));
  }

  async createTicket(input: TicketInput): Promise<Ticket> {
    return body<Ticket>(await this.http.post('/api/tickets', { data: input }));
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

  async createUser(user: Omit<TestUser, 'id'>): Promise<TestUser> {
    const created = await body<{ id: number }>(await this.http.post('/api/users', { data: user }));
    return { ...user, id: created.id };
  }
}
