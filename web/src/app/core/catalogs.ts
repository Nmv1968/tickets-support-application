import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import type { Assignee, SystemModule, User } from './api';
import { Auth } from './auth';

/** Users, responsibles, modules and AI availability, loaded once and shared by every screen. */
@Injectable({ providedIn: 'root' })
export class Catalogs {
  private readonly api = inject(Api);
  private readonly auth = inject(Auth);

  readonly users = signal<User[]>([]);
  /** Everyone a case can be assigned to, active or not. They need not be users. */
  readonly assignees = signal<Assignee[]>([]);
  readonly modules = signal<SystemModule[]>([]);
  /** True when an AI provider is active with a model chosen. Screens use it to offer AI actions. */
  readonly aiReady = signal(false);

  /** The responsibles offered for a new case. */
  readonly activeAssignees = computed(() => this.assignees().filter((person) => person.active));

  /** Id of the responsible the logged-in user is. Null for a user who does not attend cases. */
  readonly ownAssigneeId = computed(() => {
    const me = this.auth.user()?.id;
    const linked = this.users().find((user) => user.id === me)?.assigneeId ?? null;
    // A link to someone who is no longer in the catalog is no link.
    return this.assignees().some((person) => person.id === linked) ? linked : null;
  });

  /**
   * Value of the "Responsable" select a new case starts with: the logged-in user's own responsible
   * while active, otherwise nobody.
   */
  readonly ownAssignee = computed(() => {
    const own = this.ownAssigneeId();
    return this.activeAssignees().some((person) => person.id === own) ? String(own) : '';
  });

  private loaded = false;

  async ensure(): Promise<void> {
    if (!this.loaded) await this.reload();
  }

  async reload(): Promise<void> {
    const [users, assignees, modules, ai] = await Promise.all([this.api.users(), this.api.assignees(), this.api.modules(), this.api.aiConfig()]);
    this.users.set(users);
    this.assignees.set(assignees);
    this.modules.set(modules);
    this.aiReady.set(ai.some((provider) => provider.active && !!provider.model));
    this.loaded = true;
  }
}

/**
 * The "Responsable" select uses one value for three cases:
 * the id of a responsible, `client` (the client is responsible) or `` (nobody).
 */
export function assigneeValue(ticket: { assigneeId: number | null; assignedToClient: boolean }): string {
  return ticket.assignedToClient ? 'client' : ticket.assigneeId ? String(ticket.assigneeId) : '';
}

export function assigneeInput(value: string): { assigneeId: number | null; assignedToClient: boolean } {
  if (value === 'client') return { assigneeId: null, assignedToClient: true };
  return { assigneeId: value ? Number(value) : null, assignedToClient: false };
}
