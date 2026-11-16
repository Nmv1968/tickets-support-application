import { day } from '../common/testing';
import { NOW } from './testing';
import { promiseState } from './ticket-mappers';
import type { PromiseState, StoredTicket } from './ticket-mappers';

describe('promiseState', () => {
  beforeAll(() => jest.useFakeTimers({ now: NOW }));
  afterAll(() => jest.useRealTimers());

  const state = (promisedDate: string | null, soonDays = 0, status: StoredTicket['status'] = 'PENDING'): PromiseState | null =>
    promiseState({ status, promisedDate: promisedDate ? day(promisedDate) : null }, soonDays);

  it('is null without a promise or once the case is resolved', () => {
    expect(state(null)).toBeNull();
    expect(state('2026-11-01', 3, 'RESOLVED')).toBeNull();
  });

  it('is overdue after the promised day and today on it', () => {
    expect(state('2026-11-10')).toBe('overdue');
    expect(state('2026-11-11')).toBe('today');
    expect(state('2026-11-10', 3, 'UNRESOLVED')).toBe('overdue');
  });

  it('is soon within the advance notice and later beyond it', () => {
    expect(state('2026-11-12', 3)).toBe('soon');
    expect(state('2026-11-14', 3)).toBe('soon');
    expect(state('2026-11-15', 3)).toBe('later');
  });

  it('is never soon when advance notice is off', () => {
    expect(state('2026-11-12', 0)).toBe('later');
  });
});
