import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import type { ChartConfiguration } from 'chart.js';
import { Theme } from './theme';

Chart.register(...registerables);

/** Thin wrapper over Chart.js. Redraws when the configuration or the theme changes. */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<canvas #canvas role="img" [attr.aria-label]="label()"></canvas>`,
  host: { class: 'relative block' },
})
export class ChartView {
  readonly config = input.required<ChartConfiguration>();
  /** Text alternative for screen readers. */
  readonly label = input.required<string>();

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly theme = inject(Theme);
  private chart: Chart | undefined;

  constructor() {
    effect(() => {
      const config = this.config();
      const palette = this.theme.palette();

      Chart.defaults.color = palette.muted;
      Chart.defaults.borderColor = palette.line;
      Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';

      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, {
        ...config,
        options: { responsive: true, maintainAspectRatio: false, ...config.options },
      });
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
