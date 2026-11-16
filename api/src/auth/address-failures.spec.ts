import { RATE_WINDOW_MS } from '../common/throttle';
import { AddressFailures, MAX_ADDRESSES } from './address-failures';

describe('AddressFailures', () => {
  const T0 = 1_000_000;

  /** `times` failed logins from `address` at `now`. */
  const failTimes = (failures: AddressFailures, address: string, times: number, now = T0): void => {
    for (let i = 0; i < times; i++) failures.fail(address, now);
  };

  describe('limit', () => {
    it('refuses an address once it has failed the limit, not before, for the rest of the minute of its first failure', () => {
      const failures = new AddressFailures(3);

      failTimes(failures, '10.0.0.5', 2);
      expect(failures.blockedFor('10.0.0.5', T0)).toBe(0);
      failures.fail('10.0.0.5', T0 + 10_000);

      expect(failures.blockedFor('10.0.0.5', T0 + 10_000)).toBe(RATE_WINDOW_MS - 10_000);
      expect(failures.blockedFor('10.0.0.5', T0 + RATE_WINDOW_MS - 1)).toBe(1);
      expect(failures.blockedFor('10.0.0.5', T0 + RATE_WINDOW_MS)).toBe(0);
      // Only that address.
      expect(failures.blockedFor('10.0.0.6', T0 + 10_000)).toBe(0);
    });

    it('starts a new window, from none, once the minute is over', () => {
      const failures = new AddressFailures(3);
      failTimes(failures, '10.0.0.5', 3);

      const later = T0 + RATE_WINDOW_MS;
      failTimes(failures, '10.0.0.5', 2, later);
      expect(failures.blockedFor('10.0.0.5', later)).toBe(0);
      failures.fail('10.0.0.5', later);
      expect(failures.blockedFor('10.0.0.5', later)).toBe(RATE_WINDOW_MS);
    });

    // A login counts from when it starts; the one whose password was right is taken back.
    it('takes a failure back, once, and leaves the others', () => {
      const failures = new AddressFailures(3);
      failTimes(failures, '10.0.0.5', 2);
      const takeBack = failures.fail('10.0.0.5', T0);
      expect(failures.blockedFor('10.0.0.5', T0)).toBeGreaterThan(0);

      takeBack();
      takeBack();

      expect(failures.blockedFor('10.0.0.5', T0)).toBe(0);
      failures.fail('10.0.0.5', T0);
      expect(failures.blockedFor('10.0.0.5', T0)).toBeGreaterThan(0);
    });

    // The window it was counted in is over: taking it back must not take one of the new window.
    it('takes nothing back from a window that started after the failure', () => {
      const failures = new AddressFailures(2);
      const takeBack = failures.fail('10.0.0.5', T0);
      const later = T0 + RATE_WINDOW_MS;
      failTimes(failures, '10.0.0.5', 2, later);

      takeBack();

      expect(failures.blockedFor('10.0.0.5', later)).toBe(RATE_WINDOW_MS);
    });
  });

  describe('when the map is full', () => {
    it('drops the windows that are over first, even when they are not the oldest', () => {
      const failures = new AddressFailures(3, 3);
      failTimes(failures, 'a', 2, T0);
      failTimes(failures, 'b', 2, T0);
      failTimes(failures, 'over', 3, T0 - RATE_WINDOW_MS + 1);
      const later = T0 + 1;

      failures.fail('c', later);

      expect(failures.size).toBe(3);
      // a and b kept their two failures: the third refuses them.
      failures.fail('a', later);
      failures.fail('b', later);
      expect(failures.blockedFor('a', later)).toBeGreaterThan(0);
      expect(failures.blockedFor('b', later)).toBeGreaterThan(0);
    });

    it('then drops the oldest windows still under the limit, before any refused address', () => {
      const failures = new AddressFailures(3, 3);
      failTimes(failures, 'refused', 3, T0);
      failTimes(failures, 'older', 1, T0 + 1);
      failTimes(failures, 'newer', 1, T0 + 2);

      failures.fail('new', T0 + 3);

      expect(failures.size).toBe(3);
      expect(failures.blockedFor('refused', T0 + 3)).toBeGreaterThan(0);
      // newer kept its failure; older lost its own.
      failTimes(failures, 'newer', 2, T0 + 4);
      expect(failures.blockedFor('newer', T0 + 4)).toBeGreaterThan(0);
      failTimes(failures, 'older', 2, T0 + 5);
      expect(failures.blockedFor('older', T0 + 5)).toBe(0);
    });

    // Unlike the locks of usernames, it never grows past its size: the oldest refused address goes.
    it('drops the oldest refused address when every one is refused, and never holds more than its size', () => {
      const failures = new AddressFailures(1, 2);
      failures.fail('first', T0);
      failures.fail('second', T0 + 1);

      failures.fail('third', T0 + 2);

      expect(failures.size).toBe(2);
      expect(failures.blockedFor('first', T0 + 2)).toBe(0);
      expect(failures.blockedFor('second', T0 + 2)).toBeGreaterThan(0);
      expect(failures.blockedFor('third', T0 + 2)).toBeGreaterThan(0);
    });

    it('stays at its size through a flood of addresses', () => {
      const failures = new AddressFailures(20);

      for (let i = 0; i < MAX_ADDRESSES * 2; i++) failures.fail(`addr-${i}`, T0 + i);

      expect(MAX_ADDRESSES).toBe(5000);
      expect(failures.size).toBe(MAX_ADDRESSES);
    });
  });
});
