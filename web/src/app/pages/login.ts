import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { Say } from '../core/announcer';
import { AppLogo } from '../core/app-logo';
import { Auth } from '../core/auth';
import { focusProblem } from '../core/focus';
import { Icon } from '../core/icon';
import { SoftDisabled } from '../core/soft-disabled';
import { errorMessage } from '../core/ui';

/** The fields "Ingresar" needs, and what each says when it was pressed without it. */
const MISSING = { username: 'Escribe tu usuario.', password: 'Escribe tu contraseña.' } as const;

@Component({
  selector: 'app-login',
  imports: [FormsModule, AppLogo, Icon, Say, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="grid min-h-dvh place-items-center p-4">
      <form class="card w-full max-w-sm space-y-4 p-6" (ngSubmit)="submit()">
        <div class="flex items-center gap-3">
          <app-logo size="lg" />
          <div>
            <h1 class="text-lg leading-tight font-semibold">Soporte</h1>
            <p class="text-xs text-muted">Gestión de casos técnicos</p>
          </div>
        </div>

        <div>
          <label class="label" for="username">Usuario</label>
          <!-- eslint-disable-next-line @angular-eslint/template/no-autofocus -- The form is the whole page, and the focus always started here. -->
          <input #usernameBox id="username" autofocus
            class="input aria-[invalid=true]:border-danger"
            name="username"
            autocomplete="username"
            required
            [(ngModel)]="username"
            [attr.aria-invalid]="missing().username || error() ? 'true' : null"
            [attr.aria-describedby]="missing().username ? 'username-error' : error() ? 'login-error' : null"
          />
          @if (missing().username) {
            <p class="field-error" id="username-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ missingText.username }}</p>
          }
        </div>
        <div>
          <label class="label" for="password">Contraseña</label>
          <input
            #passwordBox
            id="password"
            class="input aria-[invalid=true]:border-danger"
            name="password"
            type="password"
            autocomplete="current-password"
            required
            [(ngModel)]="password"
            [attr.aria-invalid]="missing().password || error() ? 'true' : null"
            [attr.aria-describedby]="missing().password ? 'password-error' : error() ? 'login-error' : null"
          />
          @if (missing().password) {
            <p class="field-error" id="password-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ missingText.password }}</p>
          }
        </div>

        @if (error()) {
          <!-- Said at once as it comes (see Say): an alert that comes with its words may not be read. -->
          <p class="alert-error" id="login-error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
        }

        <!-- Never disabled for a field left empty: pressed, it says which one. While it waits it keeps the focus. -->
        <button type="submit" class="btn btn-primary w-full" [appSoftDisabled]="busy()">
          {{ busy() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
    </main>
  `,
})
export class LoginPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** "Ingresar" was pressed with a field empty: from then on an empty field says so, until it is filled. */
  private readonly tried = signal(false);
  protected readonly missing = computed(() => ({ username: this.tried() && !this.username(), password: this.tried() && !this.password() }));
  protected readonly missingText = MISSING;

  private readonly usernameBox = viewChild.required<ElementRef<HTMLInputElement>>('usernameBox');
  private readonly passwordBox = viewChild.required<ElementRef<HTMLInputElement>>('passwordBox');
  private readonly injector = inject(Injector);

  constructor() {
    if (this.auth.user()) void this.router.navigateByUrl('/');
  }

  protected async submit(): Promise<void> {
    // Also Enter in a field while the answer is on its way.
    if (this.busy()) return;
    // An answer about the try before is not about this one.
    this.error.set('');
    if (!this.username() || !this.password()) {
      this.tried.set(true);
      // To the first field that is missing, which says what it needs.
      if (this.username()) focusProblem(this.injector, this.passwordBox().nativeElement, MISSING.password);
      else focusProblem(this.injector, this.usernameBox().nativeElement, MISSING.username);
      return;
    }
    this.busy.set(true);
    try {
      await this.auth.login(this.username(), this.password());
      await this.router.navigateByUrl('/');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
