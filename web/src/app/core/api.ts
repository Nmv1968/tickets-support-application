import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { TicketEvents } from './ticket-events';

export type TicketStatus = 'UNRESOLVED' | 'PENDING' | 'RESOLVED';
export type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
/** `overdue` the promised day passed, `today` it is today, `soon` within the advance notice, `later` further away. */
export type PromiseState = 'overdue' | 'today' | 'soon' | 'later';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
}

export interface User extends AuthUser {
  active: boolean;
  /** False for a user without a password, until one is set. */
  canLogin: boolean;
  /** The responsible this user is. Null for a user who does not attend cases. */
  assigneeId: number | null;
}

/** A person a case can be assigned to ("Responsable"). Need not be a user of the app. */
export interface Assignee {
  id: number;
  name: string;
  /** False keeps the cases they have and takes them out of the lists for new ones. */
  active: boolean;
  /** Cases assigned to them, open or closed. With any, the responsible cannot be deleted. */
  tickets: number;
}

export interface SystemModule {
  id: number;
  name: string;
  parentId: number | null;
  active: boolean;
  fullName: string;
}

export interface Ticket {
  id: number;
  code: string;
  /** "Fecha del caso": day the client reported the problem, `YYYY-MM-DD`. Editable. */
  date: string;
  /** "Hora del caso": time of day the client reported it, `HH:mm`. Optional. */
  time: string | null;
  company: string;
  description: string;
  status: TicketStatus;
  assigneeId: number | null;
  assignedToClient: boolean;
  assigneeName: string | null;
  priority: Priority | null;
  estimatedMinutes: number | null;
  spentMinutes: number;
  timerStartedAt: string | null;
  moduleId: number | null;
  moduleName: string | null;
  dueAt: string | null;
  /** "Promesa de entrega": day promised to the client, `YYYY-MM-DD`. Null = no promise. */
  promisedDate: string | null;
  /** Where an open case stands against its promise. Null without a promise or once resolved. */
  promiseState: PromiseState | null;
  resolvedAt: string | null;
  overdue: boolean;
  /** Last change, note or attachment. */
  lastActivityAt: string;
  /** Open case with no activity for longer than the time set in Configuración > Recordatorios. */
  stale: boolean;
  aiGenerated: boolean;
  /** Message for the person who asked for support. */
  customerReply: string | null;
  /** "Fecha de registro": moment the ticket was created here. Set by the server, never editable. */
  createdAt: string;
  lastNote: string | null;
  notesCount: number;
  attachmentsCount: number;
}

export interface TicketNote {
  id: number;
  text: string;
  authorName: string | null;
  createdAt: string;
}

export interface Attachment {
  id: number;
  filename: string;
  mime: string;
  size: number;
  createdAt: string;
}

export interface HistoryEntry {
  id: number;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  userName: string | null;
  createdAt: string;
}

export interface TicketDetail extends Ticket {
  createdByName: string | null;
  notes: TicketNote[];
  attachments: Attachment[];
  history: HistoryEntry[];
}

export interface TicketInput {
  date?: string;
  /** Null removes the time of the case. */
  time?: string | null;
  company?: string;
  description?: string;
  status?: TicketStatus;
  assigneeId?: number | null;
  assignedToClient?: boolean;
  priority?: Priority | null;
  estimatedMinutes?: number | null;
  spentMinutes?: number;
  moduleId?: number | null;
  /** Null removes the promise. */
  promisedDate?: string | null;
  customerReply?: string | null;
  note?: string;
  aiGenerated?: boolean;
}

/** Query-string filters. Empty values are not sent. */
export interface TicketFilters {
  status?: string;
  /** Id of a responsible, `client` or `none`. */
  assignee?: string;
  company?: string;
  priority?: string;
  moduleId?: string;
  from?: string;
  to?: string;
  overdue?: string;
  stale?: string;
  /** Delivery promise: `any`, `overdue`, `today`, `soon`, or `due` (overdue + today + soon). */
  promise?: string;
  q?: string;
  page?: number;
  pageSize?: number;
  sort?: string;
  dir?: string;
}

export interface TicketPage {
  items: Ticket[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ReminderSettings {
  /** Hours without activity after which an open case counts as forgotten. 0 = reminder off. */
  staleHours: number;
  /** Days of advance notice before a promised delivery date. 0 = no advance notice. */
  promiseSoonDays: number;
}

export interface ReminderList extends ReminderSettings {
  /** Open cases whose promised delivery date passed, is today, or is within the advance notice. */
  promises: Ticket[];
  stale: Ticket[];
  overdue: Ticket[];
}

export interface AiProviderConfig {
  id: string;
  label: string;
  needsBaseUrl: boolean;
  keyOptional: boolean;
  hasKey: boolean;
  keyHint: string | null;
  baseUrl: string | null;
  model: string | null;
  active: boolean;
}

export interface AiModel {
  id: string;
  name: string;
  vision: boolean | null;
}

export interface TicketDraft {
  /** Day the client reported the problem, when the evidence shows it. */
  date: string | null;
  /** Time of day it was reported, `HH:mm`, when the evidence shows it. */
  time: string | null;
  company: string | null;
  description: string;
  moduleId: number | null;
  priority: Priority | null;
  estimatedMinutes: number | null;
  note: string | null;
  provider: string;
  model: string;
}

export interface StatusCount {
  name: string;
  unresolved: number;
  pending: number;
  resolved: number;
  total: number;
}

export interface Dashboard {
  totals: { total: number; unresolved: number; pending: number; resolved: number; overdue: number };
  avgResolutionHours: number | null;
  slaCompliance: number | null;
  estimatedMinutes: number;
  spentMinutes: number;
  byAssignee: StatusCount[];
  byCompany: { name: string; total: number }[];
  byModule: { name: string; total: number }[];
  byPriority: { priority: Priority | null; total: number }[];
  monthly: { month: string; total: number; resolved: number; open: number }[];
}

export interface ImportResult {
  dryRun: boolean;
  columns: Record<'date' | 'time' | 'company' | 'description' | 'status' | 'assignee' | 'note', string | null>;
  totalRows: number;
  skippedEmpty: number;
  duplicates: number;
  toCreate: number;
  newPeople: string[];
  sample: { date: string; time: string | null; company: string; description: string; status: TicketStatus; assignee: string | null; note: string | null }[];
}

type Params = Record<string, string | number | undefined | null>;

function clean(params: Params): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') out[key] = String(value);
  }
  return out;
}

/**
 * A request for a file gets its error body as a file too, so the server's `{ message }` would
 * never reach the user (a PDF export over its limit says what to do). Reads the body back into
 * the object every other failed request carries. Anything else is returned as it came.
 */
export async function withReadableBody(error: unknown): Promise<unknown> {
  if (!(error instanceof HttpErrorResponse) || !(error.error instanceof Blob)) return error;
  try {
    const body: unknown = JSON.parse(await error.error.text());
    return new HttpErrorResponse({
      error: body,
      headers: error.headers,
      status: error.status,
      statusText: error.statusText,
      url: error.url ?? undefined,
    });
  } catch {
    return error;
  }
}

/** Every call to the backend. Promise-based so components can use async/await with signals. */
@Injectable({ providedIn: 'root' })
export class Api {
  private readonly http = inject(HttpClient);
  private readonly ticketEvents = inject(TicketEvents);

  /**
   * Announces a case as the server stored it once the write is answered, so every screen shows
   * it without the caller passing it on (see TicketEvents).
   */
  private async announce(write: Promise<TicketDetail>, created = false): Promise<TicketDetail> {
    const ticket = await write;
    this.ticketEvents.saved(ticket, created);
    return ticket;
  }

  private get<T>(url: string, params: Params = {}): Promise<T> {
    return firstValueFrom(this.http.get<T>(`/api/${url}`, { params: clean(params) }));
  }

  private send<T>(method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, body?: unknown, params: Params = {}): Promise<T> {
    return firstValueFrom(this.http.request<T>(method, `/api/${url}`, { body, params: clean(params) }));
  }

  private async blob(url: string, params: Params = {}): Promise<Blob> {
    try {
      return await firstValueFrom(this.http.get(`/api/${url}`, { params: clean(params), responseType: 'blob' }));
    } catch (error) {
      throw await withReadableBody(error);
    }
  }

  // Auth
  login(username: string, password: string): Promise<{ token: string; user: AuthUser }> {
    return this.send('POST', 'auth/login', { username, password });
  }
  me(): Promise<AuthUser> {
    return this.get('auth/me');
  }
  changePassword(current: string, next: string): Promise<void> {
    return this.send('POST', 'auth/password', { current, next });
  }

  // Users
  users(): Promise<User[]> {
    return this.get('users');
  }
  createUser(input: { username: string; name: string; password: string; assigneeId?: number | null }): Promise<User> {
    return this.send('POST', 'users', input);
  }
  updateUser(id: number, input: { name?: string; active?: boolean; password?: string; assigneeId?: number | null }): Promise<User> {
    return this.send('PATCH', `users/${id}`, input);
  }

  // Responsibles
  assignees(): Promise<Assignee[]> {
    return this.get('assignees');
  }
  createAssignee(name: string): Promise<Assignee> {
    return this.send('POST', 'assignees', { name });
  }
  updateAssignee(id: number, input: { name?: string; active?: boolean }): Promise<Assignee> {
    return this.send('PATCH', `assignees/${id}`, input);
  }
  deleteAssignee(id: number): Promise<void> {
    return this.send('DELETE', `assignees/${id}`);
  }

  // Catalogs
  modules(all = false): Promise<SystemModule[]> {
    return this.get('modules', { all: all ? '1' : undefined });
  }
  createModule(input: { name: string; parentId?: number | null }): Promise<{ id: number }> {
    return this.send('POST', 'modules', input);
  }
  updateModule(id: number, input: { name?: string; parentId?: number | null; active?: boolean }): Promise<void> {
    return this.send('PATCH', `modules/${id}`, input);
  }
  sla(): Promise<{ priority: Priority; hours: number }[]> {
    return this.get('sla');
  }
  saveSla(items: { priority: Priority; hours: number }[]): Promise<void> {
    return this.send('PUT', 'sla', { items });
  }

  // Tickets
  tickets(filters: TicketFilters): Promise<TicketPage> {
    return this.get('tickets', { ...filters });
  }
  reminders(): Promise<ReminderList> {
    return this.get('tickets/reminders');
  }
  reminderSettings(): Promise<ReminderSettings> {
    return this.get('settings/reminders');
  }
  /** Saves only the fields given. */
  saveReminderSettings(settings: Partial<ReminderSettings>): Promise<void> {
    return this.send('PUT', 'settings/reminders', settings);
  }
  /** The company logo in use, by its version. Answered without a session: the login page asks too. */
  branding(): Promise<{ logoVersion: string | null }> {
    return this.get('branding');
  }
  saveLogo(image: File): Promise<{ logoVersion: string }> {
    const form = new FormData();
    form.append('file', image, image.name);
    return this.send('PUT', 'branding/logo', form);
  }
  removeLogo(): Promise<void> {
    return this.send('DELETE', 'branding/logo');
  }
  companies(q: string): Promise<string[]> {
    return this.get('tickets/companies', { q });
  }
  ticket(id: number): Promise<TicketDetail> {
    return this.get(`tickets/${id}`);
  }
  // Every write to a case below announces its result; callers do not refresh other screens.
  createTicket(input: TicketInput): Promise<TicketDetail> {
    return this.announce(this.send('POST', 'tickets', input), true);
  }
  updateTicket(id: number, input: TicketInput): Promise<TicketDetail> {
    return this.announce(this.send('PATCH', `tickets/${id}`, input));
  }
  async deleteTicket(id: number): Promise<void> {
    await this.send('DELETE', `tickets/${id}`);
    this.ticketEvents.removed(id);
  }
  addNote(id: number, text: string): Promise<TicketDetail> {
    return this.announce(this.send('POST', `tickets/${id}/notes`, { text }));
  }
  deleteNote(id: number, noteId: number): Promise<TicketDetail> {
    return this.announce(this.send('DELETE', `tickets/${id}/notes/${noteId}`));
  }
  timer(id: number, action: 'start' | 'stop'): Promise<TicketDetail> {
    return this.announce(this.send('POST', `tickets/${id}/timer/${action}`));
  }
  uploadAttachments(id: number, files: File[]): Promise<TicketDetail> {
    const form = new FormData();
    for (const file of files) form.append('files', file, file.name);
    return this.announce(this.send('POST', `tickets/${id}/attachments`, form));
  }
  attachmentBlob(id: number): Promise<Blob> {
    return this.blob(`attachments/${id}`);
  }
  /** The delete answers nothing, so the case is read again to announce how it stands now. */
  async deleteAttachment(ticketId: number, id: number): Promise<TicketDetail> {
    await this.send('DELETE', `attachments/${id}`);
    return this.announce(this.ticket(ticketId));
  }

  // AI
  aiConfig(): Promise<AiProviderConfig[]> {
    return this.get('ai/config');
  }
  saveAiConfig(provider: string, input: { apiKey?: string; baseUrl?: string | null; model?: string | null; active?: boolean }): Promise<void> {
    return this.send('PUT', `ai/config/${provider}`, input);
  }
  aiModels(provider: string, apiKey?: string, baseUrl?: string | null): Promise<AiModel[]> {
    return this.send('POST', 'ai/models', { provider, apiKey: apiKey || undefined, baseUrl: baseUrl ?? undefined });
  }
  aiTest(provider: string): Promise<{ ok: boolean; message: string; ms: number }> {
    return this.send('POST', `ai/test/${provider}`);
  }
  /** Asks the AI for the message to send to the client; the server stores it on the case. */
  aiReply(ticketId: number): Promise<TicketDetail> {
    return this.announce(this.send('POST', `ai/reply/${ticketId}`));
  }
  aiAnalyze(text: string, images: File[]): Promise<TicketDraft> {
    const form = new FormData();
    form.append('text', text);
    for (const image of images) form.append('images', image, image.name);
    return this.send('POST', 'ai/analyze', form);
  }

  // Dashboard and transfer
  dashboard(from?: string, to?: string): Promise<Dashboard> {
    return this.get('dashboard', { from, to });
  }
  async importFile(file: File, dryRun: boolean, dateOrder: 'mdy' | 'dmy'): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    const result = await this.send<ImportResult>('POST', 'import', form, { dryRun: dryRun ? '1' : undefined, dateOrder });
    // A preview writes nothing. A real import adds many cases at once.
    if (!dryRun) this.ticketEvents.outdated(null);
    return result;
  }
  /** The spreadsheet to fill in for an import: the columns it reads, with lists and a date check on the cells. */
  importTemplate(): Promise<Blob> {
    return this.blob('import/template');
  }
  exportFile(format: 'xlsx' | 'pdf', filters: TicketFilters): Promise<Blob> {
    return this.blob(`export/${format}`, { ...filters, page: undefined, pageSize: undefined });
  }
}
