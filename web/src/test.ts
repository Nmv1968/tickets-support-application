// Sets up the test page for every spec, in place of the one the Karma builder would write.
import { NgModule, provideCheckNoChangesConfig, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { restoreMotion } from './app/testing/reduced-motion';
import { restoreScreen } from './app/testing/viewport';

/**
 * Every spec draws its screens without zones, as the app does (see app.config.ts). zone.js is
 * still on the test page, only for fakeAsync and its fake clock.
 *
 * Each check for changes also checks every view, the OnPush ones that nothing marked included,
 * and fails on a template value that changed without telling Angular: without zones, nothing
 * would draw it again. `provideCheckNoChangesConfig` is in developer preview in Angular 20.
 */
@NgModule({ providers: [provideZonelessChangeDetection(), provideCheckNoChangesConfig({ exhaustive: true })] })
class ZonelessTesting {}

getTestBed().initTestEnvironment([BrowserTestingModule, ZonelessTesting], platformBrowserTesting(), {
  errorOnUnknownElements: true,
  errorOnUnknownProperties: true,
});

/*
 * Karma draws the specs in a frame of its page, some 747 × 428 px in the browser of the tests:
 * lower than the short screens of styles.css (`short:`), where the bars and footers of the app
 * scroll with the content. Made as high as the screen of a laptop, every spec is laid out as on a
 * screen of usual height, unless it chooses a size of its own (see testing/viewport.ts), which it
 * has only until it ends.
 */
const frame = window.frameElement as HTMLElement | null;
if (frame) frame.style.height = '800px';
afterEach(restoreScreen);
// The same for the rules of less motion a spec asked for (see testing/reduced-motion.ts).
afterEach(restoreMotion);
