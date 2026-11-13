import { HttpErrorResponse } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { CanActivateFn } from '@angular/router';
import { catchError, throwError } from 'rxjs';
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

  constructor() {
    // The session is kept where every tab of this browser reads it, and each request takes the
    // token from there. When another tab logs out, or logs in as someone else, this one would go
    // on showing its user while it reads and writes as the other. It starts again instead, as
    // whoever the browser is now. The browser tells of what a tab stores only to the other tabs,
    // and whatever it was: what counts is whose session is there after it.
    const onStorage = (): void => {
      if (readStoredUser()?.id !== this.user()?.id) this.reloadTab();
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

  logout(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    this.user.set(null);
    void this.router.navigateByUrl('/login');
  }
}

/** Adds the login token to API calls and returns to the login screen when it is rejected. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(Auth);
  const token = auth.token;
  const isLogin = req.url.endsWith('/auth/login');
  // X-Client-Id lets this tab ignore the live-update echo of its own writes (see Live).
  const request = token && !isLogin ? req.clone({ setHeaders: { Authorization: `Bearer ${token}`, 'X-Client-Id': CLIENT_ID } }) : req;

  return next(request).pipe(
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401 && !isLogin) auth.logout();
      return throwError(() => error);
    }),
  );
};

export const authGuard: CanActivateFn = () => {
  return inject(Auth).user() ? true : inject(Router).parseUrl('/login');
};
