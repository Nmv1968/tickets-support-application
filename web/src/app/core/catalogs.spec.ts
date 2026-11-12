import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Assignee, User } from './api';
import { Auth } from './auth';
import { Catalogs, assigneeInput, assigneeValue } from './catalogs';

describe('responsible select helpers', () => {
  describe('assigneeValue', () => {
    it('is the id of the responsible for a person', () => {
      expect(assigneeValue({ assigneeId: 5, assignedToClient: false })).toBe('5');
    });

    it('is "client" when the client is responsible', () => {
      expect(assigneeValue({ assigneeId: null, assignedToClient: true })).toBe('client');
    });

    it('is empty when nobody is responsible', () => {
      expect(assigneeValue({ assigneeId: null, assignedToClient: false })).toBe('');
    });

    // The select can show only one option, so a leftover id must not hide the client.
    it('prefers the client over the id of a responsible', () => {
      expect(assigneeValue({ assigneeId: 5, assignedToClient: true })).toBe('client');
    });
  });

  describe('assigneeInput', () => {
    it('reads the id of a responsible as a number', () => {
      expect(assigneeInput('5')).toEqual({ assigneeId: 5, assignedToClient: false });
    });

    it('reads "client" as the client, without a person', () => {
      expect(assigneeInput('client')).toEqual({ assigneeId: null, assignedToClient: true });
    });

    it('reads the empty option as nobody', () => {
      expect(assigneeInput('')).toEqual({ assigneeId: null, assignedToClient: false });
    });
  });

  describe('round trip', () => {
    it('gives back every state a case can be in', () => {
      const states = [
        { assigneeId: 12, assignedToClient: false },
        { assigneeId: null, assignedToClient: true },
        { assigneeId: null, assignedToClient: false },
      ];
      for (const state of states) expect(assigneeInput(assigneeValue(state))).toEqual(state);
    });

    it('gives back every option of the select', () => {
      for (const value of ['12', 'client', '']) expect(assigneeValue(assigneeInput(value))).toBe(value);
    });
  });
});

// A case is assigned to a responsible of the catalog, and a responsible need not be a user. What
// the logged-in user "is" comes from the link of their user: nothing is guessed from the names.
describe('Catalogs, the responsible the logged-in user is', () => {
  let http: HttpTestingController;
  let catalogs: Catalogs;

  const user = (id: number, assigneeId: number | null): User => ({ id, username: `u${id}`, name: 'Ana', active: true, canLogin: true, assigneeId });
  const person = (id: number, name: string, active = true): Assignee => ({ id, name, active, tickets: 0 });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 1, username: 'u1', name: 'Ana' });
    catalogs = TestBed.inject(Catalogs);
  });

  afterEach(() => http.verify());

  function load(users: User[], people: Assignee[]): void {
    void catalogs.reload();
    http.expectOne({ method: 'GET', url: '/api/users' }).flush(users);
    http.expectOne({ method: 'GET', url: '/api/assignees' }).flush(people);
    http.expectOne({ method: 'GET', url: '/api/modules' }).flush([]);
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([]);
    tick();
  }

  it('is nobody until the catalogs arrive', () => {
    expect(catalogs.ownAssigneeId()).toBeNull();
    expect(catalogs.ownAssignee()).toBe('');
  });

  it('is the one their user is linked to, which a new case starts with', fakeAsync(() => {
    load([user(1, 4), user(2, 5)], [person(4, 'Ana'), person(5, 'Luis')]);

    expect(catalogs.ownAssigneeId()).toBe(4);
    expect(catalogs.ownAssignee()).toBe('4');
  }));

  // Another responsible with the same name, or with the same number as the user, is not them.
  it('is nobody for a user who attends no cases', fakeAsync(() => {
    load([user(1, null), user(2, 5)], [person(1, 'Ana'), person(5, 'Luis')]);

    expect(catalogs.ownAssigneeId()).toBeNull();
    expect(catalogs.ownAssignee()).toBe('');
  }));

  it('once deactivated is still theirs, but a new case does not start with it', fakeAsync(() => {
    load([user(1, 4)], [person(4, 'Ana', false), person(5, 'Luis')]);

    expect(catalogs.ownAssigneeId()).toBe(4);
    expect(catalogs.ownAssignee()).toBe('');
  }));

  it('is nobody when the one linked is no longer in the catalog', fakeAsync(() => {
    load([user(1, 4)], [person(5, 'Luis')]);

    expect(catalogs.ownAssigneeId()).toBeNull();
    expect(catalogs.ownAssignee()).toBe('');
  }));

  it('offers the active responsibles for a new case, and keeps everyone for the filters', fakeAsync(() => {
    load([user(1, 4)], [person(4, 'Ana'), person(5, 'Luis', false)]);

    expect(catalogs.activeAssignees().map((item) => item.name)).toEqual(['Ana']);
    expect(catalogs.assignees().map((item) => item.name)).toEqual(['Ana', 'Luis']);
  }));
});
