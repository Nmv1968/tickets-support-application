import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { httpTestBed } from '../testing/http';
import type { ReminderList, Ticket } from './api';
import { Auth } from './auth';
import { Reminders } from './reminders';
import { TicketEvents } from './ticket-events';

// The bell. It used to have a "Míos" switch that kept only the cases of the logged-in user,
// while a user could be linked to a responsible. Users are not responsibles any more, so
// everyone sees the same reminders.
describe('Reminders', () => {
  let http: HttpTestingController;
  let reminders: Reminders;

  const ticket = (id: number, assigneeId: number | null): Ticket => ({ id, code: `SOP-${id}`, assigneeId }) as Ticket;
  const list = (groups: Partial<ReminderList>): ReminderList => ({ staleHours: 48, promiseSoonDays: 0, promises: [], stale: [], overdue: [], ...groups });

  beforeEach(() => {
    http = httpTestBed(provideRouter([]));
    TestBed.inject(Auth).user.set({ id: 7, username: 'ana', name: 'Ana', role: 'AGENT' });
    reminders = TestBed.inject(Reminders);
  });

  afterEach(() => http.verify());

  const read = (): TestRequest => http.expectOne({ method: 'GET', url: '/api/tickets/reminders' });

  function load(groups: Partial<ReminderList>): void {
    void reminders.refresh();
    read().flush(list(groups));
    tick();
  }

  // Number 7 is both the logged-in user and a responsible: the two have nothing to do with each other.
  it('shows every case that needs attention, whoever its responsible is and whoever is logged in', fakeAsync(() => {
    load({ stale: [ticket(1, 2), ticket(2, 7), ticket(3, null)] });

    expect(reminders.stale().map((item) => item.id)).toEqual([1, 2, 3]);
    expect(reminders.count()).toBe(3);
  }));

  it('counts once a case that needs attention for more than one reason', fakeAsync(() => {
    load({ promises: [ticket(1, 2)], stale: [ticket(1, 2), ticket(2, null)], overdue: [ticket(2, null), ticket(3, null)] });

    expect(reminders.promises().length).toBe(1);
    expect(reminders.stale().length).toBe(2);
    expect(reminders.overdue().length).toBe(2);
    expect(reminders.count()).toBe(3);
  }));

  it('keeps the last list when it cannot be read again', fakeAsync(() => {
    load({ stale: [ticket(1, 2)] });

    void reminders.refresh();
    read().error(new ProgressEvent('error'));
    tick();

    expect(reminders.stale().map((item) => item.id)).toEqual([1]);
  }));

  it('asks for nothing once the session is over', fakeAsync(() => {
    TestBed.inject(Auth).user.set(null);
    void reminders.refresh();
    tick();

    http.expectNone('/api/tickets/reminders');
  }));

  // Any change to a case can add or remove a reminder. Several in a row are one read.
  it('is read again shortly after cases change, once for several changes', fakeAsync(() => {
    reminders.start();
    read().flush(list({}));
    tick();

    const events = TestBed.inject(TicketEvents);
    events.outdated(1);
    tick(500);
    events.removed(2);
    tick(799);
    http.expectNone('/api/tickets/reminders');

    tick(1);
    read().flush(list({ overdue: [ticket(3, null)] }));
    tick();
    expect(reminders.count()).toBe(1);
    // Its own timers are stopped here: the test owns the clock.
    reminders.stop();
  }));
});
