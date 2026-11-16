import { FAILURE_WINDOW_MS, LOCK_MS, LoginFailures, MAX_FAILURES, MAX_TRACKED } from './login-failures';

describe('LoginFailures', () => {
  const T0 = 1_000_000;

  /** `times` failed logins of `username` at `now`. */
  const failTimes = (failures: LoginFailures, username: string, times: number, now = T0): void => {
    for (let i = 0; i < times; i++) failures.fail(username, now);
  };

  describe('lock', () => {
    it('locks a username at the fifth failure in a row, not before', () => {
      const failures = new LoginFailures();

      failTimes(failures, 'ana', MAX_FAILURES - 1);
      expect(failures.isLocked('ana', T0)).toBe(false);

      failures.fail('ana', T0);
      expect(MAX_FAILURES).toBe(5);
      expect(failures.isLocked('ana', T0)).toBe(true);
      // Only that username.
      expect(failures.isLocked('luis', T0)).toBe(false);
    });

    it('keeps the lock for a minute, and then counts five failures again', () => {
      const failures = new LoginFailures();
      failTimes(failures, 'ana', MAX_FAILURES);

      expect(LOCK_MS).toBe(60_000);
      expect(failures.isLocked('ana', T0 + LOCK_MS - 1)).toBe(true);
      expect(failures.isLocked('ana', T0 + LOCK_MS)).toBe(false);

      const after = T0 + LOCK_MS;
      failTimes(failures, 'ana', MAX_FAILURES - 1, after);
      expect(failures.isLocked('ana', after)).toBe(false);
      failures.fail('ana', after);
      expect(failures.isLocked('ana', after)).toBe(true);
    });

    it('starts the count again after a successful login', () => {
      const failures = new LoginFailures();
      failTimes(failures, 'ana', MAX_FAILURES - 1);

      failures.clear('ana');
      failTimes(failures, 'ana', MAX_FAILURES - 1);

      expect(failures.isLocked('ana', T0)).toBe(false);
      expect(failures.size).toBe(1);
    });

    it('forgets failures older than the window', () => {
      const failures = new LoginFailures();
      failTimes(failures, 'ana', MAX_FAILURES - 1);

      failures.fail('ana', T0 + FAILURE_WINDOW_MS);
      expect(failures.isLocked('ana', T0 + FAILURE_WINDOW_MS)).toBe(false);

      // That one counts from there.
      failTimes(failures, 'ana', MAX_FAILURES - 2, T0 + FAILURE_WINDOW_MS + 1);
      expect(failures.isLocked('ana', T0 + FAILURE_WINDOW_MS + 1)).toBe(false);
      failures.fail('ana', T0 + FAILURE_WINDOW_MS + 1);
      expect(failures.isLocked('ana', T0 + FAILURE_WINDOW_MS + 1)).toBe(true);
    });

    // Two attempts that both passed the check before the lock, the second failing after it.
    it('leaves a lock as it is when a failure arrives during it', () => {
      const failures = new LoginFailures();
      failTimes(failures, 'ana', MAX_FAILURES);

      failures.fail('ana', T0 + 1000);

      expect(failures.isLocked('ana', T0 + 1000)).toBe(true);
      expect(failures.isLocked('ana', T0 + LOCK_MS - 1)).toBe(true);
      expect(failures.isLocked('ana', T0 + LOCK_MS)).toBe(false);
    });
  });

  describe('when the map is full', () => {
    it('drops the expired entries first, even when they are not the oldest', () => {
      const failures = new LoginFailures(3);
      failTimes(failures, 'a', MAX_FAILURES - 1, T0);
      failTimes(failures, 'b', MAX_FAILURES - 1, T0);
      failTimes(failures, 'was-locked', MAX_FAILURES, T0 + 1);
      const later = T0 + 1 + LOCK_MS;

      failures.fail('c', later);

      expect(failures.size).toBe(3);
      // The lock that is over made the room: a and b, older, keep their four failures.
      failures.fail('a', later);
      failures.fail('b', later);
      expect(failures.isLocked('a', later)).toBe(true);
      expect(failures.isLocked('b', later)).toBe(true);
    });

    it('then drops the ones that are not locked, the one that failed longest ago first', () => {
      const failures = new LoginFailures(3);
      failTimes(failures, 'a', 3, T0);
      failTimes(failures, 'b', 3, T0 + 1);
      failTimes(failures, 'c', 3, T0 + 2);
      // a fails again: b is the one whose last failure is the oldest now.
      failures.fail('a', T0 + 3);

      failures.fail('new', T0 + 4);

      expect(failures.size).toBe(3);
      // a and c kept their failures: they lock at the fifth.
      failures.fail('a', T0 + 5);
      failTimes(failures, 'c', 2, T0 + 5);
      expect(failures.isLocked('a', T0 + 5)).toBe(true);
      expect(failures.isLocked('c', T0 + 5)).toBe(true);
      // b lost its three: two more do not lock it.
      failTimes(failures, 'b', 2, T0 + 6);
      expect(failures.isLocked('b', T0 + 6)).toBe(false);
    });

    it('never drops a locked username, even the oldest', () => {
      const failures = new LoginFailures(3);
      failTimes(failures, 'ana', MAX_FAILURES, T0);
      failures.fail('x1', T0 + 1);
      failures.fail('x2', T0 + 2);

      for (let i = 0; i < 50; i++) failures.fail(`made-up-${i}`, T0 + 10 + i);

      expect(failures.isLocked('ana', T0 + 100)).toBe(true);
      expect(failures.size).toBe(3);
    });

    // Every entry locked: the map grows past its size instead of unlocking one. Each lock costs
    // five attempts and is over in a minute, so it cannot grow far.
    it('goes past its size rather than drop a lock', () => {
      const failures = new LoginFailures(2);
      failTimes(failures, 'ana', MAX_FAILURES);
      failTimes(failures, 'luis', MAX_FAILURES);

      failures.fail('third', T0);

      expect(failures.size).toBe(3);
      expect(failures.isLocked('ana', T0)).toBe(true);
      expect(failures.isLocked('luis', T0)).toBe(true);

      // Once those locks are over, they are the first to go.
      failures.fail('fourth', T0 + LOCK_MS);
      expect(failures.size).toBe(2);
    });

    // What happened before: past 5000 usernames the whole map was emptied, the locks with it.
    it('keeps a locked real username through a flood of made-up ones', () => {
      const failures = new LoginFailures();
      failTimes(failures, 'admin', MAX_FAILURES);

      for (let i = 0; i < MAX_TRACKED * 2; i++) failures.fail(`made-up-${i}`, T0 + 1);

      expect(failures.isLocked('admin', T0 + 1)).toBe(true);
      expect(failures.size).toBe(MAX_TRACKED);
    });
  });
});
