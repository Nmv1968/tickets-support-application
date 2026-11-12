import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Chart } from 'chart.js';
import type { Dashboard } from '../core/api';
import { Theme } from '../core/theme';
import { DashboardPage } from './dashboard';

const DATA: Dashboard = {
  totals: { total: 5, unresolved: 1, pending: 2, resolved: 2, overdue: 0 },
  avgResolutionHours: null,
  slaCompliance: null,
  estimatedMinutes: 0,
  spentMinutes: 0,
  byAssignee: [],
  byCompany: [],
  byModule: [],
  byPriority: [
    { priority: 'HIGH', total: 3 },
    { priority: null, total: 2 },
  ],
  monthly: [],
};

// Drawn for real, with the colours the stylesheet gives (the test page loads styles.css): the
// charts take them from its variables, so a constant here would not notice a variable that is gone.
describe('DashboardPage, "Casos por prioridad"', () => {
  let fixture: ComponentFixture<DashboardPage>;
  let theme: Theme;

  beforeEach(async () => {
    // The light theme, whatever the machine that runs the tests prefers.
    localStorage.setItem('st.theme', 'light');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    theme = TestBed.inject(Theme);

    fixture = TestBed.createComponent(DashboardPage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController)
      .expectOne((request) => request.url === '/api/dashboard')
      .flush(DATA);
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.removeItem('st.theme');
    document.documentElement.classList.remove('dark');
  });

  /** The colour of each slice of the chart on screen. */
  function slices(): unknown {
    const canvas = (fixture.nativeElement as HTMLElement).querySelector<HTMLCanvasElement>('canvas[aria-label="Casos por prioridad"]');
    return Chart.getChart(canvas!)?.data.datasets[0].backgroundColor;
  }

  // It was drawn in the grey of the secondary text, which is dark slate in the light theme: the
  // slice that says the least stood out the most.
  it('draws the slice of the cases without priority in the same light grey in both themes', () => {
    expect(theme.palette().muted).toBe('#5b6472');
    expect(slices()).toEqual(['#f5a524', '#9b9b9f']);

    theme.toggle();
    fixture.detectChanges();
    expect(theme.palette().muted).toBe('#9b9b9f');
    expect(slices()).toEqual(['#f5a524', '#9b9b9f']);
  });
});
