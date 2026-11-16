import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Auth } from '../core/auth';
import { Confirm } from '../core/confirm';
import { Live } from '../core/live';
import { Reminders } from '../core/reminders';
import { answerCatalogs } from '../testing/catalogs';
import { Shell } from './shell';

// Every screen asks through Confirm and counts on the shell to draw the question. Without the
// dialog a question is never answered, and what waits for it (deleting a case, leaving a form
// with unsaved changes) never happens. The dialog itself is in confirm.spec.ts.
// A session stored before an administrator changed its role, or before there were roles, shows
// what that user may use as soon as the shell has read the user again.
describe('Shell, with a session', () => {
  afterEach(() => {
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
  });

  it('reads the user of the session again when it opens', async () => {
    localStorage.setItem('st.token', 'token-de-ana');
    localStorage.setItem('st.user', JSON.stringify({ id: 1, username: 'ana', name: 'Ana', role: 'AGENT' }));
    const live: Partial<Live> = { catalogs: signal(0), settings: signal(0), connected: signal(true), start: () => undefined, stop: () => undefined };
    const reminders: Partial<Reminders> = { count: signal(0), start: () => undefined, stop: () => undefined, refreshSoon: () => undefined };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Live, useValue: live }, { provide: Reminders, useValue: reminders }],
    });
    const http = TestBed.inject(HttpTestingController);
    const auth = TestBed.inject(Auth);
    expect(auth.isAdmin()).toBeFalse();

    const fixture = TestBed.createComponent(Shell);
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: '/api/auth/me' }).flush({ id: 1, username: 'ana', name: 'Ana', role: 'ADMIN' });
    answerCatalogs(http);
    await fixture.whenStable();

    expect(auth.isAdmin()).toBeTrue();
    http.verify();
  });
});

describe('Shell, the frame around every screen', () => {
  let fixture: ComponentFixture<Shell>;
  let el: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    // The live updates and the bell stay quiet: both would open connections of their own.
    const live: Partial<Live> = { catalogs: signal(0), settings: signal(0), connected: signal(true), start: () => undefined, stop: () => undefined };
    const reminders: Partial<Reminders> = { count: signal(0), start: () => undefined, stop: () => undefined, refreshSoon: () => undefined };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: Live, useValue: live }, { provide: Reminders, useValue: reminders }],
    });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(Shell);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
    // The shell reads the catalogs every screen shares.
    answerCatalogs(http);
    await show();
  });

  afterEach(() => http.verify());

  async function show(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const question = (): HTMLElement | null => el.querySelector('[role=alertdialog]');

  // The shell of these tests has no session: nothing is read again for it.
  it('reads nothing of a session that is not there', () => {
    http.expectNone('/api/auth/me');
  });

  it('has no question on screen until a screen asks one', () => {
    expect(question()).toBeNull();
  });

  it('draws the question a screen asks through Confirm, and gives it the answer of the person', async () => {
    const answer = TestBed.inject(Confirm).ask({ title: '¿Eliminar el caso SOP-00012?', confirmLabel: 'Eliminar', danger: true });
    await show();

    expect(question()?.textContent).toContain('¿Eliminar el caso SOP-00012?');
    const yes = Array.from(question()!.querySelectorAll('button')).find((button) => button.textContent?.trim() === 'Eliminar')!;
    yes.click();
    await show();

    expect(await answer).toBeTrue();
    expect(question()).toBeNull();
  });
});
