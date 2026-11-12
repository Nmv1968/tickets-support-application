import { DOCUMENT } from '@angular/common';
import { Injectable, inject, signal } from '@angular/core';
import { Api } from './api';

/**
 * The look an installation gives itself: the company logo, set in Configuración > Empresa. When
 * there is one it takes the place of the default icon in the menu and on the login page, and it
 * is also the icon of the browser tab.
 */
@Injectable({ providedIn: 'root' })
export class Branding {
  private readonly api = inject(Api);
  private readonly document = inject(DOCUMENT);

  /** Address of the company logo. Null: the default icon is used. */
  readonly logoUrl = signal<string | null>(null);

  /** The tab icon the page came with, to go back to when the logo is removed. */
  private defaultIcon: { href: string; type: string | null } | undefined;

  /** Asks the server which logo there is. Called when the app starts and when the settings change elsewhere. */
  async load(): Promise<void> {
    try {
      this.use((await this.api.branding()).logoVersion);
    } catch {
      // Without an answer the look stays as it is; the next load tries again.
    }
  }

  /** Takes the logo of `version`, as just stored or just read. Null: no logo. */
  use(version: string | null): void {
    // The version is part of the address: the browser keeps each logo for good, and a new one is a new address.
    const url = version ? `/api/branding/logo?v=${encodeURIComponent(version)}` : null;
    this.logoUrl.set(url);
    this.showTabIcon(url);
  }

  private showTabIcon(url: string | null): void {
    const link = this.document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
    if (!link) return;
    this.defaultIcon ??= { href: link.getAttribute('href') ?? '', type: link.getAttribute('type') };
    link.setAttribute('href', url ?? this.defaultIcon.href);
    // The default icon declares its type (.ico); the logo may be PNG, JPG or WebP, and the server says which.
    if (url || !this.defaultIcon.type) link.removeAttribute('type');
    else link.setAttribute('type', this.defaultIcon.type);
  }
}
