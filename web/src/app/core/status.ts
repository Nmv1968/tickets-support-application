import { ChangeDetectionStrategy, Component, DestroyRef, afterNextRender, inject, signal } from '@angular/core';

/**
 * How long a status is on the screen empty before what it says goes in, in ms: past the next
 * frames of the browser, which tell the screen reader of the region first.
 */
export const STATUS_DELAY_MS = 100;

/**
 * What a screen says about itself as it changes, read out to who uses a screen reader without
 * moving their focus: "12 caso(s)", "Actualizando…", "Cargando…". `<app-status>{{ … }}</app-status>`.
 *
 * Always on the screen, with what it says changing inside it: a screen reader reads a change in
 * a region it already knows, and may say nothing of one that arrives with its text. So a status
 * comes empty, and what it holds goes in a moment later (STATUS_DELAY_MS): the "Cargando…" of a
 * panel that has just opened is a change, and is read. A text that only a screen reader needs goes
 * in a `sr-only` element inside, or on the whole status.
 * Read whole (aria-atomic), and politely: after what the screen reader is saying.
 */
@Component({
  selector: 'app-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' },
  template: `
    @if (shown()) {
      <ng-content />
    }
  `,
})
export class Status {
  protected readonly shown = signal(false);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const timer = setTimeout(() => this.shown.set(true), STATUS_DELAY_MS);
      destroyRef.onDestroy(() => clearTimeout(timer));
    });
  }
}
