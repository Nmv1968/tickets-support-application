import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Assignee, User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { Toast } from '../../core/toast';
import { UsersTab } from './users-tab';

// Being a user and attending cases are two things. The tab says, for each user, which responsible
// of the catalog they are, if any.
describe('UsersTab, the responsible each user is', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<UsersTab>;
  let el: HTMLElement;

  const ana: User = { id: 1, username: 'ana', name: 'Ana Torres', active: true, canLogin: true, assigneeId: 4 };
  const bot: User = { id: 2, username: 'asistente', name: 'Asistente', active: true, canLogin: true, assigneeId: null };
  const zoe: User = { id: 3, username: 'zoe', name: 'Zoe', active: true, canLogin: true, assigneeId: 6 };
  const people: Assignee[] = [
    { id: 4, name: 'Ana Torres', active: true, tickets: 2 },
    { id: 5, name: 'Luis', active: true, tickets: 0 },
    { id: 6, name: 'Zoe', active: false, tickets: 1 },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana Torres' });
    const catalogs = TestBed.inject(Catalogs);
    catalogs.users.set([ana, bot, zoe]);
    catalogs.assignees.set(people);
  });

  afterEach(() => http.verify());

  function open(): void {
    fixture = TestBed.createComponent(UsersTab);
    el = fixture.nativeElement as HTMLElement;
    render();
  }

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  /** Answers the read of the shared catalogs every write ends with. */
  function catalogsRead(users: User[]): void {
    tick();
    http.expectOne({ method: 'GET', url: '/api/users' }).flush(users);
    http.expectOne({ method: 'GET', url: '/api/assignees' }).flush(people);
    http.expectOne({ method: 'GET', url: '/api/modules' }).flush([]);
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([]);
    tick();
    render();
  }

  const linkOf = (username: string): HTMLSelectElement => el.querySelector<HTMLSelectElement>(`select[aria-label="Responsable que es ${username}"]`)!;
  const optionsOf = (select: HTMLSelectElement): string[] => [...select.options].map((option) => option.textContent?.trim() ?? '');
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);

  function choose(select: HTMLSelectElement, value: string): void {
    select.value = value;
    select.dispatchEvent(new Event('change'));
    render();
  }

  function fill(id: string, value: string): void {
    const input = el.querySelector<HTMLInputElement | HTMLSelectElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
    render();
  }

  it('shows the responsible each user is, and "No atiende casos" for the ones who are none', fakeAsync(() => {
    open();
    expect(linkOf('ana').value).toBe('4');
    expect(linkOf('asistente').value).toBe('');
    expect(linkOf('zoe').value).toBe('6');
  }));

  // A deactivated responsible is offered only to the user who already is that one.
  it('offers the active responsibles, plus the one the user already is', fakeAsync(() => {
    open();
    expect(optionsOf(linkOf('asistente'))).toEqual(['No atiende casos', 'Ana Torres', 'Luis']);
    expect(optionsOf(linkOf('zoe'))).toEqual(['No atiende casos', 'Ana Torres', 'Luis', 'Zoe']);
  }));

  it('links a user to the responsible chosen', fakeAsync(() => {
    open();
    choose(linkOf('asistente'), '5');

    const save = http.expectOne({ method: 'PATCH', url: '/api/users/2' });
    expect(save.request.body).toEqual({ assigneeId: 5 });
    save.flush({ ...bot, assigneeId: 5 });
    catalogsRead([ana, { ...bot, assigneeId: 5 }, zoe]);

    expect(linkOf('asistente').value).toBe('5');
    expect(toasts()).toEqual(['Responsable actualizado']);
    tick(3000);
  }));

  it('unlinks with "No atiende casos"', fakeAsync(() => {
    open();
    choose(linkOf('ana'), '');

    const save = http.expectOne({ method: 'PATCH', url: '/api/users/1' });
    expect(save.request.body).toEqual({ assigneeId: null });
    save.flush({ ...ana, assigneeId: null });
    catalogsRead([{ ...ana, assigneeId: null }, bot, zoe]);

    expect(linkOf('ana').value).toBe('');
    tick(3000);
  }));

  describe('a new user', () => {
    const created: User = { id: 9, username: 'luis', name: 'Luis', active: true, canLogin: true, assigneeId: null };

    function submit(): void {
      el.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click();
      render();
    }

    it('attends no cases unless a responsible is chosen for them', fakeAsync(() => {
      open();
      fill('user-name', 'Luis');
      fill('user-username', 'luis');
      fill('user-password', 'secreto1');
      submit();

      const save = http.expectOne({ method: 'POST', url: '/api/users' });
      expect(save.request.body).toEqual({ name: 'Luis', username: 'luis', password: 'secreto1', assigneeId: null });
      save.flush(created);
      catalogsRead([ana, bot, zoe, created]);
      tick(3000);
    }));

    it('is created as the responsible chosen, and the form is left empty', fakeAsync(() => {
      open();
      fill('user-name', 'Luis');
      fill('user-username', 'luis');
      fill('user-password', 'secreto1');
      fill('user-assignee', '5');
      submit();

      const save = http.expectOne({ method: 'POST', url: '/api/users' });
      expect(save.request.body).toEqual({ name: 'Luis', username: 'luis', password: 'secreto1', assigneeId: 5 });
      save.flush({ ...created, assigneeId: 5 });
      catalogsRead([ana, bot, zoe, { ...created, assigneeId: 5 }]);

      expect(el.querySelector<HTMLSelectElement>('#user-assignee')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#user-name')!.value).toBe('');
      expect(linkOf('luis').value).toBe('5');
      tick(3000);
    }));
  });
});
