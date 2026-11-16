import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { ArcElement, BarController, BarElement, CategoryScale, Chart, DoughnutController, Legend, LinearScale, Tooltip } from 'chart.js';
import type { ChartConfiguration } from 'chart.js';
import { Theme } from './theme';

// Only the pieces of Chart.js the charts of the app use, so that only those are in the bundle: bars,
// upright and lying, and a doughnut, with their legend and their tooltip. A chart of another kind
// needs its own pieces here (a line chart: LineController, LineElement, PointElement).
Chart.register(BarController, BarElement, DoughnutController, ArcElement, CategoryScale, LinearScale, Legend, Tooltip);

/** The person asked their system for less motion. */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

let tables = 0;

/** The numbers of a chart as a table: a row per label, a column per series. */
interface DataTable {
  columns: string[];
  rows: { label: string; values: string[] }[];
}

/**
 * Thin wrapper over Chart.js. A new configuration, or a switch of the theme, updates the chart on
 * the canvas; it is made anew only for another kind of chart.
 *
 * The canvas is a picture with its `label`. Its numbers are also in a table that only a screen
 * reader shows, which the picture points at: the bars and the slices can be read one by one.
 * Without motion when the person asked their system for less of it: the stylesheet cannot reach
 * what Chart.js draws on the canvas.
 */
@Component({
  selector: 'app-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <canvas #canvas role="img" [attr.aria-label]="label()" [attr.aria-describedby]="tableId"></canvas>
    <!--
      At the top of the chart: left where it falls, after the canvas, it stood out under it and gave a box a scrollbar.
      In a box of its own that hides it: a table is as wide as its rows, whatever width it is given, and made the page
      of a phone scroll sideways.
    -->
    <div class="sr-only top-0 left-0">
      <table [id]="tableId">
        <caption>
          {{ label() }}
        </caption>
        <thead>
          <tr>
            <th scope="col">{{ category() }}</th>
            @for (column of table().columns; track $index) {
              <th scope="col">{{ column }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (row of table().rows; track $index) {
            <tr>
              <th scope="row">{{ row.label }}</th>
              @for (value of row.values; track $index) {
                <td>{{ value }}</td>
              }
            </tr>
          }
        </tbody>
      </table>
    </div>
  `,
  // As wide as what it is in, and never wider: a canvas starts 300 px wide, and a box that sized
  // itself by it was wider than a small phone.
  host: { class: 'relative block w-full min-w-0' },
})
export class ChartView {
  readonly config = input.required<ChartConfiguration>();
  /** Text alternative for screen readers: the name of the picture, and the caption of its table. */
  readonly label = input.required<string>();
  /** What a row of its table is: "Mes", "Responsable". The header of the column of the labels. */
  readonly category = input('');

  protected readonly tableId = `chart-table-${++tables}`;
  protected readonly table = computed((): DataTable => {
    const { labels = [], datasets } = this.config().data;
    return {
      columns: datasets.map((dataset) => dataset.label ?? 'Casos'),
      rows: labels.map((label, index) => ({ label: String(label), values: datasets.map((dataset) => String(dataset.data[index] ?? '')) })),
    };
  });

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly theme = inject(Theme);
  private readonly reducedMotion = signal(false);
  private chart: Chart | undefined;
  /** The kind of the chart on the canvas: its type, and which way its bars lie. */
  private kind = '';

  constructor() {
    // Followed while the chart is on screen: the setting can change with the page open.
    const motion = window.matchMedia(REDUCED_MOTION);
    const followMotion = (): void => this.reducedMotion.set(motion.matches);
    followMotion();
    motion.addEventListener('change', followMotion);

    effect(() => {
      const config = this.config();
      const palette = this.theme.palette();
      const still = this.reducedMotion();

      Chart.defaults.color = palette.muted;
      Chart.defaults.borderColor = palette.line;
      Chart.defaults.font.family = '"Segoe UI", system-ui, sans-serif';

      const options = { responsive: true, maintainAspectRatio: false, ...config.options, ...(still ? { animation: false as const } : {}) };
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
    inject(DestroyRef).onDestroy(() => {
      motion.removeEventListener('change', followMotion);
      this.chart?.destroy();
    });
  }
}
