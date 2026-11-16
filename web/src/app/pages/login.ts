import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AppLogo } from '../core/app-logo';
import { Auth } from '../core/auth';
import { errorMessage } from '../core/ui';

@Component({
  selector: 'app-login',
  imports: [FormsModule, AppLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid min-h-dvh place-items-center p-4">
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
          <input id="username" class="input" name="username" autocomplete="username" autofocus required [(ngModel)]="username" />
        </div>
        <div>
          <label class="label" for="password">Contraseña</label>
          <input id="password" class="input" name="password" type="password" autocomplete="current-password" required [(ngModel)]="password" />
        </div>

        @if (error()) {
          <p class="alert-error" role="alert">{{ error() }}</p>
        }

        <button type="submit" class="btn btn-primary w-full" [disabled]="busy() || !username() || !password()">
          {{ busy() ? 'Ingresando…' : 'Ingresar' }}
        </button>
      </form>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);

  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    if (this.auth.user()) void this.router.navigateByUrl('/');
  }

  protected async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
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
