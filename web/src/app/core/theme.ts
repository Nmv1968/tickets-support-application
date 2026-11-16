import { Injectable, computed, signal } from '@angular/core';

const THEME_KEY = 'st.theme';

@Injectable({ providedIn: 'root' })
export class Theme {
  readonly dark = signal(this.initial());

  /**
   * Colours for what is drawn outside CSS (the charts), read from the variables of styles.css
   * so that each one is written down once. All of them change with the theme: the charts have
   * colours of their own (`--chart-*`), which stand out from the card in both; `muted` writes the
   * axes and the legend, `line` the grid, and `surface` is the card itself, which separates the
   * pieces of a bar or of a doughnut.
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
      primary: read('--chart-primary'),
      resolved: read('--chart-resolved'),
      pending: read('--chart-pending'),
      unresolved: read('--chart-unresolved'),
      neutral: read('--chart-neutral'),
      muted: read('--app-muted'),
      line: read('--app-line'),
      surface: read('--app-surface'),
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
