import type { Route } from '@angular/router';
import { routes } from './app.routes';
import { unsavedChangesGuard } from './core/unsaved-changes';

// The case form opens on two screens. The Back button of the browser does not close the form:
// it takes away the screen the form is on, and only the guard of that route asks first. What
// the guard does is in unsaved-changes.spec.ts; this is that the routes of the app have it.
describe('The routes of the app', () => {
  const screens: Route[] = routes.find((route) => route.path === '')?.children ?? [];
  const screen = (path: string): Route | undefined => screens.find((route) => route.path === path);

  for (const path of ['casos', 'tablero']) {
    it(`ask about the unsaved changes of the case form before "${path}" is left`, () => {
      expect(screen(path)?.canDeactivate).toContain(unsavedChangesGuard);
    });
  }
});
