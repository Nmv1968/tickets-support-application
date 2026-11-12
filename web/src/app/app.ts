import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Branding } from './core/branding';
import { Theme } from './core/theme';
import { Toasts } from './core/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toasts],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-toasts />
  `,
})
export class App {
  // Injected here so the saved theme applies before the first screen renders.
  private readonly theme = inject(Theme);

  constructor() {
    // The company logo, for every screen and for the browser tab. The login page shows it too,
    // so it is asked for before anyone has a session.
    void inject(Branding).load();
  }
}
