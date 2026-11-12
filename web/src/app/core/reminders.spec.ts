import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Assignee, ReminderList, Ticket, User } from './api';
import { Auth } from './auth';
import { Catalogs } from './catalogs';
import { Reminders } from './reminders';

// "Míos" in the bell. A case belongs to a responsible of the catalog, not to a user: the cases of
// the logged-in user are the ones of the responsible that user is.
describe('Reminders, narrowed to the cases of the logged-in user', () => {
  let http: HttpTestingController;
  let reminders: Reminders;
  let catalogs: Catalogs;

  const me: User = { id: 7, username: 'ana', name: 'Ana', active: true, canLogin: true, assigneeId: 2 };
  const people: Assignee[] = [
    { id: 2, name: 'Ana', active: true, tickets: 1 },
    // Same number as the user's id: a case of this responsible is not the user's.
    { id: 7, name: 'Luis', active: true, tickets: 1 },
  ];
  const stale = (id: number, assigneeId: number | null): Ticket => ({ id, code: `SOP-${id}`, assigneeId, assignedToClient: false }) as Ticket;
  const list: ReminderList = { staleHours: 48, promiseSoonDays: 0, promises: [], overdue: [], stale: [stale(1, 2), stale(2, 7), stale(3, null)] } as ReminderList;

  beforeEach(() => {
    localStorage.removeItem('st.reminders.mine');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 7, username: 'ana', name: 'Ana' });
    catalogs = TestBed.inject(Catalogs);
    reminders = TestBed.inject(Reminders);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('st.reminders.mine');
  });

  function load(users: User[]): void {
    catalogs.users.set(users);
    catalogs.assignees.set(people);
    void reminders.refresh();
    http.expectOne({ method: 'GET', url: '/api/tickets/reminders' }).flush(list);
    tick();
  }

  const shown = (): number[] => reminders.stale().map((ticket) => ticket.id);

  it('shows every case until "Míos" is chosen', fakeAsync(() => {
    load([me]);

    expect(reminders.canShowMine()).toBeTrue();
    expect(shown()).toEqual([1, 2, 3]);
    expect(reminders.count()).toBe(3);
  }));

  it('with "Míos", keeps the cases of the responsible the user is', fakeAsync(() => {
    load([me]);
    reminders.setOnlyMine(true);

    expect(shown()).toEqual([1]);
    expect(reminders.count()).toBe(1);
  }));

  // Nothing to narrow to: an empty bell would read as "nothing needs attention".
  it('shows every case to a user who is not a responsible, whatever was chosen before', fakeAsync(() => {
    load([{ ...me, assigneeId: null }]);
    reminders.setOnlyMine(true);

    expect(reminders.canShowMine()).toBeFalse();
    expect(shown()).toEqual([1, 2, 3]);
  }));
});
