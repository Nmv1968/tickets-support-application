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

/** A chart in a row narrower than a canvas starts: a card of a phone, beside nothing. */
@Component({
  imports: [ChartView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="box" class="flex w-60 overflow-x-auto">
      <app-chart class="h-40" [config]="config" label="Casos" />
    </div>
  `,
})
class NarrowHost {
  readonly config = bars([3, 2]);
}

/** The same row, with the long names of the companies of a dashboard: its table for a screen reader is wider than the row. */
@Component({
  imports: [ChartView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div id="box" class="flex w-60 overflow-x-auto">
      <app-chart class="h-40" [config]="config" label="Las diez empresas con más casos" category="Empresa" />
    </div>
  `,
})
class LongNamesHost {
  readonly config: ChartConfiguration = {
    type: 'bar',
    data: { labels: ['Comercializadora de Productos Agroindustriales y Alimenticios del Litoral S.A.', 'DistribuidoraDeRepuestosAutomotricesSinEspacios'], datasets: [{ label: 'Casos', data: [3, 2] }] },
    options: { indexAxis: 'y' },
  };
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

  // A canvas starts 300 px wide: a chart sized by it was wider than the card of a small phone.
  it('is as wide as what it is in, never as wide as its canvas', () => {
    const narrow = TestBed.createComponent(NarrowHost);
    narrow.detectChanges();
    const box = (narrow.nativeElement as HTMLElement).querySelector<HTMLElement>('#box')!;
    const drawn = box.querySelector('app-chart')!;

    expect(drawn.getBoundingClientRect().width).toBe(240);
    expect(box.scrollWidth).toBe(box.clientWidth);
  });

  // Hidden with sr-only on the table itself, it was as wide as its longest row on one line: the dashboard of a phone scrolled sideways.
  it('does not make what it is in wider with its table for a screen reader', () => {
    const narrow = TestBed.createComponent(LongNamesHost);
    narrow.detectChanges();
    const box = (narrow.nativeElement as HTMLElement).querySelector<HTMLElement>('#box')!;

    expect(box.querySelector('table')!.getBoundingClientRect().width).toBeGreaterThan(box.clientWidth);
    expect(box.scrollWidth).toBe(box.clientWidth);
  });

  // Only what the charts of the app need is in the bundle: Chart.js leaves out what is not registered.
  it('has the pieces of Chart.js of the charts of the app, and no others', () => {
    for (const id of ['bar', 'doughnut']) expect(Chart.registry.getController(id)).withContext(id).toBeDefined();
    for (const id of ['legend', 'tooltip']) expect(Chart.registry.getPlugin(id)).withContext(id).toBeDefined();
    expect(() => Chart.registry.getController('line')).toThrowError(/not a registered controller/);
    expect(() => Chart.registry.getPlugin('title')).toThrowError(/not a registered plugin/);
  });

  // The numbers were only a picture with a line of text: a screen reader could not read a bar.
  it('has its numbers in a table for a screen reader, which the picture points at', () => {
    const table = (fixture.nativeElement as HTMLElement).querySelector('table')!;
    expect(canvas().getAttribute('aria-describedby')).toBe(table.id);
    expect(table.closest('.sr-only')).not.toBeNull();
    expect(table.querySelector('caption')!.textContent!.trim()).toBe('Casos');
    const cells = (row: Element): string[] => Array.from(row.children, (cell) => cell.textContent?.trim() ?? '');
    expect(Array.from(table.querySelectorAll('tr'), cells)).toEqual([
      ['', 'Casos'],
      ['Fila 1', '3'],
      ['Fila 2', '2'],
    ]);

    show(DOUGHNUT);
    expect(Array.from(table.querySelectorAll('tbody tr'), cells)).toEqual([
      ['Alta', '3'],
      ['Baja', '2'],
    ]);
  });
});

// The bars grew and the slices turned with "reducir movimiento" on: the stylesheet cannot reach a canvas (WCAG 2.3.3).
describe('ChartView with less motion asked for', () => {
  const REDUCED = '(prefers-reduced-motion: reduce)';
  let reduced: boolean;
  let changed: (() => void) | undefined;

  beforeEach(() => {
    localStorage.setItem('st.theme', 'light');
    reduced = true;
    const real = window.matchMedia.bind(window);
    spyOn(window, 'matchMedia').and.callFake((query: string) => {
      if (query !== REDUCED) return real(query);
      return {
        get matches() {
          return reduced;
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => (changed = listener),
        removeEventListener: () => (changed = undefined),
      } as unknown as MediaQueryList;
    });
  });

  afterEach(() => localStorage.removeItem('st.theme'));

  it('draws its charts without animation, and follows the setting when it changes', () => {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const chart = (): Chart => Chart.getChart((fixture.nativeElement as HTMLElement).querySelector('canvas')!)!;
    expect(chart().options.animation).toBeFalse();

    reduced = false;
    changed?.();
    fixture.detectChanges();
    expect(chart().options.animation).not.toBeFalse();

    fixture.destroy();
    expect(changed).toBeUndefined();
  });
});
