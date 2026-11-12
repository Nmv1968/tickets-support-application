import { Injectable, computed, signal } from '@angular/core';

const THEME_KEY = 'st.theme';

@Injectable({ providedIn: 'root' })
export class Theme {
  readonly dark = signal(this.initial());

  /**
   * Colours for what is drawn outside CSS (the charts), read from the variables of styles.css
   * so that each one is written down once. `muted` and `line` change with the theme; `neutral`
   * (a slice without a value) does not.
   *
   * Read once per theme and kept, so the stylesheet has to be applied before the first read.
   * That is why the production build does not load it late (angular.json, `inlineCritical: false`).
   */
  readonly palette = computed(() => {
    // Read again after each switch (see toggle for the order).
    this.dark();
    const style = getComputedStyle(document.documentElement);
    const read = (name: string): string => style.getPropertyValue(name).trim();
    return {
      primary: read('--color-primary'),
      success: read('--color-success'),
      warning: read('--color-warning'),
      danger: read('--color-danger'),
      muted: read('--app-muted'),
      line: read('--app-line'),
      neutral: read('--chart-neutral'),
    };
  });

  constructor() {
    this.apply(this.dark());
  }

  toggle(): void {
    const dark = !this.dark();
    localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    // The class first: whoever reacts to the signal reads the colours of the new theme.
    this.apply(dark);
    this.dark.set(dark);
  }

  private initial(): boolean {
    const stored = localStorage.getItem(THEME_KEY);
    return stored ? stored === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  private apply(dark: boolean): void {
    document.documentElement.classList.toggle('dark', dark);
  }
}
