import { ChangeDetectionStrategy, Component, EnvironmentInjector, ErrorHandler, NgZone, createEnvironmentInjector, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { appConfig } from './app.config';

describe('The app', () => {
  it('draws its screens without zone.js', () => {
    // The providers of the app, over the ones of the test page: theirs say how screens are drawn.
    const injector = createEnvironmentInjector(appConfig.providers, TestBed.inject(EnvironmentInjector));
    // With zone.js the app would have the NgZone of Angular. Without it, one that only runs what it is given.
    expect(injector.get(NgZone)).not.toBeInstanceOf(NgZone);
    injector.destroy();
  });
});

// What src/test.ts sets up for every spec.
describe('The specs', () => {
  @Component({
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<p>{{ count() }} {{ text }}</p>`,
  })
  class Screen {
    readonly count = signal(0);
    /** Not a signal: Angular is not told when it changes. */
    text = 'antes';
  }

  it('draw a screen again by themselves when a signal it reads changes, as the app does', async () => {
    const fixture = TestBed.createComponent(Screen);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('0 antes');

    fixture.componentInstance.count.set(1);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('1 antes');
  });

  it('fail on a template value changed without telling Angular, also on an OnPush screen nothing marked', () => {
    // The default one would write the error to the console as well.
    TestBed.configureTestingModule({ providers: [{ provide: ErrorHandler, useValue: { handleError: () => undefined } }] });
    const fixture = TestBed.createComponent(Screen);
    fixture.detectChanges();

    fixture.componentInstance.text = 'después';

    expect(() => fixture.detectChanges()).toThrowError(/NG0100/);
  });
});
