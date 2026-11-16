import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { Announcements } from './core/announcer';
import { Branding } from './core/branding';
import { Theme } from './core/theme';
import { Toasts } from './core/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, Toasts, Announcements],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <router-outlet />
    <app-toasts />
    <!-- What is said to who uses a screen reader without anything on screen (see Announcer): on every page, from the start. -->
    <app-announcements />
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
