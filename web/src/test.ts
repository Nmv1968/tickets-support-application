// Sets up the test page for every spec, in place of the one the Karma builder would write.
import { NgModule, provideCheckNoChangesConfig, provideZonelessChangeDetection } from '@angular/core';
import { getTestBed } from '@angular/core/testing';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';

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
