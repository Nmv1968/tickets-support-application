import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { answerCatalogs } from '../../testing/catalogs';
import { SettingsPage } from './settings';

describe('SettingsPage, the tabs of Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SettingsPage>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(SettingsPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  const tabs = (): HTMLButtonElement[] => [...el.querySelectorAll<HTMLButtonElement>('[role=tab]')];

  function openTab(label: string): void {
    tabs()
      .find((tab) => tab.textContent?.trim() === label)!
      .click();
    fixture.detectChanges();
    flushMicrotasks();
  }

  // Who can log in, who attends, for whom and what kind of case; then how the system behaves.
  it('are the catalogs first and the settings after, starting on Usuarios', () => {
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual([
      'Usuarios',
      'Responsables',
      'Empresas',
      'Tipos de soporte',
      'Módulos',
      'SLA',
      'Recordatorios',
      'IA',
      'Logo',
      'Mi cuenta',
    ]);
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', ...Array<string>(9).fill('false')]);
    expect(el.querySelector('app-users-tab')).not.toBeNull();
  });

  it('"Empresas" is the catalog of client companies', fakeAsync(() => {
    openTab('Empresas');
    answerCatalogs(http, { companies: [{ id: 1, name: 'Acme', active: true, tickets: 2 }] });
    tick();
    fixture.detectChanges();

    expect(el.querySelector<HTMLInputElement>('app-named-catalog-tab input[aria-label="Nombre de la empresa Acme"]')!.value).toBe('Acme');
  }));

  it('"Tipos de soporte" is the catalog of the labels of a case', fakeAsync(() => {
    openTab('Tipos de soporte');
    answerCatalogs(http, { supportTypes: [{ id: 1, name: 'Capacitación', color: '#12b76a', active: true, tickets: 0 }] });
    tick();
    fixture.detectChanges();

    expect(el.querySelector<HTMLInputElement>('app-support-types-tab input[aria-label="Nombre del tipo Capacitación"]')!.value).toBe('Capacitación');
  }));

  // It was called "Empresa", which now reads as the catalog next to it.
  it('"Logo" is where the logo of the installation is uploaded', fakeAsync(() => {
    openTab('Logo');

    expect(el.querySelector('app-branding-tab h2')!.textContent).toBe('Logo de la empresa');
    expect(el.querySelector('app-named-catalog-tab')).toBeNull();
  }));
});
