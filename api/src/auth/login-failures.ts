/** Failed logins in a row that lock a username. */
export const MAX_FAILURES = 5;
/** How long a locked username stays locked. */
export const LOCK_MS = 60_000;
/** A failure older than this no longer counts towards a lock. */
export const FAILURE_WINDOW_MS = 15 * 60_000;
/** Usernames tracked at most, before the old ones make room for new ones. */
export const MAX_TRACKED = 5000;

interface Entry {
  /** Failures in a row since the last lock. */
  count: number;
  /** Until when the username is locked; 0 when it is not. */
  lockedUntil: number;
  lastFailure: number;
}

/**
 * Failed logins per username, in memory: enough for one API instance. A wrong current password in
 * a change of the own password counts the same, for the username of the session: one count and one
 * lock for both routes. Usernames that do not exist are counted too (counting only real ones
 * would tell which exist), so the map is bounded:
 * when it is full, the expired entries go first, then the oldest ones that are not locked. A
 * locked username is never dropped, or failures with made-up usernames would unlock a real one.
 * Each lock takes `MAX_FAILURES` attempts, which the limit of failed logins per address keeps
 * slow, and lasts a minute: the map only goes past its size while that many are locked at once.
 */
export class LoginFailures {
  /** In the order of the last failure, the oldest first: each failure moves its entry to the end. */
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly capacity = MAX_TRACKED) {}

  get size(): number {
    return this.entries.size;
  }

  isLocked(username: string, now = Date.now()): boolean {
    return this.lockedFor(username, now) > 0;
  }

  /** Milliseconds left of the lock of the username; 0 when it is not locked. */
  lockedFor(username: string, now = Date.now()): number {
    return Math.max(0, (this.entries.get(username)?.lockedUntil ?? 0) - now);
  }

  /** Counts a failed login; the `MAX_FAILURES`-th in a row locks the username for `LOCK_MS`. */
  fail(username: string, now = Date.now()): void {
    const entry = this.entries.get(username);
    // A request that started before the lock and failed after it leaves the lock as it is.
    if (entry && entry.lockedUntil > now) return;

    const previous = entry && !this.expired(entry, now) ? entry.count : 0;
    this.entries.delete(username);
    this.makeRoom(now);
    const count = previous + 1;
    this.entries.set(
      username,
      count >= MAX_FAILURES ? { count: 0, lockedUntil: now + LOCK_MS, lastFailure: now } : { count, lockedUntil: 0, lastFailure: now },
    );
  }

  /** A successful login starts the count again. */
  clear(username: string): void {
    this.entries.delete(username);
  }

  /** Neither locked nor holding a failure that still counts: the same as not being here. */
  private expired(entry: Entry, now: number): boolean {
    return entry.lockedUntil <= now && (entry.count === 0 || now - entry.lastFailure >= FAILURE_WINDOW_MS);
  }

  /** Leaves space for one more entry, if it can without dropping a locked one. */
  private makeRoom(now: number): void {
    if (this.entries.size < this.capacity) return;
    for (const [username, entry] of this.entries) {
      if (this.expired(entry, now)) this.entries.delete(username);
    }
    for (const [username, entry] of this.entries) {
      if (this.entries.size < this.capacity) return;
      if (entry.lockedUntil <= now) this.entries.delete(username);
    }
  }
}
