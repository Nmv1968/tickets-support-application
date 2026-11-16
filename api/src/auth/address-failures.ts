import { RATE_WINDOW_MS } from '../common/throttle';

/** Client addresses tracked at most: a new one past it makes room by dropping others. */
export const MAX_ADDRESSES = 5000;

interface Window {
  /** Failed logins of the address in this window, those still being compared included. */
  failures: number;
  /** When the window is over: from then on the address starts again from none. */
  endsAt: number;
}

/**
 * Failed logins per client address, in memory: enough for one API instance. A window of a minute
 * starts with the first failure of an address; once `limit` logins of it have failed, every login
 * from that address is refused until the window is over, the right password included. A login that
 * works does not count, so a team that reaches the API from one address (every client of Docker
 * Desktop does) is never refused for logging in, only for failing.
 *
 * The map is bounded, and never holds more than `capacity` addresses: to make room for a new one
 * it drops the windows that are over, then the oldest windows still under the limit, and only then
 * the oldest refused ones. Dropping a refused address lets it try again early, but only someone
 * failing logins from more addresses than the map holds gets there, and each username still locks
 * after five failures (`LoginFailures`).
 */
export class AddressFailures {
  /** In the order their windows started, the oldest first: a new window goes to the end. */
  private readonly windows = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly capacity = MAX_ADDRESSES,
  ) {}

  get size(): number {
    return this.windows.size;
  }

  /** Milliseconds until a login from the address is accepted again; 0 while it is under the limit. */
  blockedFor(address: string, now = Date.now()): number {
    const window = this.windows.get(address);
    return window && window.endsAt > now && window.failures >= this.limit ? window.endsAt - now : 0;
  }

  /**
   * Counts a failed login of the address, in its window or in a new one. The login counts from when
   * it starts, before its password is compared, so that logins sent all at once cannot pass
   * `blockedFor` together: what this answers takes the failure back, for one whose password turns
   * out right. Called once its window is over, it changes nothing.
   */
  fail(address: string, now = Date.now()): () => void {
    let window = this.windows.get(address);
    if (!window || window.endsAt <= now) {
      this.windows.delete(address);
      this.makeRoom(now);
      window = { failures: 0, endsAt: now + RATE_WINDOW_MS };
      this.windows.set(address, window);
    }
    window.failures++;

    const counted = window;
    let pending = true;
    return () => {
      if (pending && this.windows.get(address) === counted) counted.failures--;
      pending = false;
    };
  }

  /** Leaves space for one more address. */
  private makeRoom(now: number): void {
    if (this.windows.size < this.capacity) return;
    for (const [address, window] of this.windows) {
      if (window.endsAt <= now) this.windows.delete(address);
    }
    this.dropOldest((window) => window.failures < this.limit);
    this.dropOldest(() => true);
  }

  private dropOldest(which: (window: Window) => boolean): void {
    for (const [address, window] of this.windows) {
      if (this.windows.size < this.capacity) return;
      if (which(window)) this.windows.delete(address);
    }
  }
}
