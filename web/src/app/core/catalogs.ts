import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import type { SystemModule, User } from './api';

/** Users, modules and AI availability, loaded once and shared by every screen. */
@Injectable({ providedIn: 'root' })
export class Catalogs {
  private readonly api = inject(Api);

  readonly users = signal<User[]>([]);
  readonly modules = signal<SystemModule[]>([]);
  /** True when an AI provider is active with a model chosen. Screens use it to offer AI actions. */
  readonly aiReady = signal(false);

  /** People who can be chosen as responsible. */
  readonly activeUsers = computed(() => this.users().filter((user) => user.active));

  private loaded = false;

  async ensure(): Promise<void> {
    if (!this.loaded) await this.reload();
  }

  async reload(): Promise<void> {
    const [users, modules, ai] = await Promise.all([this.api.users(), this.api.modules(), this.api.aiConfig()]);
    this.users.set(users);
    this.modules.set(modules);
    this.aiReady.set(ai.some((provider) => provider.active && !!provider.model));
    this.loaded = true;
  }
}

/**
 * The "Responsable" select uses one value for three cases:
 * a user id, `client` (the client is responsible) or `` (nobody).
 */
export function assigneeValue(ticket: { assigneeId: number | null; assignedToClient: boolean }): string {
  return ticket.assignedToClient ? 'client' : ticket.assigneeId ? String(ticket.assigneeId) : '';
}

export function assigneeInput(value: string): { assigneeId: number | null; assignedToClient: boolean } {
  if (value === 'client') return { assigneeId: null, assignedToClient: true };
  return { assigneeId: value ? Number(value) : null, assignedToClient: false };
}
