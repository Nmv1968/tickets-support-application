import { Injectable, inject } from '@angular/core';
import type { CanDeactivateFn } from '@angular/router';
import { Auth } from './auth';

/** Asks the person, when there is something to lose, and resolves to whether what is on screen can be left. */
type LeaveCheck = () => Promise<boolean>;

/**
 * Work on screen that is not saved yet: the draft of the case form. Whatever holds some says
 * here how it asks before it is left. The form asks by itself on its own ways out (its button,
 * Escape…). This is for the ones it cannot see, which take the whole screen away: the Back
 * button of the browser or of a phone, and a link to another screen.
 */
@Injectable({ providedIn: 'root' })
export class UnsavedChanges {
  private readonly holders = new Set<LeaveCheck>();

  /** Registers the check of something that is on screen. Returns what takes it back, for when it goes. */
  watch(mayLeave: LeaveCheck): () => void {
    this.holders.add(mayLeave);
    return () => this.holders.delete(mayLeave);
  }

  /** Whether the screen can be left: every holder says so, each one asking the person if it has to. */
  async mayLeave(): Promise<boolean> {
    for (const mayLeave of [...this.holders]) {
      if (!(await mayLeave())) return false;
    }
    return true;
  }
}

/**
 * Keeps a screen from being left while the person would rather go on with what it holds unsaved.
 * Not once the session has ended: nothing can be saved any more, and the way to the login stays open.
 */
export const unsavedChangesGuard: CanDeactivateFn<unknown> = () => !inject(Auth).user() || inject(UnsavedChanges).mayLeave();
