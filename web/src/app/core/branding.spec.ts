import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { nextTask } from '../testing/screen';
import { AppLogo } from './app-logo';
import { Branding } from './branding';

@Component({ imports: [AppLogo], changeDetection: ChangeDetectionStrategy.OnPush, template: `<app-logo size="lg" />` })
class Host {}

// The company logo replaces the default icon everywhere at once, the browser tab included.
describe('Branding, the company logo', () => {
  let branding: Branding;
  let http: HttpTestingController;
  let tabIcon: HTMLLinkElement;

  beforeEach(() => {
    // The tab icon as index.html declares it.
    document.querySelectorAll('link[rel~="icon"]').forEach((link) => link.remove());
    tabIcon = document.createElement('link');
    tabIcon.rel = 'icon';
    tabIcon.type = 'image/x-icon';
    tabIcon.setAttribute('href', 'favicon.ico');
    document.head.appendChild(tabIcon);

    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    branding = TestBed.inject(Branding);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    tabIcon.remove();
  });

  it('uses the default icon while the server has no logo', async () => {
    const loading = branding.load();
    http.expectOne({ method: 'GET', url: '/api/branding' }).flush({ logoVersion: null });
    await loading;

    expect(branding.logoUrl()).toBeNull();
    expect(tabIcon.getAttribute('href')).toBe('favicon.ico');
    expect(tabIcon.getAttribute('type')).toBe('image/x-icon');
  });

  it('shows the logo of the server, also as the icon of the browser tab', async () => {
    const loading = branding.load();
    http.expectOne('/api/branding').flush({ logoVersion: 'abc123' });
    await loading;

    // The version is in the address: a new logo is a new address, so no browser shows an old copy.
    expect(branding.logoUrl()).toBe('/api/branding/logo?v=abc123');
    expect(tabIcon.getAttribute('href')).toBe('/api/branding/logo?v=abc123');
    // The logo is not an .ico file: the type the page declared no longer holds.
    expect(tabIcon.hasAttribute('type')).toBeFalse();
  });

  it('goes back to the default icon when the logo is removed', () => {
    branding.use('abc123');
    branding.use(null);

    expect(branding.logoUrl()).toBeNull();
    expect(tabIcon.getAttribute('href')).toBe('favicon.ico');
    expect(tabIcon.getAttribute('type')).toBe('image/x-icon');
  });

  it('keeps the look it has when the server does not answer', async () => {
    branding.use('abc123');

    const loading = branding.load();
    http.expectOne('/api/branding').error(new ProgressEvent('error'));
    await loading;
    await nextTask();

    expect(branding.logoUrl()).toBe('/api/branding/logo?v=abc123');
  });

  describe('AppLogo', () => {
    it('draws the default icon on the brand colour, or the logo alone', () => {
      const fixture = TestBed.createComponent(Host);
      fixture.detectChanges();
      const logo = (fixture.nativeElement as HTMLElement).querySelector('app-logo')!;

      expect(logo.querySelector('app-icon[data-icon=lifebuoy]')).not.toBeNull();
      expect(logo.querySelector('img')).toBeNull();
      expect(logo.classList).toContain('bg-primary');
      expect(logo.classList).toContain('size-11');

      branding.use('abc123');
      fixture.detectChanges();

      const image = logo.querySelector('img')!;
      expect(image.getAttribute('src')).toBe('/api/branding/logo?v=abc123');
      // Decorative: the name of the app is written beside it.
      expect(image.getAttribute('alt')).toBe('');
      expect(logo.querySelector('app-icon')).toBeNull();
      expect(logo.classList).not.toContain('bg-primary');
    });
  });
});
