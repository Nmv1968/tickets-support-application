import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Chart } from 'chart.js';
import type { CartesianScaleOptions, ChartConfiguration } from 'chart.js';
import { ChartView } from './chart-view';
import { Theme } from './theme';

/** Bars with these numbers, upright or lying (`y`). */
function bars(data: number[], indexAxis: 'x' | 'y' = 'x'): ChartConfiguration {
  return { type: 'bar', data: { labels: data.map((_, index) => `Fila ${index + 1}`), datasets: [{ label: 'Casos', data }] }, options: { indexAxis } };
}

const DOUGHNUT: ChartConfiguration = { type: 'doughnut', data: { labels: ['Alta', 'Baja'], datasets: [{ data: [3, 2] }] } };

@Component({
  imports: [ChartView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-chart class="h-64" [config]="config()" label="Casos" />`,
})
class Host {
  readonly config = signal(bars([3, 2]));
}

// Drawn for real, with the colours of styles.css, which the test page loads.
describe('ChartView', () => {
  let fixture: ComponentFixture<Host>;
  let theme: Theme;

  beforeEach(() => {
    // The light theme, whatever the machine that runs the tests prefers.
    localStorage.setItem('st.theme', 'light');
    theme = TestBed.inject(Theme);
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('st.theme');
    document.documentElement.classList.remove('dark');
  });

  const canvas = (): HTMLCanvasElement => (fixture.nativeElement as HTMLElement).querySelector('canvas')!;
  const chart = (): Chart => Chart.getChart(canvas())!;

  function show(config: ChartConfiguration): void {
    fixture.componentInstance.config.set(config);
    fixture.detectChanges();
  }

  it('draws on its canvas, which carries the text for a screen reader', () => {
    expect(chart().data.datasets[0].data).toEqual([3, 2]);
    expect(canvas().getAttribute('role')).toBe('img');
    expect(canvas().getAttribute('aria-label')).toBe('Casos');
  });

  it('updates the chart on its canvas with new numbers, instead of making it again', () => {
    const drawn = chart();
    show(bars([5, 1, 4]));

    expect(chart()).toBe(drawn);
    expect(drawn.data.labels).toEqual(['Fila 1', 'Fila 2', 'Fila 3']);
    expect(drawn.data.datasets[0].data).toEqual([5, 1, 4]);
  });

  it('makes it again for another kind of chart: a doughnut, or bars that lie the other way', () => {
    const upright = chart();
    show(bars([3, 2], 'y'));
    const lying = chart();
    expect(lying).not.toBe(upright);
    expect(lying.options.indexAxis).toBe('y');
    // The one it replaces lets go of the canvas.
    expect(upright.canvas).toBeNull();

    show(DOUGHNUT);
    expect(chart()).not.toBe(lying);
    expect(chart().config).toEqual(jasmine.objectContaining({ type: 'doughnut' }));
  });

  it('takes the colours of a new theme without being made again', () => {
    const drawn = chart();
    /** The colours of the numbers along the side and of the lines across, as they are drawn. */
    const axis = (): CartesianScaleOptions => chart().scales['y'].options as CartesianScaleOptions;
    const ticks = (): unknown => axis().ticks.color;
    const grid = (): unknown => axis().grid.color;
    expect(ticks()).toBe('#5b6472');
    expect(grid()).toBe(theme.palette().line);

    theme.toggle();
    fixture.detectChanges();
    expect(chart()).toBe(drawn);
    expect(ticks()).toBe('#9b9b9f');
    expect(grid()).toBe(theme.palette().line);
    expect(theme.palette().line).not.toBe('#dbe4f3');
  });

  it('lets go of the canvas when it goes away', () => {
    const drawn = chart();
    fixture.destroy();
    expect(drawn.canvas).toBeNull();
  });

  // Only what the charts of the app need is in the bundle: Chart.js leaves out what is not registered.
  it('has the pieces of Chart.js of the charts of the app, and no others', () => {
    for (const id of ['bar', 'doughnut']) expect(Chart.registry.getController(id)).withContext(id).toBeDefined();
    for (const id of ['legend', 'tooltip']) expect(Chart.registry.getPlugin(id)).withContext(id).toBeDefined();
    expect(() => Chart.registry.getController('line')).toThrowError(/not a registered controller/);
    expect(() => Chart.registry.getPlugin('title')).toThrowError(/not a registered plugin/);
  });
});
