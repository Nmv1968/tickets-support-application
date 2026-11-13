import { inject, signal } from '@angular/core';
import type { Signal, WritableSignal } from '@angular/core';
import { Api } from '../../core/api';
import { Auth } from '../../core/auth';
import { Toast } from '../../core/toast';
import { errorMessage } from '../../core/ui';

/**
 * Something of a screen that each person sets for themselves: the columns of the case list,
 * whether its filters are open. It is kept on the server under the logged-in user, the only one
 * the server gives it to or takes it from. It is never shared, and follows the person to any
 * browser they log in from.
 *
 * A copy stays in this browser so that the screen is right from its first paint, before the
 * server answers. The copy is kept by user id: two people who use the same browser do not get
 * each other's.
 *
 * Created as a field of the component that uses it: it injects what it needs, and reads the
 * server once, right then.
 */
export class UserPreference<T> {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  /** Where the copy of this browser is kept. Null with nobody logged in: there is nobody to keep it for. */
  private readonly copyKey: string | null;
  private readonly state: WritableSignal<T>;
  /** What the screen shows: the person's choice, or `fallback` while they never made one. */
  readonly value: Signal<T>;

  /** The person chose on this screen. What the server answers after that is older than their choice. */
  private chosen = false;
  private saving = false;
  /** The choice changed while a save was on its way: it goes in a save of its own. */
  private unsent = false;

  /**
   * `key` names the preference on the server (`tickets.columns`). `read` takes a stored value,
   * from the server or from this browser, and gives null for one that cannot be used (never
   * saved, or left by a version that kept something else): the screen then stays as it is.
   */
  constructor(
    private readonly key: string,
    fallback: T,
    private readonly read: (stored: unknown) => T | null,
  ) {
    const userId = inject(Auth).user()?.id;
    this.copyKey = userId === undefined ? null : `st.${key}.${userId}`;
    this.state = signal(this.copy() ?? fallback);
    this.value = this.state.asReadonly();
    void this.load();
  }

  /** The person's new choice: on screen and in this browser at once, and sent to the server. */
  set(value: T): void {
    if (JSON.stringify(value) === JSON.stringify(this.state())) return;
    this.chosen = true;
    this.state.set(value);
    this.keep(value);
    void this.save();
  }

  /** What the person saved, as the server has it. It replaces the copy of this browser, which may be older. */
  private async load(): Promise<void> {
    try {
      const saved = this.read(await this.api.preference<unknown>(this.key));
      if (saved === null || this.chosen) return;
      this.state.set(saved);
      this.keep(saved);
    } catch {
      // Without an answer the screen keeps what this browser had. The screen itself says when the server cannot be reached.
    }
  }

  /**
   * One save at a time: two sent side by side could be stored in the other order, and the older
   * choice would be the one kept. What changes meanwhile waits, and is sent as it stands then,
   * also when the save it waited for failed: left for the next change, the server would keep an
   * older choice than the one on screen.
   */
  private async save(): Promise<void> {
    if (this.saving) {
      this.unsent = true;
      return;
    }
    this.saving = true;
    do {
      this.unsent = false;
      try {
        await this.api.savePreference(this.key, this.state());
      } catch (error) {
        // The choice stays on screen and in this browser. The server still has the one before.
        // Nothing is said while a newer choice waits: its own save tells how it ends.
        if (!this.unsent) this.toast.error(`No se pudo guardar tu preferencia: ${errorMessage(error)}`);
      }
    } while (this.unsent);
    this.saving = false;
  }

  private copy(): T | null {
    if (!this.copyKey) return null;
    try {
      const raw = localStorage.getItem(this.copyKey);
      return raw === null ? null : this.read(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  private keep(value: T): void {
    if (!this.copyKey) return;
    try {
      localStorage.setItem(this.copyKey, JSON.stringify(value));
    } catch {
      // A browser that keeps nothing (private window, no room left): the server has the choice.
    }
  }
}
