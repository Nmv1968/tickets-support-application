import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SAID_MS } from '../../core/announcer';
import type { User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { answerCatalogs } from '../../testing/catalogs';
import { httpTestBed } from '../../testing/http';
import { chooseOption, ngSelect, optionTexts, openSelect, selectedTexts } from '../../testing/ng-select';
import { buttonIn, heardOnFocus, isDisabled, said, toasts } from '../../testing/screen';
import { textOf } from '../../testing/text';
import { UsersTab } from './users-tab';

// A user is someone who can log in, and nothing else. The tab used to say which responsible each
// user "was"; that link is gone, and with it the "Responsable" column and its select.
describe('UsersTab, the users in Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<UsersTab>;
  let el: HTMLElement;

  // Ana is the administrator of the session: only an administrator has this tab.
  const ana: User = { id: 1, username: 'ana', name: 'Ana Torres', active: true, canLogin: true, role: 'ADMIN' };
  const bot: User = { id: 2, username: 'asistente', name: 'Asistente', active: true, canLogin: false, role: 'AGENT' };
  const zoe: User = { id: 3, username: 'zoe', name: 'Zoe', active: false, canLogin: true, role: 'AGENT' };

  beforeEach(() => {
    http = httpTestBed(provideRouter([]));
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana Torres', role: 'ADMIN' });
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
  const cells = (row: HTMLElement): string[] => [...row.querySelectorAll('td')].map((cell) => textOf(cell));

  function fill(id: string, value: string): void {
    const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    render();
  }

  it('lists each user with their role and their access, and has nothing about responsibles', fakeAsync(() => {
    open();

    expect([...el.querySelectorAll('thead th')].map((header) => header.textContent?.trim())).toEqual(['Nombre y usuario', 'Rol', 'Acceso', 'Acciones']);
    // The name is in a field of its own, the username under it; then role, access and actions.
    expect(rows().map((row) => row.querySelector<HTMLInputElement>('td input')!.value)).toEqual(['Ana Torres', 'Asistente', 'Zoe']);
    expect(rows().map((row) => cells(row).slice(0, 3))).toEqual([
      ['ana', 'Administrador', 'Puede ingresar'],
      ['asistente', 'Agente', 'Sin contraseña'],
      ['zoe', 'Agente', 'Inactivo'],
    ]);
    // Nothing to choose a responsible with in the rows.
    expect(el.querySelector('tbody select, tbody ng-select')).toBeNull();
    expect(el.textContent).not.toContain('Míos');
    expect(el.textContent).toContain('Un administrador, además, maneja los usuarios, el SLA, los recordatorios, la IA y el logo.');
    expect(el.textContent).toContain('Quienes atienden los casos se administran aparte, en la pestaña Responsables.');
  }));

  // What "Sin contraseña" means, and what to do about it, was only in the title of the badge.
  it('says on screen what "Sin contraseña" means and how to give one', fakeAsync(() => {
    open();

    const badge = [...el.querySelectorAll<HTMLElement>('tbody .badge')].find((element) => textOf(element) === 'Sin contraseña')!;
    expect(badge.title).toBe('Asígnale una contraseña para que pueda ingresar.');
    expect(textOf(el)).toContain('Un usuario inactivo no puede ingresar, ni uno «Sin contraseña» hasta que le asignes una con «Contraseña».');
  }));

  // Nobody locks themselves out by accident, or takes away their own power to undo it. Their own
  // password is changed in Mi cuenta: reset from here, it would end the session that resets it.
  it('lets an administrator change the password, the role and the state of the others, not their own', fakeAsync(() => {
    open();

    const actions = rows().map((row) => [...row.querySelectorAll('button')].map((button) => button.textContent?.trim()));
    expect(actions).toEqual([[], ['Contraseña', 'Hacer administrador', 'Desactivar'], ['Contraseña', 'Hacer administrador', 'Activar']]);
    expect(cells(rows()[0])[3]).toBe('Tu contraseña, en Mi cuenta');
  }));

  // "Desactivar", "Contraseña" and the role were said the same on every row; an inactive row was
  // drawn at 60 %, under the contrast its text needs.
  it('names the buttons of a row with its user, and draws an inactive one as readable as the others', fakeAsync(() => {
    open();
    const names = [...rows()[2].querySelectorAll('button')].map((button) => button.getAttribute('aria-label'));

    expect(names).toEqual(['Contraseña de Zoe', 'Hacer administrador a Zoe', 'Activar a Zoe']);
    expect(getComputedStyle(rows()[2]).opacity).toBe('1');
    expect(rows()[2].querySelector('input')!.classList).toContain('text-muted');
    expect(rows()[1].querySelector('input')!.classList).not.toContain('text-muted');
  }));

  // Its buttons gave way to the field, or the field to its buttons, and the browser put the focus nowhere.
  it('takes the focus to the field of the new password, and back to "Contraseña" when it is cancelled', fakeAsync(() => {
    open();
    const ask = buttonIn(rows()[1], 'Contraseña');
    ask.focus();
    ask.click();
    render();
    const field = rows()[1].querySelector<HTMLInputElement>('input[type=password]')!;
    expect(document.activeElement).toBe(field);

    buttonIn(rows()[1], 'Cancelar').focus();
    buttonIn(rows()[1], 'Cancelar').click();
    render();
    expect(document.activeElement).toBe(buttonIn(rows()[1], 'Contraseña'));
  }));

  // The API ends them: a token signed before is refused, and that person is back at the login screen.
  it('says that a new password, another role or a deactivation ends the sessions of that person', fakeAsync(() => {
    open();

    expect(textOf(el)).toContain('Una contraseña nueva, otro rol o desactivar a alguien cierra las sesiones que tenga abiertas.');
  }));

  describe('the role of a user', () => {
    it('is changed with its button, and the list says the new one', fakeAsync(() => {
      open();
      buttonIn(rows()[1], 'Hacer administrador').click();
      render();

      const save = http.expectOne({ method: 'PATCH', url: '/api/users/2' });
      expect(save.request.body).toEqual({ role: 'ADMIN' });
      save.flush({ ...bot, role: 'ADMIN' });
      catalogsRead([ana, { ...bot, role: 'ADMIN' }, zoe]);

      expect(cells(rows()[1])[1]).toBe('Administrador');
      expect(toasts()).toEqual(['Rol de Asistente: Administrador']);
      // And back.
      buttonIn(rows()[1], 'Hacer agente').click();
      render();
      expect(http.expectOne({ method: 'PATCH', url: '/api/users/2' }).request.body).toEqual({ role: 'AGENT' });
      tick(3000);
    }));

    it('stays as it was when the server refuses the change, and the person reads why', fakeAsync(() => {
      open();
      buttonIn(rows()[1], 'Hacer administrador').click();
      render();

      http
        .expectOne({ method: 'PATCH', url: '/api/users/2' })
        .flush({ message: 'Debe quedar al menos un administrador activo. Haz administrador a otra persona antes.' }, { status: 400, statusText: 'Bad Request' });
      tick();
      render();

      expect(cells(rows()[1])[1]).toBe('Agente');
      expect(toasts()).toEqual(['Debe quedar al menos un administrador activo. Haz administrador a otra persona antes.']);
      tick(6000);
    }));
  });

  describe('a new user', () => {
    const created: User = { id: 9, username: 'luis', name: 'Luis', active: true, canLogin: true, role: 'AGENT' };
    const submit = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;

    /** What a field says under it, and whether it is marked: its error, tied to it. */
    function problemOf(id: string): string | null {
      const field = el.querySelector<HTMLInputElement>(`#${id}`)!;
      if (field.getAttribute('aria-invalid') !== 'true') return null;
      return textOf(el.querySelector(`#${field.getAttribute('aria-describedby')}`));
    }

    // The button was disabled until all three were right, with nothing to say which one was not:
    // it could not even be reached with Tab. The user name never said how long it had to be.
    it('needs a name, a user name of three characters and a password of six: pressed without them, it says which, by its field', fakeAsync(() => {
      open();
      expect(textOf(el.querySelector('label[for="user-username"]'))).toBe('Usuario (mínimo 3)');
      expect(textOf(el.querySelector('label[for="user-password"]'))).toBe('Contraseña (mínimo 6)');
      expect(isDisabled(submit())).toBeFalse();
      // Nothing is said before it is pressed.
      expect(['user-name', 'user-username', 'user-password'].map(problemOf)).toEqual([null, null, null]);

      fill('user-username', 'lu');
      submit().focus();
      submit().click();
      render();

      expect(problemOf('user-name')).toBe('Escribe el nombre.');
      expect(problemOf('user-username')).toBe('El usuario necesita al menos 3 caracteres.');
      expect(problemOf('user-password')).toBe('La contraseña necesita al menos 6 caracteres.');
      // To the first one, which says what it needs.
      expect(document.activeElement?.id).toBe('user-name');

      fill('user-name', 'Luis');
      fill('user-username', 'luis');
      expect(problemOf('user-name')).toBeNull();
      expect(problemOf('user-username')).toBeNull();
      submit().click();
      render();
      expect(document.activeElement?.id).toBe('user-password');
      // Nothing was sent: http.verify() after each test.
    }));

    // The focus went to the field before its message was drawn; with the focus already there, nothing was said.
    it('gives the focus to the first field with its message already tied to it, and says the message when the focus is there', fakeAsync(() => {
      open();
      const name = el.querySelector<HTMLInputElement>('#user-name')!;
      const heard = heardOnFocus(name);
      submit().focus();
      submit().click();
      render();
      expect(document.activeElement).toBe(name);
      expect(heard).toEqual(['Escribe el nombre.']);
      expect(said()).toEqual([]);

      submit().click();
      render();
      expect(document.activeElement).toBe(name);
      expect(said()).toEqual(['Escribe el nombre.']);
      tick(SAID_MS);
    }));

    // Registering cases, or attending them, is not something a user is created with.
    it('is created with a name, a user name, a password and the role of agent, and the form is left empty', fakeAsync(() => {
      open();
      // A field of a form takes its first value a moment after it is drawn.
      render();
      expect(selectedTexts(ngSelect(el, 'user-role'))).toEqual(['Agente']);
      fill('user-name', ' Luis ');
      fill('user-username', ' luis ');
      fill('user-password', 'secreto1');
      submit().click();
      render();

      const save = http.expectOne({ method: 'POST', url: '/api/users' });
      expect(save.request.body).toEqual({ name: 'Luis', username: 'luis', password: 'secreto1', role: 'AGENT' });
      save.flush(created);
      catalogsRead([ana, bot, zoe, created]);

      expect(rows().length).toBe(4);
      expect(el.querySelector<HTMLInputElement>('#user-name')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#user-username')!.value).toBe('');
      expect(el.querySelector<HTMLInputElement>('#user-password')!.value).toBe('');
      expect(toasts()).toEqual(['Usuario creado']);
      tick(3000);
    }));

    it('can be created as an administrator, and the next one starts as an agent again', fakeAsync(() => {
      open();
      const role = ngSelect(el, 'user-role');
      openSelect(role);
      render();
      expect(optionTexts(role)).toEqual(['Agente', 'Administrador']);
      chooseOption(role, 'Administrador');
      render();
      fill('user-name', 'Marta');
      fill('user-username', 'marta');
      fill('user-password', 'secreto1');
      submit().click();
      render();

      const save = http.expectOne({ method: 'POST', url: '/api/users' });
      expect(save.request.body).toEqual({ name: 'Marta', username: 'marta', password: 'secreto1', role: 'ADMIN' });
      save.flush({ ...created, username: 'marta', name: 'Marta', role: 'ADMIN' });
      catalogsRead([ana, bot, zoe]);

      expect(selectedTexts(ngSelect(el, 'user-role'))).toEqual(['Agente']);
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

  /*
   * The table on the screen of a computer, names and usernames of 24 characters. Its width is the
   * one the tab has on a 1024 px screen: the menu of the shell (14rem) and the margins of the page
   * (1.25rem each side) aside. It used to be wider than that even on a 1440 px screen, and cut
   * "Acciones" at the edge of its card; the field of a name showed only part of it.
   */
  describe('the table, with long names', () => {
    const long: User[] = [
      { ...ana, username: 'administracion.general.1', name: 'Administración General 1' },
      { ...bot, username: 'maria.fernanda.ortiz.paz', name: 'María Fernanda Ortiz Paz' },
      { ...zoe, username: 'sebastian.cardenas.munoz', name: 'Sebastián Cárdenas Muñoz', active: true },
    ];

    /** The tab in a box `width` px wide, with the long users. */
    function openAt(width: number): HTMLElement {
      TestBed.inject(Catalogs).users.set(long);
      TestBed.inject(Auth).user.set({ id: 1, username: long[0].username, name: long[0].name, role: 'ADMIN' });
      open();
      el.style.display = 'block';
      el.style.width = `${width}px`;
      return el.querySelector<HTMLElement>('table')!.parentElement!;
    }

    const lines = (element: Element): number => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
    };

    // Also with the 17 px of the scroll bar of a page longer than the screen, on Windows.
    for (const scrollBar of [0, 17]) {
      it(`fits the screen of a 1024 px computer without scrolling sideways, every name and username whole (scroll bar: ${scrollBar} px)`, fakeAsync(() => {
        const card = openAt(1024 - 224 - 40 - scrollBar);

        expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth);
        for (const row of rows()) {
          const name = row.querySelector<HTMLInputElement>('td input')!;
          expect(name.scrollWidth).withContext(name.value).toBeLessThanOrEqual(name.clientWidth);
          const username = row.querySelector('td div')!;
          expect(lines(username)).withContext(username.textContent!).toBe(1);
        }
        // Its buttons may take two lines; they are all there, on the card.
        const right = card.getBoundingClientRect().right;
        for (const button of el.querySelectorAll('tbody button')) expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(right);
      }));
    }

    it('scrolls sideways inside its card on a phone, and not the page', fakeAsync(() => {
      const card = openAt(375 - 24);

      expect(card.scrollWidth).toBeGreaterThan(card.clientWidth);
      expect(el.scrollWidth).toBeLessThanOrEqual(el.clientWidth);
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
