import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, effect, inject, input, viewChild } from '@angular/core';
import { ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Legend, LinearScale, Tooltip } from 'chart.js';
import type { ChartConfiguration } from 'chart.js';
import { Theme } from './theme';

// Only the pieces of Chart.js the charts of the app use, so that only those are in the bundle: bars,
// upright and lying, and a doughnut, with their legend and their tooltip. A chart of another kind
// needs its own pieces here (a line chart: LineController, LineElement, PointElement).
Chart.register(BarController, BarElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Legend, Tooltip);

/**
 * Thin wrapper over Chart.js. A new configuration, or a switch of the theme, updates the chart on
 * the canvas; it is made anew only for another kind of chart.
 */
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
  /** The kind of the chart on the canvas: its type, and which way its bars lie. */
  private kind = '';

  constructor() {
    effect(() => {
      const config = this.config();
      const palette = this.theme.palette();

      Chart.defaults.color = palette.muted;
      Chart.defaults.borderColor = palette.line;
      Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';

      const options = { responsive: true, maintainAspectRatio: false, ...config.options };
      const kind = `${config.type} ${config.options?.indexAxis ?? 'x'}`;
      if (this.chart && kind === this.kind) {
        // An update reads the defaults above again: the colours of a new theme reach it too.
        this.chart.data = config.data;
        this.chart.options = options;
        this.chart.update();
        return;
      }
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, { ...config, options });
      this.kind = kind;
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
