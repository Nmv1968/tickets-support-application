import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withRouterConfig } from '@angular/router';
import { NgSelectConfig } from '@ng-select/ng-select';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth';
import { SELECT_TEXTS } from './core/select';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    // A way out that is called off (the case form has unsaved changes and the person stays) leaves
    // the history as it was. By default the router would write the address back over the entry
    // the Back button went to, and that entry would be lost.
    provideRouter(routes, withRouterConfig({ canceledNavigationResolution: 'computed' })),
    provideHttpClient(withInterceptors([authInterceptor])),
    // Also given by SelectDefaults to each select; here for one that was written without it.
    { provide: NgSelectConfig, useValue: SELECT_TEXTS },
  ],
};
