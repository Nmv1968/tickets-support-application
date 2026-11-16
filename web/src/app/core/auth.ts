import { HttpErrorResponse } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { Api } from './api';
import type { AuthUser } from './api';
import { CLIENT_ID } from './client-id';

const TOKEN_KEY = 'st.token';
const USER_KEY = 'st.user';

function readStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw && localStorage.getItem(TOKEN_KEY) ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

/**
 * Loads the tab again. Asked of the injector so that a spec can put something else in its place:
 * the real one would load again the page the tests run in.
 */
export const RELOAD_TAB = new InjectionToken<() => void>('RELOAD_TAB', { providedIn: 'root', factory: () => () => location.reload() });

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(Api);
  private readonly router = inject(Router);
  private readonly reloadTab = inject(RELOAD_TAB);

  readonly user = signal<AuthUser | null>(readStoredUser());
  /**
   * Whether the screens show what only an administrator may use: they hide it from an agent, not
   * just disable it. The API answers 403 to an agent anyway; this only spares them the buttons.
   * False for a session stored before there were roles, until `refresh` reads the user again.
   */
  readonly isAdmin = computed(() => this.user()?.role === 'ADMIN');
  /** The change of password under way in this tab: a request refused meanwhile waits for it (see `renewed`). */
  private renewal: Promise<unknown> = Promise.resolve();

  constructor() {
    // The session is kept where every tab of this browser reads it, and each request takes the
    // token from there. When another tab logs out, or logs in as someone else, this one would go
    // on showing its user while it reads and writes as the other. It starts again instead, as
    // whoever the browser is now. The browser tells of what a tab stores only to the other tabs,
    // and whatever it was: what counts is whose session is there after it. The same person read
    // again (`refresh`) stays: only what is known of them, their role among it, is brought up to date.
    const onStorage = (): void => {
      const stored = readStoredUser();
      if (stored?.id !== this.user()?.id) this.reloadTab();
      else if (stored) this.user.set(stored);
    };
    window.addEventListener('storage', onStorage);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('storage', onStorage));
  }

  get token(): string | null {
    return localStorage.getItem(TOKEN_KEY);
  }

  async login(username: string, password: string): Promise<void> {
    const { token, user } = await this.api.login(username, password);
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  /**
   * Reads the user of the session again, as the server has it now: an administrator may have
   * changed their role or their name since the login. A session that ended meanwhile is left ended.
   */
  async refresh(): Promise<void> {
    const token = this.token;
    if (!token) return;
    const user = await this.api.me();
    if (this.token !== token) return;
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    this.user.set(user);
  }

  /**
   * Changes the password of the session. The API ends every session the user has, this one too,
   * and answers a new token for it, kept here in place of the old one: this tab, and the other
   * tabs of this browser, go on with it; a session in another browser or on another device ends.
   */
  async changePassword(current: string, next: string): Promise<void> {
    const token = this.token;
    const change = this.api.changePassword(current, next).then(({ token: renewed }) => {
      // A logout, or a login as someone else, while it was answered: that session is not this one.
      if (token && this.token === token) localStorage.setItem(TOKEN_KEY, renewed);
    });
    this.renewal = change.catch(() => undefined);
    await change;
  }

  /**
   * The token to send again a request the API refused with `refused`, or null when the session is
   * over. There is one when a change of password replaced that token meanwhile: in this tab (waited
   * for, if it is still under way) or in another tab of the same user.
   */
  async renewed(refused: string | null): Promise<string | null> {
    await this.renewal;
    const token = this.token;
    return token && token !== refused && readStoredUser()?.id === this.user()?.id ? token : null;
  }

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    void this.router.navigateByUrl('/login');
  }
}

/**
 * Adds the login token to API calls and returns to the login screen when it is rejected: it expired,
 * or the API ended the session (a new password, another role, the user deactivated). A request
 * refused with a token that a change of password has just replaced goes once more with the new one.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const isLogin = req.url.endsWith('/auth/login');
  // The change of password is what `renewed` waits for: refused itself, it would wait for itself.
  const isPasswordChange = req.url.endsWith('/auth/password');
  // X-Client-Id lets this tab ignore the live-update echo of its own writes (see Live).
  const send = (token: string | null) => next(token && !isLogin ? req.clone({ setHeaders: { Authorization: `Bearer ${token}`, 'X-Client-Id': CLIENT_ID } }) : req);
  const refused = (error: unknown): boolean => error instanceof HttpErrorResponse && error.status === 401 && !isLogin;
  const endIfRefused = (error: unknown) => {
    if (refused(error)) auth.logout();
    return throwError(() => error);
  };

  const token = auth.token;
  return send(token).pipe(
    catchError((error: unknown) => {
      if (!refused(error)) return throwError(() => error);
      if (isPasswordChange) return endIfRefused(error);
      return from(auth.renewed(token)).pipe(switchMap((renewed) => (renewed ? send(renewed).pipe(catchError(endIfRefused)) : endIfRefused(error))));
    }),
  );
};

export const authGuard: CanActivateFn = () => {
  return inject(Auth).user() ? true : inject(Router).parseUrl('/login');
};
