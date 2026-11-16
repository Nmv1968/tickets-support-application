import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { EnvironmentProviders, Provider } from '@angular/core';
import { TestBed } from '@angular/core/testing';

/**
 * For specs: a TestBed whose requests to the API the spec answers itself, with `providers`
 * besides, and what it answers them with (`http.expectOne(...).flush(...)`).
 */
export function httpTestBed(...providers: (Provider | EnvironmentProviders)[]): HttpTestingController {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), ...providers] });
  return TestBed.inject(HttpTestingController);
}
