import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AuthUser } from './api';
import { Auth, RELOAD_TAB, authInterceptor } from './auth';

const ana: AuthUser = { id: 1, username: 'ana', name: 'Ana Torres' };
const luis: AuthUser = { id: 2, username: 'luis', name: 'Luis Mora' };

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
