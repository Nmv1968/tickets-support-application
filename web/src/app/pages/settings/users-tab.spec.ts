import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { Toast } from '../../core/toast';
import { answerCatalogs } from '../../testing/catalogs';
import { UsersTab } from './users-tab';

// A user is someone who can log in, and nothing else. The tab used to say which responsible each
// user "was"; that link is gone, and with it the "Responsable" column and its select.
describe('UsersTab, the users in Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<UsersTab>;
  let el: HTMLElement;

  const ana: User = { id: 1, username: 'ana', name: 'Ana Torres', active: true, canLogin: true };
  const bot: User = { id: 2, username: 'asistente', name: 'Asistente', active: true, canLogin: false };
  const zoe: User = { id: 3, username: 'zoe', name: 'Zoe', active: false, canLogin: true };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana Torres' });
    const catalogs = TestBed.inject(Catalogs);
    catalogs.users.set([ana, bot, zoe]);
    // A responsible with the name of a user: the tab has nothing to say about it.
    catalogs.assignees.set([{ id: 4, name: 'Ana Torres', active: true, tickets: 2 }]);
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
    answerCatalogs(http, { users });
    tick();
    render();
  }

  const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('tbody tr')];
  const cells = (row: HTMLElement): string[] => [...row.querySelectorAll('td')].map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);

  function fill(id: string, value: string): void {
    const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    render();
  }

  it('lists each user with their access, and has nothing about responsibles', fakeAsync(() => {
    open();

    expect([...el.querySelectorAll('thead th')].map((header) => header.textContent?.trim())).toEqual(['Nombre', 'Usuario', 'Acceso', 'Acciones']);
    // The name is in a field of its own; then user, access and actions.
    expect(rows().map((row) => row.querySelector<HTMLInputElement>('td input')!.value)).toEqual(['Ana Torres', 'Asistente', 'Zoe']);
    expect(rows().map((row) => cells(row).slice(1, 3))).toEqual([
      ['ana', 'Puede ingresar'],
      ['asistente', 'Sin contraseña'],
      ['zoe', 'Inactivo'],
    ]);
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('ng-select')).toBeNull();
    expect(el.textContent).not.toContain('Míos');
    expect(el.textContent).toContain('Quienes atienden los casos se administran aparte, en la pestaña Responsables.');
  }));

  // Nobody locks themselves out by accident.
  it('lets a user deactivate the others, not themselves', fakeAsync(() => {
    open();

    const actions = rows().map((row) => [...row.querySelectorAll('button')].map((button) => button.textContent?.trim()));
    expect(actions).toEqual([['Contraseña'], ['Contraseña', 'Desactivar'], ['Contraseña', 'Activar']]);
  }));

  describe('a new user', () => {
    const created: User = { id: 9, username: 'luis', name: 'Luis', active: true, canLogin: true };
    const submit = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;

    it('needs a name, a user name of three characters and a password of six', fakeAsync(() => {
      open();
      expect(submit().disabled).toBeTrue();

      fill('user-name', 'Luis');
      fill('user-username', 'lu');
      fill('user-password', 'secreto1');
      expect(submit().disabled).toBeTrue();

      fill('user-username', 'luis');
      expect(submit().disabled).toBeFalse();

      fill('user-password', 'corta');
      expect(submit().disabled).toBeTrue();
    }));

    // Registering cases, or attending them, is not something a user is created with.
    it('is created with a name, a user name and a password, and the form is left empty', fakeAsync(() => {
      open();
      fill('user-name', ' Luis ');
      fill('user-username', ' luis ');
      fill('user-password', 'secreto1');
      submit().click();
      render();

      const save = http.expectOne({ method: 'POST', url: '/api/users' });
      expect(save.request.body).toEqual({ name: 'Luis', username: 'luis', password: 'secreto1' });
      save.flush(created);
      catalogsRead([ana, bot, zoe, created]);

      expect(rows().length).toBe(4);
      expect(el.querySelector<HTMLInputElement>('#user-name')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#user-username')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#user-password')!.value).toBe('');
      expect(toasts()).toEqual(['Usuario creado']);
      tick(3000);
    }));

    it('refused by the server, keeps what was typed and says why', fakeAsync(() => {
      open();
      fill('user-name', 'Ana');
      fill('user-username', 'ana');
      fill('user-password', 'secreto1');
      submit().click();
      render();

      http.expectOne({ method: 'POST', url: '/api/users' }).flush({ message: 'Ya existe un usuario con ese nombre de usuario' }, { status: 409, statusText: 'Conflict' });
      tick();
      render();

      expect(el.querySelector<HTMLInputElement>('#user-username')!.value).toBe('ana');
      expect(toasts()).toEqual(['Ya existe un usuario con ese nombre de usuario']);
      tick(6000);
    }));
  });

  it('renames a user when the field of the name is left with another one', fakeAsync(() => {
    open();
    const name = rows()[1].querySelector<HTMLInputElement>('td input')!;
    name.value = ' Asistente de IA ';
    name.dispatchEvent(new Event('change'));
    render();

    const save = http.expectOne({ method: 'PATCH', url: '/api/users/2' });
    expect(save.request.body).toEqual({ name: 'Asistente de IA' });
    save.flush({ ...bot, name: 'Asistente de IA' });
    catalogsRead([ana, { ...bot, name: 'Asistente de IA' }, zoe]);

    expect(toasts()).toEqual(['Nombre actualizado']);
    tick(3000);
  }));
});
