import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { Auth } from './auth';
import { UnsavedChanges, unsavedChangesGuard } from './unsaved-changes';

// Three screens of the app, each stood in for by its name.
@Component({ selector: 'app-cases-screen', changeDetection: ChangeDetectionStrategy.OnPush, template: 'Casos' })
class Cases {}

@Component({ selector: 'app-board-screen', changeDetection: ChangeDetectionStrategy.OnPush, template: 'Tablero' })
class Board {}

@Component({ selector: 'app-login-screen', changeDetection: ChangeDetectionStrategy.OnPush, template: 'Ingresar' })
class Login {}

// The case form asks before it is closed with unsaved changes. The Back button of the browser
// does not close it: it takes away the screen the form is on. The screens that show the form are
// guarded, so that way out asks too.
describe('UnsavedChanges, on leaving a screen', () => {
  let router: Router;
  let unsaved: UnsavedChanges;
  /** What the form answers when it is asked whether it can be left, and how many times it was asked. */
  let answer: boolean;
  let asked: number;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([
          { path: 'casos', component: Cases, canDeactivate: [unsavedChangesGuard] },
          { path: 'tablero', component: Board },
          { path: 'login', component: Login },
        ]),
      ],
    });
    router = TestBed.inject(Router);
    unsaved = TestBed.inject(UnsavedChanges);
    TestBed.inject(Auth).user.set({ id: 1, username: 'ana', name: 'Ana Torres' });
    answer = true;
    asked = 0;
    await RouterTestingHarness.create('/casos');
  });

  /** A form with unsaved changes comes on screen. Returns what takes it away. */
  function formOnScreen(): () => void {
    return unsaved.watch(() => {
      asked++;
      return Promise.resolve(answer);
    });
  }

  it('goes on at once when nothing on the screen holds unsaved work', async () => {
    expect(await router.navigateByUrl('/tablero')).toBeTrue();
    expect(router.url).toBe('/tablero');
  });

  it('asks the form that is on screen, and stays when the person would rather go on editing', async () => {
    formOnScreen();
    answer = false;

    expect(await router.navigateByUrl('/tablero')).toBeFalse();
    expect(asked).toBe(1);
    expect(router.url).toBe('/casos');
  });

  it('asks the form that is on screen, and goes on when the person gives the changes up', async () => {
    formOnScreen();

    expect(await router.navigateByUrl('/tablero')).toBeTrue();
    expect(asked).toBe(1);
    expect(router.url).toBe('/tablero');
  });

  it('asks nothing once the form is gone', async () => {
    const gone = formOnScreen();
    gone();
    answer = false;

    expect(await router.navigateByUrl('/tablero')).toBeTrue();
    expect(asked).toBe(0);
  });

  // The token was refused, or the person logged out: nothing can be saved any more, and a form
  // that held the screen would keep them from logging in again.
  it('holds nobody back once the session has ended', async () => {
    formOnScreen();
    answer = false;
    TestBed.inject(Auth).user.set(null);

    expect(await router.navigateByUrl('/login')).toBeTrue();
    expect(asked).toBe(0);
    expect(router.url).toBe('/login');
  });
});
