import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { httpTestBed } from '../testing/http';
import { Announcer, SAID_MS } from '../core/announcer';
import { heardOnFocus, isDisabled, said, screenOf } from '../testing/screen';
import { textOf } from '../testing/text';
import { LoginPage } from './login';

describe('LoginPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<LoginPage>;
  let el: HTMLElement;

  beforeEach(() => {
    http = httpTestBed(provideRouter([]));
  });

  /** In the fake time of the test: the fields of a form take their part in it a moment after they are drawn. */
  function open(): void {
    fixture = TestBed.createComponent(LoginPage);
    el = fixture.nativeElement as HTMLElement;
    render();
  }

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  const { find, type, click } = screenOf(() => el, render);
  const username = (): HTMLInputElement => find('#username');
  const password = (): HTMLInputElement => find('#password');
  const submit = (): HTMLButtonElement => find('button[type=submit]');
  /** What a field says under it, once it is marked: what it points at. */
  const problemOf = (field: HTMLInputElement): string | null =>
    field.getAttribute('aria-invalid') === 'true' ? textOf(el.querySelector(`#${field.getAttribute('aria-describedby')}`)) : null;

  it('is the main content of its page', fakeAsync(() => {
    open();
    expect(find('main form')).toBeTruthy();
  }));

  // "Ingresar" was disabled until both fields had something: Enter did nothing, and the alert of the
  // try before stayed on screen.
  it('says which field is missing when "Ingresar" is pressed without it, and goes to it', fakeAsync(() => {
    open();
    expect(isDisabled(submit())).toBeFalse();
    expect(problemOf(username())).toBeNull();

    click(submit());
    expect(problemOf(username())).toBe('Escribe tu usuario.');
    expect(problemOf(password())).toBe('Escribe tu contraseña.');
    expect(document.activeElement).toBe(username());

    type(username(), 'ana');
    expect(problemOf(username())).toBeNull();
    click(submit());
    expect(document.activeElement).toBe(password());
    http.expectNone('/api/auth/login');
  }));

  // The focus went to the field before its message was drawn, and a screen reader could say the
  // field without it; with the focus already there, nothing was said at all.
  it('gives the focus to the missing field with its message already tied to it, and says the message when the focus is there', fakeAsync(() => {
    open();
    const heard = heardOnFocus(username());
    submit().focus();
    click(submit());
    expect(document.activeElement).toBe(username());
    expect(heard).toEqual(['Escribe tu usuario.']);
    expect(said()).toEqual([]);

    // Enter in the field, still empty: the focus does not move, so the message is said.
    find<HTMLFormElement>('form').dispatchEvent(new Event('submit'));
    render();
    expect(document.activeElement).toBe(username());
    expect(heard).toEqual(['Escribe tu usuario.']);
    expect(said()).toEqual(['Escribe tu usuario.']);
    tick(SAID_MS);
    expect(said()).toEqual([]);
  }));

  // The button disabled itself while it waited, and the browser put the focus nowhere: after the
  // error, the next Tab started from the top of the page.
  it('keeps the focus on "Ingresar" while it waits, and ties the error to both fields', fakeAsync(() => {
    open();
    type(username(), 'ana');
    type(password(), 'equivocada');
    submit().focus();
    click(submit());

    expect(isDisabled(submit())).toBeTrue();
    expect(textOf(submit())).toBe('Ingresando…');
    expect(document.activeElement).toBe(submit());
    http.expectOne('/api/auth/login').flush({ message: 'Usuario o contraseña incorrectos' }, { status: 401, statusText: 'Unauthorized' });
    tick();
    render();

    expect(document.activeElement).toBe(submit());
    expect(isDisabled(submit())).toBeFalse();
    const alert = find('#login-error');
    expect(textOf(alert)).toBe('Usuario o contraseña incorrectos');
    for (const field of [username(), password()]) {
      expect(field.getAttribute('aria-invalid')).toBe('true');
      expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    }

    // Tried again with a field emptied: the answer about the try before goes.
    type(password(), '');
    click(submit());
    expect(el.querySelector('#login-error')).toBeNull();
    expect(problemOf(password())).toBe('Escribe tu contraseña.');
  }));

  // It was an alert that came with its words: a screen reader may say nothing of a live region that does.
  it('says the error at once as it comes, and again after each try that fails', fakeAsync(() => {
    open();
    const announcer = TestBed.inject(Announcer);
    const say = spyOn(announcer, 'say').and.callThrough();
    for (const attempt of [1, 2]) {
      type(username(), 'ana');
      type(password(), 'equivocada');
      click(submit());
      http.expectOne('/api/auth/login').flush({ message: 'Usuario o contraseña incorrectos' }, { status: 401, statusText: 'Unauthorized' });
      tick();
      render();

      expect(said()).toEqual(['Usuario o contraseña incorrectos']);
      expect(say).toHaveBeenCalledTimes(attempt);
      expect(announcer.said()[0].politeness).toBe('assertive');
    }
    expect(find('#login-error').closest('[role=alert], [role=status], [aria-live]')).toBeNull();
    tick(SAID_MS);
  }));
});
