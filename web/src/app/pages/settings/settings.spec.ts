import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AuthUser } from '../../core/api';
import { Auth } from '../../core/auth';
import { answerCatalogs } from '../../testing/catalogs';
import { httpTestBed } from '../../testing/http';
import { buttonIn, toasts } from '../../testing/screen';
import { SettingsPage } from './settings';

const admin: AuthUser = { id: 1, username: 'admin', name: 'Admin', role: 'ADMIN' };
const agent: AuthUser = { id: 2, username: 'ana', name: 'Ana', role: 'AGENT' };

describe('SettingsPage, the tabs of Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SettingsPage>;
  let el: HTMLElement;

  /** The page, for a session of this user. */
  function open(user: AuthUser): void {
    TestBed.inject(Auth).user.set(user);
    fixture = TestBed.createComponent(SettingsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  beforeEach(() => {
    http = httpTestBed(provideRouter([]));
  });

  afterEach(() => http.verify());

  const tabs = (): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')];

  function openTab(label: string): void {
    tabs()
      .find((tab) => tab.textContent?.trim() === label)!
      .click();
    fixture.detectChanges();
    flushMicrotasks();
  }

  // Who can log in, who attends, for whom and what kind of case; then how the system behaves.
  it('are the catalogs first and the settings after, starting on Usuarios', () => {
    open(admin);

    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Usuarios',
      'Responsables',
      'Empresas',
      'Tipos de soporte',
      'Módulos',
      'SLA',
      'Recordatorios',
      'IA',
      'Logo',
      'Mi cuenta',
    ]);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', ...Array<string>(9).fill('false')]);
    expect(el.querySelector('app-users-tab')).not.toBeNull();
  });

  it('"Empresas" is the catalog of client companies', fakeAsync(() => {
    open(admin);
    openTab('Empresas');
    answerCatalogs(http, { companies: [{ id: 1, name: 'Acme', active: true, tickets: 2 }] });
    tick();
    fixture.detectChanges();

    expect(el.querySelector<HTMLInputElement>('app-named-catalog-tab input[aria-label="Nombre de la empresa Acme"]')!.value).toBe('Acme');
  }));

  it('"Tipos de soporte" is the catalog of the labels of a case', fakeAsync(() => {
    open(admin);
    openTab('Tipos de soporte');
    answerCatalogs(http, { supportTypes: [{ id: 1, name: 'Capacitación', color: '#12b76a', active: true, tickets: 0 }] });
    tick();
    fixture.detectChanges();

    expect(el.querySelector<HTMLInputElement>('app-support-types-tab input[aria-label="Nombre del tipo Capacitación"]')!.value).toBe('Capacitación');
  }));

  // Every tab was a stop of the Tab key (ten of them before the content), the arrows did nothing,
  // and nothing said which part of the page each one showed.
  describe('as tabs to the keyboard', () => {
    const selected = (): string => el.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim() ?? '';
    function press(key: string): void {
      (document.activeElement ?? tabs()[0]).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      fixture.detectChanges();
      flushMicrotasks();
    }

    it('are one stop of the Tab key, the one chosen, in a named list, with the part they show tied to them', fakeAsync(() => {
      open(admin);

      expect(el.querySelector('[role=tablist]')!.getAttribute('aria-label')).toBe('Secciones de configuración');
      expect(tabs().map((tab) => tab.tabIndex)).toEqual([0, ...Array<number>(9).fill(-1)]);
      const panel = el.querySelector<HTMLElement>('[role=tabpanel]')!;
      expect(panel.id).toBe(tabs()[0].getAttribute('aria-controls')!);
      expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[0].id);
      expect(panel.querySelector('app-users-tab')).not.toBeNull();
    }));

    it('move with the arrows, Home and End, which choose the tab they reach and give it the focus', fakeAsync(() => {
      open(admin);
      tabs()[0].focus();

      press('End');
      expect(selected()).toBe('Mi cuenta');
      expect(document.activeElement).toBe(tabs()[9]);
      expect(tabs()[9].tabIndex).toBe(0);
      expect(tabs()[0].tabIndex).toBe(-1);
      expect(el.querySelector('[role=tabpanel]')!.getAttribute('aria-labelledby')).toBe(tabs()[9].id);

      // Round the row, both ways.
      press('ArrowRight');
      expect(selected()).toBe('Usuarios');
      press('ArrowLeft');
      expect(selected()).toBe('Mi cuenta');
      press('Home');
      expect(selected()).toBe('Usuarios');

      press('ArrowRight');
      expect(selected()).toBe('Responsables');
      expect(document.activeElement).toBe(tabs()[1]);
      answerCatalogs(http);
      tick();
    }));

    // The selected one differed from the others by a background 1.1:1 and a text colour 2.4:1 apart.
    it('mark the one chosen with a line under it', fakeAsync(() => {
      open(admin);
      const [chosen, other] = tabs().map((tab) => getComputedStyle(tab));
      expect(chosen.borderBottomWidth).toBe('2px');
      expect(chosen.borderBottomColor).not.toBe(other.borderBottomColor);
      expect(other.borderBottomColor).toBe('rgba(0, 0, 0, 0)');
    }));
  });

  // It was called "Empresa", which now reads as the catalog next to it.
  it('"Logo" is where the logo of the installation is uploaded', fakeAsync(() => {
    open(admin);
    openTab('Logo');

    expect(el.querySelector('app-branding-tab h2')!.textContent).toBe('Logo de la empresa');
    expect(el.querySelector('app-named-catalog-tab')).toBeNull();
  }));

  // The API ends every session of the person, this one too, and answers the token it goes on with.
  describe('"Mi cuenta"', () => {
    afterEach(() => localStorage.removeItem('st.token'));

    function changePassword(current: string, next: string): void {
      localStorage.setItem('st.token', 'token-viejo');
      open(admin);
      openTab('Mi cuenta');
      for (const [id, value] of [
        ['pw-current', current],
        ['pw-next', next],
      ]) {
        const input = el.querySelector<HTMLInputElement>(`#${id}`)!;
        input.value = value;
        input.dispatchEvent(new Event('input'));
      }
      fixture.detectChanges();
      buttonIn(el, 'Cambiar contraseña').click();
      fixture.detectChanges();
    }

    it('changes the password, and the session goes on with the token the API answers', fakeAsync(() => {
      changePassword('secreto1', 'secreto9');

      const sent = http.expectOne({ method: 'POST', url: '/api/auth/password' });
      expect(sent.request.body).toEqual({ current: 'secreto1', next: 'secreto9' });
      sent.flush({ token: 'token-nuevo' });
      tick();
      fixture.detectChanges();

      expect(localStorage.getItem('st.token')).toBe('token-nuevo');
      expect(TestBed.inject(Auth).user()).toEqual(admin);
      expect(toasts()).toEqual(['Contraseña cambiada. Si tenías la sesión abierta en otro navegador o equipo, allí se cerró.']);
      expect([...el.querySelectorAll<HTMLInputElement>('input[type=password]')].map((input) => input.value)).toEqual(['', '']);
      tick(6000);
    }));

    it('keeps the session and the fields as they were when the current password is wrong', fakeAsync(() => {
      changePassword('otra', 'secreto9');

      http.expectOne('/api/auth/password').flush({ message: 'La contraseña actual no es correcta' }, { status: 400, statusText: 'Bad Request' });
      tick();
      fixture.detectChanges();

      expect(localStorage.getItem('st.token')).toBe('token-viejo');
      expect(toasts()).toEqual(['La contraseña actual no es correcta']);
      expect(el.querySelector<HTMLInputElement>('#pw-current')!.value).toBe('otra');
      tick(6000);
    }));
  });

  // The API answers 403 to an agent there anyway; the screen does not offer it to begin with.
  describe('for an agent', () => {
    it('are the catalogs and their own account: nothing of the users or the settings of the team', fakeAsync(() => {
      open(agent);
      answerCatalogs(http);
      tick();

      expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(['Responsables', 'Empresas', 'Tipos de soporte', 'Módulos', 'Mi cuenta']);
      // Starting on the first one they have.
      expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false', 'false', 'false']);
      expect(el.querySelector('app-named-catalog-tab')).not.toBeNull();
      expect(el.querySelector('app-users-tab')).toBeNull();
    }));

    // Their role changed while the page was open (read again from the server, see Auth.refresh).
    it('loses the tab of the users, and is left on one they have, when made an agent', fakeAsync(() => {
      open(admin);
      expect(el.querySelector('app-users-tab')).not.toBeNull();

      TestBed.inject(Auth).user.set(agent);
      fixture.detectChanges();
      answerCatalogs(http);
      tick();
      fixture.detectChanges();

      expect(tabs().map((tab) => tab.textContent?.trim())).not.toContain('Usuarios');
      expect(el.querySelector('app-users-tab')).toBeNull();
      expect(el.querySelector('[role=tab][aria-selected=true]')?.textContent?.trim()).toBe('Responsables');
    }));
  });
});
