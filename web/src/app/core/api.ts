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
}

/** A person a case can be assigned to ("Responsable"). A name in a list of its own: not a user of the app. */
export interface Assignee {
  id: number;
  name: string;
  /** False keeps the cases they have and takes them out of the lists for new ones. */
  active: boolean;
  /** Cases assigned to them, open or closed. With any, the responsible cannot be deleted. */
  tickets: number;
}

/** A client company that reports cases ("Empresa"). */
export interface Company {
  id: number;
  name: string;
  /** False keeps its cases and takes it out of the lists for new ones. */
  active: boolean;
  /** Cases of the company, open or closed. With any, the company cannot be deleted. */
  tickets: number;
}

/** A label a case can carry ("Tipo de soporte"): system failure, the user did not know how… */
export interface SupportType {
  id: number;
  name: string;
  /** `#rrggbb`, lowercase. */
  color: string;
  /** False keeps it on the cases that carry it and takes it out of the lists for new ones. */
  active: boolean;
  /** Cases that carry it. With any, the type cannot be deleted. */
  tickets: number;
}

/** A support type as a case carries it. */
export type TicketSupportType = Pick<SupportType, 'id' | 'name' | 'color'>;

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
  companyId: number;
  /** Name of the company. */
  company: string;
  description: string;
  status: TicketStatus;
  assigneeId: number | null;
  assigneeName: string | null;
  /** "Tipos de soporte" of the case, by name. Empty for a case without any. */
  supportTypes: TicketSupportType[];
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
  /** The user who registered it, when there is one to name. */
  createdById: number | null;
  /** Moment the case was archived. Null = not archived. */
  archivedAt: string | null;
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
  /** A company of the catalog. A new case needs one. */
  companyId?: number;
  description?: string;
  status?: TicketStatus;
  /** Null leaves the case without a responsible, which is also how a new case starts. */
  assigneeId?: number | null;
  /** The whole set: the types left out are taken off the case, and `[]` takes all of them off. */
  supportTypeIds?: number[];
  /** True archives the case, false brings it back. */
  archived?: boolean;
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

/**
 * Query-string filters. Empty values (`''`, null) are not sent. An id is a number where a select
 * gives it and text where it comes from a link.
 */
export interface TicketFilters {
  status?: string;
  /** Id of a responsible, or `none` for the cases without one. */
  assignee?: number | string | null;
  companyId?: number | string | null;
  priority?: string | null;
  moduleId?: number | string | null;
  /** Id of a support type: the cases that carry it. */
  supportType?: number | string | null;
  /** Id of a user: the cases they registered. */
  createdBy?: number | string | null;
  /** Archived cases are left out unless this asks for `only` them or for `all` (them and the rest). */
  archived?: 'only' | 'all' | '' | null;
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
  /** A case with two types counts in both. The cases without one come as "Sin tipo", with no colour. */
  bySupportType: { name: string; color: string | null; total: number }[];
  byModule: { name: string; total: number }[];
  byPriority: { priority: Priority | null; total: number }[];
  monthly: { month: string; total: number; resolved: number; open: number }[];
}

/** A row of the sheet as the import read it. What comes from a catalog carries the name the catalog gives it. */
export interface ImportRow {
  date: string;
  time: string | null;
  company: string;
  description: string;
  status: TicketStatus;
  priority: Priority | null;
  /** Full name of the module. */
  module: string | null;
  assignee: string | null;
  supportTypes: string[];
  note: string | null;
}

/** The values of the sheet that are in no catalog, by catalog, as they were first written. */
export interface ImportUnknown {
  companies: string[];
  assignees: string[];
  supportTypes: string[];
  modules: string[];
  priorities: string[];
  /** What the sheet says in "Estado" that is none of the three statuses. */
  statuses: string[];
}

export interface ImportResult {
  dryRun: boolean;
  /** The import was asked to add the companies, responsibles and support types that do not exist. */
  createMissing: boolean;
  /**
   * Header found in the sheet for each column the import reads, or null when the sheet does not
   * have it. Several columns of support types come together, separated by commas.
   */
  columns: Record<'date' | 'time' | 'company' | 'description' | 'status' | 'priority' | 'module' | 'assignee' | 'supportTypes' | 'note', string | null>;
  totalRows: number;
  skippedEmpty: number;
  duplicates: number;
  /** Rows that can be imported: the rejected ones are not counted. */
  toCreate: number;
  /** Rows left out because a value of theirs is in no catalog. */
  rejected: number;
  /** The first rejected rows, each with its row number in the sheet and why it was left out. */
  rejectedSample: { row: number; reasons: string[] }[];
  unknown: ImportUnknown;
  /** What `createMissing` adds to the catalogs. In a preview, what it would add. */
  created: Pick<ImportUnknown, 'companies' | 'assignees' | 'supportTypes'>;
  /** The first rows that can be imported. */
  sample: ImportRow[];
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
   * it without the caller passing it on (see TicketEvents). `change` says what the write did
   * besides editing the case: it created it, or archived it or brought it back.
   */
  private async announce(write: Promise<TicketDetail>, change: { created?: boolean; archiving?: boolean } = {}): Promise<TicketDetail> {
    const ticket = await write;
    this.ticketEvents.saved(ticket, change);
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
  createUser(input: { username: string; name: string; password: string }): Promise<User> {
    return this.send('POST', 'users', input);
  }
  updateUser(id: number, input: { name?: string; active?: boolean; password?: string }): Promise<User> {
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

  // Companies
  companies(): Promise<Company[]> {
    return this.get('companies');
  }
  createCompany(name: string): Promise<Company> {
    return this.send('POST', 'companies', { name });
  }
  updateCompany(id: number, input: { name?: string; active?: boolean }): Promise<Company> {
    return this.send('PATCH', `companies/${id}`, input);
  }
  deleteCompany(id: number): Promise<void> {
    return this.send('DELETE', `companies/${id}`);
  }

  // Support types
  supportTypes(): Promise<SupportType[]> {
    return this.get('support-types');
  }
  createSupportType(input: { name: string; color: string }): Promise<SupportType> {
    return this.send('POST', 'support-types', input);
  }
  updateSupportType(id: number, input: { name?: string; color?: string; active?: boolean }): Promise<SupportType> {
    return this.send('PATCH', `support-types/${id}`, input);
  }
  deleteSupportType(id: number): Promise<void> {
    return this.send('DELETE', `support-types/${id}`);
  }

  // Preferences of the logged-in user: nobody else reads or changes them.
  /** What this user saved under `key`, or null when they never saved it. */
  async preference<T>(key: string): Promise<T | null> {
    return (await this.get<{ value: T | null }>(`preferences/${key}`)).value;
  }
  savePreference(key: string, value: unknown): Promise<void> {
    return this.send('PUT', `preferences/${key}`, { value });
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
  ticket(id: number): Promise<TicketDetail> {
    return this.get(`tickets/${id}`);
  }
  // Every write to a case below announces its result; callers do not refresh other screens.
  createTicket(input: TicketInput): Promise<TicketDetail> {
    return this.announce(this.send('POST', 'tickets', input), { created: true });
  }
  updateTicket(id: number, input: TicketInput): Promise<TicketDetail> {
    return this.announce(this.send('PATCH', `tickets/${id}`, input), { archiving: input.archived !== undefined });
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
  /** Archived cases count unless `includeArchived` is false. */
  dashboard(from?: string, to?: string, includeArchived = true): Promise<Dashboard> {
    return this.get('dashboard', { from, to, archived: includeArchived ? undefined : 'exclude' });
  }
  /** The report of the dashboard as a file, for the same period and cases as `dashboard`. */
  dashboardExport(format: 'xlsx' | 'pdf', from?: string, to?: string, includeArchived = true): Promise<Blob> {
    return this.blob(`dashboard/export/${format}`, { from, to, archived: includeArchived ? undefined : 'exclude' });
  }
  /**
   * `createMissing` adds the companies, responsibles and support types of the sheet that do not
   * exist; without it, the rows that name them are rejected.
   */
  async importFile(file: File, dryRun: boolean, dateOrder: 'mdy' | 'dmy', createMissing = false): Promise<ImportResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    const params = { dryRun: dryRun ? '1' : undefined, dateOrder, createMissing: createMissing ? '1' : undefined };
    const result = await this.send<ImportResult>('POST', 'import', form, params);
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
