import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import type { HttpErrorResponse } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { nextTask } from '../testing/screen';
import type { AuthUser } from './api';
import { Auth, RELOAD_TAB, authInterceptor } from './auth';

const ana: AuthUser = { id: 1, username: 'ana', name: 'Ana Torres', role: 'AGENT' };
const luis: AuthUser = { id: 2, username: 'luis', name: 'Luis Mora', role: 'AGENT' };

// Every tab of a browser shares the stored session, and each request takes its token from there.
describe('Auth, with the same browser open in another tab', () => {
  let reload: jasmine.Spy<() => void>;
  let auth: Auth;

  /** The session as the login leaves it in the storage. */
  function store(user: AuthUser, token: string): void {
    localStorage.setItem('st.token', token);
    localStorage.setItem('st.user', JSON.stringify(user));
  }

  function forget(): void {
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
  }

  /** What the browser tells this tab when another one changed that key of the storage. */
  function told(key: string | null): void {
    window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
  }

  /** This tab, opened on whatever session the browser has. */
  function open(): void {
    reload = jasmine.createSpy('reload');
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([]), { provide: RELOAD_TAB, useValue: reload }],
    });
    auth = TestBed.inject(Auth);
  }

  beforeEach(() => {
    store(ana, 'token-de-ana');
    open();
  });

  afterEach(forget);

  it('starts on the session the browser has', () => {
    expect(auth.user()).toEqual(ana);
    expect(reload).not.toHaveBeenCalled();
  });

  it('loads again when the other tab logs out', () => {
    // The logout takes the token out first: from then on this tab would be sending none.
    localStorage.removeItem('st.token');
    told('st.token');

    expect(reload).toHaveBeenCalled();
  });

  // This tab would go on showing Ana, and every request of it would read and write as Luis.
  it('loads again when the other tab logs in as someone else', () => {
    store(luis, 'token-de-luis');
    told('st.token');
    told('st.user');

    expect(reload).toHaveBeenCalled();
  });

  it('loads again when the storage of the browser is emptied', () => {
    forget();
    told(null);

    expect(reload).toHaveBeenCalled();
  });

  // The same person, with a newer token: nothing on screen is anyone else's.
  it('goes on when the other tab logs in again as the same user, and sends the token of that login', () => {
    store(ana, 'token-nuevo-de-ana');
    told('st.token');
    told('st.user');

    expect(reload).not.toHaveBeenCalled();
    TestBed.inject(HttpClient).get('/api/users').subscribe();
    const request = TestBed.inject(HttpTestingController).expectOne('/api/users');
    expect(request.request.headers.get('Authorization')).toBe('Bearer token-nuevo-de-ana');
    request.flush([]);
  });

  it('goes on when the other tab stores anything else: its theme, its columns', () => {
    localStorage.setItem('st.theme', 'dark');
    told('st.theme');
    localStorage.removeItem('st.theme');
    told('st.theme');

    expect(reload).not.toHaveBeenCalled();
  });

  it('on the login screen, loads again when the other tab logs in: the browser has a session now', () => {
    TestBed.resetTestingModule();
    forget();
    open();
    expect(auth.user()).toBeNull();

    // Half of a login, the token without its user, is still nobody.
    localStorage.setItem('st.token', 'token-de-luis');
    told('st.token');
    expect(reload).not.toHaveBeenCalled();

    localStorage.setItem('st.user', JSON.stringify(luis));
    told('st.user');
    expect(reload).toHaveBeenCalled();
  });

  it('stops listening once it is gone', () => {
    TestBed.resetTestingModule();
    forget();
    told('st.token');

    expect(reload).not.toHaveBeenCalled();
  });
});

// What the screens show depends on it: an agent does not see what only an administrator may use.
describe('Auth, the role of the session', () => {
  const admin: AuthUser = { ...ana, role: 'ADMIN' };
  let auth: Auth;
  let http: HttpTestingController;

  function open(user: AuthUser | null): void {
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
    if (user) {
      localStorage.setItem('st.token', 'token-de-ana');
      localStorage.setItem('st.user', JSON.stringify(user));
    }
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([]), { provide: RELOAD_TAB, useValue: () => undefined }],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
    // Logging out goes to the login screen, which these tests have no route for.
    spyOn(TestBed.inject(Router), 'navigateByUrl').and.resolveTo(true);
  }

  afterEach(() => {
    http.verify();
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
  });

  it('is administrator only for a session of an administrator', () => {
    open(admin);
    expect(auth.isAdmin()).toBeTrue();

    auth.user.set(ana);
    expect(auth.isAdmin()).toBeFalse();
    auth.user.set(null);
    expect(auth.isAdmin()).toBeFalse();
  });

  // Stored by a version without roles: nothing says it is an administrator until the server does.
  it('is no administrator for a session stored without a role', () => {
    open({ id: 1, username: 'ana', name: 'Ana Torres' } as AuthUser);

    expect(auth.user()?.id).toBe(1);
    expect(auth.isAdmin()).toBeFalse();
  });

  it('reads the user of the session again, as the server has it now, and keeps it for the next load', async () => {
    open(ana);

    const read = auth.refresh();
    http.expectOne({ method: 'GET', url: '/api/auth/me' }).flush(admin);
    await read;

    expect(auth.user()).toEqual(admin);
    expect(auth.isAdmin()).toBeTrue();
    expect(JSON.parse(localStorage.getItem('st.user')!)).toEqual(admin);
  });

  it('leaves a session that ended while it was read ended', async () => {
    open(ana);

    const read = auth.refresh();
    auth.logout();
    http.expectOne({ method: 'GET', url: '/api/auth/me' }).flush(admin);
    await read;

    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('st.user')).toBeNull();
  });

  it('asks nothing without a session', async () => {
    open(null);

    await auth.refresh();

    http.expectNone('/api/auth/me');
    expect(auth.user()).toBeNull();
  });

  // Another tab read the same user again: this one goes on, with what that one learned.
  it('takes the role another tab read for the same user, without loading again', () => {
    open(ana);

    localStorage.setItem('st.user', JSON.stringify(admin));
    window.dispatchEvent(new StorageEvent('storage', { key: 'st.user', storageArea: localStorage }));

    expect(auth.isAdmin()).toBeTrue();
  });
});

// A token stops working when it expires, and when the API ends the session: a new password, another
// role, the user deactivated. A change of password in this browser hands its tabs a new one.
describe('Auth, when the API refuses the token', () => {
  let auth: Auth;
  let http: HttpTestingController;
  let client: HttpClient;
  let router: Router;

  beforeEach(() => {
    localStorage.setItem('st.token', 'token-de-ana');
    localStorage.setItem('st.user', JSON.stringify(ana));
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([authInterceptor])), provideHttpClientTesting(), provideRouter([]), { provide: RELOAD_TAB, useValue: () => undefined }],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.resolveTo(true);
  });

  afterEach(() => {
    http.verify();
    localStorage.removeItem('st.token');
    localStorage.removeItem('st.user');
  });

  const refuse = (request: TestRequest): void => request.flush({ statusCode: 401, message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
  /** What a GET ends with, filled in as it ends: its answer, or the status of its error. */
  const outcome = (path: string): { value?: unknown; status?: number } => {
    const seen: { value?: unknown; status?: number } = {};
    client.get(path).subscribe({
      next: (value) => (seen.value = value),
      error: (error: HttpErrorResponse) => (seen.status = error.status),
    });
    return seen;
  };

  it('goes back to the login screen, as it always did, when the session is over', async () => {
    const seen = outcome('/api/users');

    refuse(http.expectOne('/api/users'));
    await nextTask();

    expect(seen.status).toBe(401);
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('st.token')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    http.expectNone('/api/users');
  });

  it('keeps the new token of a change of password, and sends it from then on, as the same user', async () => {
    const change = auth.changePassword('secreto1', 'secreto9');
    const sent = http.expectOne({ method: 'POST', url: '/api/auth/password' });
    expect(sent.request.body).toEqual({ current: 'secreto1', next: 'secreto9' });
    expect(sent.request.headers.get('Authorization')).toBe('Bearer token-de-ana');
    sent.flush({ token: 'token-nuevo-de-ana' });
    await change;

    expect(auth.token).toBe('token-nuevo-de-ana');
    expect(auth.user()).toEqual(ana);
    client.get('/api/users').subscribe();
    const next = http.expectOne('/api/users');
    expect(next.request.headers.get('Authorization')).toBe('Bearer token-nuevo-de-ana');
    next.flush([]);
  });

  it('keeps nothing when the password is refused, and the session goes on', async () => {
    const change = auth.changePassword('otra', 'secreto9');
    http.expectOne('/api/auth/password').flush({ message: 'La contraseña actual no es correcta' }, { status: 400, statusText: 'Bad Request' });

    await expectAsync(change).toBeRejected();
    expect(auth.token).toBe('token-de-ana');
    expect(auth.user()).toEqual(ana);
  });

  // The session expired, or the API ended it, before the change was sent: a refused request waits
  // for the change under way, and this one is that change.
  it('goes back to the login screen when the change of password itself is refused', async () => {
    const change = auth.changePassword('secreto1', 'secreto9');
    refuse(http.expectOne('/api/auth/password'));

    await expectAsync(change).toBeRejected();
    expect(auth.user()).toBeNull();
    expect(localStorage.getItem('st.token')).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
    http.expectNone('/api/auth/password');
  });

  it('does not put the new token in a session that ended while the change was answered', async () => {
    const change = auth.changePassword('secreto1', 'secreto9');
    auth.logout();
    http.expectOne('/api/auth/password').flush({ token: 'token-nuevo-de-ana' });
    await change;

    expect(auth.token).toBeNull();
  });

  // Sent with the old token just before the new one arrived: the API refused it, the session is not over.
  it('sends again, with the new token, a request refused while this tab changed the password', async () => {
    const change = auth.changePassword('secreto1', 'secreto9');
    const password = http.expectOne('/api/auth/password');
    const seen = outcome('/api/users');
    refuse(http.expectOne('/api/users'));
    await nextTask();
    http.expectNone('/api/users');

    password.flush({ token: 'token-nuevo-de-ana' });
    await change;
    await nextTask();
    const again = http.expectOne('/api/users');
    expect(again.request.headers.get('Authorization')).toBe('Bearer token-nuevo-de-ana');
    again.flush([{ id: 1 }]);

    expect(seen).toEqual({ value: [{ id: 1 }] });
    expect(auth.user()).toEqual(ana);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  // Another tab of the same user changed it: both share the storage, and this one sent the old token.
  it('sends again, with the token another tab stored, a request refused with the one before', async () => {
    const seen = outcome('/api/users');
    localStorage.setItem('st.token', 'token-nuevo-de-ana');

    refuse(http.expectOne('/api/users'));
    await nextTask();
    const again = http.expectOne('/api/users');
    expect(again.request.headers.get('Authorization')).toBe('Bearer token-nuevo-de-ana');
    again.flush([]);

    expect(seen).toEqual({ value: [] });
    expect(auth.user()).toEqual(ana);
  });

  it('goes back to the login screen when the request sent again is refused too', async () => {
    const seen = outcome('/api/users');
    localStorage.setItem('st.token', 'token-nuevo-de-ana');

    refuse(http.expectOne('/api/users'));
    await nextTask();
    refuse(http.expectOne('/api/users'));
    await nextTask();

    expect(seen.status).toBe(401);
    expect(auth.user()).toBeNull();
    expect(router.navigateByUrl).toHaveBeenCalledWith('/login');
  });

  // The other tab logged in as someone else: what this one sent was Ana's, and it reloads as the other.
  it('sends nothing again as another user', async () => {
    const seen = outcome('/api/users');
    localStorage.setItem('st.token', 'token-de-luis');
    localStorage.setItem('st.user', JSON.stringify(luis));

    refuse(http.expectOne('/api/users'));
    await nextTask();

    http.expectNone('/api/users');
    expect(seen.status).toBe(401);
  });

  it('leaves the login screen alone when the login itself is refused', async () => {
    let status = 0;
    client.post('/api/auth/login', {}).subscribe({ error: (error: HttpErrorResponse) => (status = error.status) });

    refuse(http.expectOne('/api/auth/login'));
    await nextTask();

    expect(status).toBe(401);
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
