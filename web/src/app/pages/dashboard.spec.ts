import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Chart } from 'chart.js';
import type { Dashboard } from '../core/api';
import { Theme } from '../core/theme';
import { TicketEvents } from '../core/ticket-events';
import { todayIso } from '../core/ui';
import { buttonIn, nextTask, toasts } from '../testing/screen';
import { DashboardPage } from './dashboard';

const DATA: Dashboard = {
  totals: { total: 5, unresolved: 1, pending: 2, resolved: 2, overdue: 0 },
  avgResolutionHours: null,
  slaCompliance: null,
  estimatedMinutes: 0,
  spentMinutes: 0,
  byAssignee: [],
  byCompany: [],
  bySupportType: [],
  byModule: [],
  byPriority: [
    { priority: 'HIGH', total: 3 },
    { priority: null, total: 2 },
  ],
  monthly: [],
};

// Drawn for real, with the colours the stylesheet gives (the test page loads styles.css): the
// charts take them from its variables, so a constant here would not notice a variable that is gone.
describe('DashboardPage', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<DashboardPage>;
  let el: HTMLElement;
  let theme: Theme;

  beforeEach(() => {
    // The light theme, whatever the machine that runs the tests prefers.
    localStorage.setItem('st.theme', 'light');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    theme = TestBed.inject(Theme);
  });

  afterEach(() => {
    // Also catches a read nobody expected: any request left unanswered fails the test.
    http.verify();
    localStorage.removeItem('st.theme');
    document.documentElement.classList.remove('dark');
  });

  /** A read of the numbers that is on its way. */
  const read = (): TestRequest => http.expectOne((request) => request.url === '/api/dashboard');

  /** Lets what was answered reach the screen. Not `whenStable`: a test may have another read still on its way. */
  async function show(): Promise<void> {
    await nextTask();
    fixture.detectChanges();
  }

  /** Creates the dashboard with its first read still on its way. */
  function create(): void {
    fixture = TestBed.createComponent(DashboardPage);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  async function open(data: Dashboard = DATA): Promise<void> {
    create();
    read().flush(data);
    await show();
  }

  /** The chart with this name for a screen reader, as it is drawn. */
  function chart(label: string): Chart | undefined {
    const canvas = el.querySelector<HTMLCanvasElement>(`canvas[aria-label="${label}"]`);
    return canvas ? Chart.getChart(canvas) : undefined;
  }

  /** The number of an indicator, by the name it has on screen. */
  function indicator(label: string): string {
    const card = Array.from(el.querySelectorAll('.card')).find((item) => item.firstElementChild?.textContent?.trim() === label);
    return card?.querySelector('.text-2xl')?.textContent?.trim() ?? '';
  }

  const button = (text: string): HTMLButtonElement => buttonIn(el, text);
  const archivedBox = (): HTMLInputElement => el.querySelector<HTMLInputElement>('input[type=checkbox]')!;

  /** A day picked in a date field of the period. */
  function pick(field: 'Desde' | 'Hasta', day: string): void {
    const input = el.querySelector<HTMLInputElement>(`input[aria-label="${field}"]`)!;
    input.value = day;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  describe('"Casos por prioridad"', () => {
    /** The colour of each slice of the chart on screen. */
    const slices = (): unknown => chart('Casos por prioridad')?.data.datasets[0].backgroundColor;

    // It was drawn in the grey of the secondary text, which is dark slate in the light theme: the
    // slice that says the least stood out the most.
    it('draws the slice of the cases without priority in the same light grey in both themes', async () => {
      await open();
      expect(theme.palette().muted).toBe('#5b6472');
      expect(slices()).toEqual(['#f5a524', '#9b9b9f']);

      theme.toggle();
      fixture.detectChanges();
      expect(theme.palette().muted).toBe('#9b9b9f');
      expect(slices()).toEqual(['#f5a524', '#9b9b9f']);
    });
  });

  describe('"Casos por tipo de soporte"', () => {
    const TYPES: Dashboard['bySupportType'] = [
      { name: 'Falla del sistema', color: '#b91c1c', total: 3 },
      { name: 'Capacitación', color: '#12b76a', total: 2 },
      { name: 'Sin tipo', color: null, total: 1 },
    ];
    const types = (): Chart | undefined => chart('Casos por tipo de soporte');

    it('draws a bar per type in the colour the team gave it, and the cases without a type in the neutral grey', async () => {
      await open({ ...DATA, bySupportType: TYPES });

      expect(types()?.data.labels).toEqual(['Falla del sistema', 'Capacitación', 'Sin tipo']);
      expect(types()?.data.datasets[0].data).toEqual([3, 2, 1]);
      expect(types()?.data.datasets[0].backgroundColor).toEqual(['#b91c1c', '#12b76a', '#9b9b9f']);
      // A case with two types is in two bars: the chart says so, since its bars add up to more than the total.
      expect(el.textContent).toContain('Un caso con varios tipos cuenta en cada uno.');
    });

    // Those colours are the team's, not the theme's: the dark theme draws the same ones. A type can
    // then be of the colour of the card the chart is on, so each bar has an outline that is the theme's.
    it('keeps the colours of the types in the dark theme, each bar with an outline that can be seen on either', async () => {
      await open({ ...DATA, bySupportType: TYPES });
      expect(types()?.data.datasets[0].borderColor).toBe('#5b6472');

      theme.toggle();
      fixture.detectChanges();
      expect(types()?.data.datasets[0].backgroundColor).toEqual(['#b91c1c', '#12b76a', '#9b9b9f']);
      expect(types()?.data.datasets[0].borderColor).toBe('#9b9b9f');
      expect(types()?.data.datasets[0].borderWidth).toBe(1);
    });

    it('is not drawn while no case of the period has a type', async () => {
      await open({ ...DATA, bySupportType: [{ name: 'Sin tipo', color: null, total: 5 }] });
      expect(types()).toBeUndefined();
      expect(el.textContent).not.toContain('Casos por tipo de soporte');
    });

    // The catalog is the team's and has no limit. The other charts show the first rows of a list.
    it('grows with the types, so that each one keeps its row and its name', async () => {
      const many = Array.from({ length: 20 }, (_, index) => ({ name: `Tipo ${index + 1}`, color: '#64748b', total: 20 - index }));
      await open({ ...DATA, bySupportType: TYPES });
      const few = types()!.canvas.parentElement!.offsetHeight;
      expect(few).toBe(chart('Casos por prioridad')!.canvas.parentElement!.offsetHeight);

      // The cases changed: the numbers are read again.
      pick('Desde', '2026-01-01');
      read().flush({ ...DATA, bySupportType: many });
      await show();
      expect(types()?.data.labels?.length).toBe(20);
      expect(types()!.canvas.parentElement!.offsetHeight).toBeGreaterThan(few);
    });
  });

  describe('the numbers', () => {
    const fewer = { ...DATA, totals: { ...DATA.totals, total: 3 } };

    it('are read again when cases change, here or elsewhere, and the ones on screen stay meanwhile', async () => {
      await open();
      TestBed.inject(TicketEvents).outdated(null);
      fixture.detectChanges();
      const again = read();
      expect(indicator('Total')).toBe('5');

      again.flush(fewer);
      await show();
      expect(indicator('Total')).toBe('3');
    });

    it('of another period: the ones on screen stay until they arrive', async () => {
      await open();
      pick('Desde', '2026-01-01');
      const ranged = read();
      expect(indicator('Total')).toBe('5');

      ranged.flush(fewer);
      await show();
      expect(indicator('Total')).toBe('3');
    });

    it('that cannot be read: says why, and leaves the ones on screen', async () => {
      await open();
      TestBed.inject(TicketEvents).outdated(null);
      fixture.detectChanges();
      read().flush({ message: 'Error interno' }, { status: 500, statusText: 'Server Error' });
      await show();

      expect(toasts()).toEqual(['Error interno']);
      expect(indicator('Total')).toBe('5');
    });
  });

  describe('archived cases', () => {
    it('count, with the box "Incluir archivados" checked, until the person unchecks it: the numbers are then read without them', async () => {
      create();
      const first = read();
      // Nothing is said about them: the API counts them.
      expect(first.request.params.has('archived')).toBeFalse();
      first.flush(DATA);
      await show();
      expect(archivedBox().checked).toBeTrue();
      expect(archivedBox().closest('label')?.textContent?.trim()).toBe('Incluir archivados');

      archivedBox().click();
      fixture.detectChanges();
      const without = read();
      expect(without.request.params.get('archived')).toBe('exclude');
      without.flush({ ...DATA, totals: { ...DATA.totals, total: 3 } });
      await show();
      expect(indicator('Total')).toBe('3');

      archivedBox().click();
      fixture.detectChanges();
      const again = read();
      expect(again.request.params.has('archived')).toBeFalse();
      again.flush(DATA);
      await show();
      expect(indicator('Total')).toBe('5');
    });

    it('are left out of the reads that follow a change of the period, while the box is unchecked', async () => {
      await open();
      archivedBox().click();
      fixture.detectChanges();
      read().flush(DATA);
      await show();

      pick('Desde', '2026-01-01');
      const ranged = read();
      expect(ranged.request.params.get('from')).toBe('2026-01-01');
      expect(ranged.request.params.get('archived')).toBe('exclude');
      ranged.flush(DATA);
      await show();
    });

    // The first read counts them and may take longer than the one that leaves them out.
    it('the numbers on screen are the ones asked for last: the older read is cancelled, its answer never arrives', async () => {
      create();
      const withArchived = read();
      // The page is on screen, and the box is unchecked before the numbers arrive.
      await show();
      archivedBox().click();
      fixture.detectChanges();
      const without = read();
      expect(withArchived.cancelled).toBeTrue();

      without.flush({ ...DATA, totals: { ...DATA.totals, total: 3 } });
      await show();
      expect(indicator('Total')).toBe('3');
      expect(toasts()).toEqual([]);
    });
  });

  describe('the report', () => {
    let saved: { name: string; href: string }[];
    const download = (format: 'xlsx' | 'pdf'): TestRequest => http.expectOne((request) => request.url === `/api/dashboard/export/${format}`);

    beforeEach(() => {
      // A click on a link with `download` saves a file: here it is only recorded.
      saved = [];
      spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
        saved.push({ name: this.download, href: this.href });
      });
    });

    it('in Excel and in PDF is downloaded from the server and saved under its name, with the day', async () => {
      await open();
      for (const [label, format] of [
        ['Excel', 'xlsx'],
        ['PDF', 'pdf'],
      ] as const) {
        button(label).click();
        fixture.detectChanges();
        const request = download(format);
        expect(request.request.responseType).toBe('blob');
        // Every case of every date, archived or not: what the screen shows as it opens.
        expect(request.request.params.keys()).toEqual([]);
        request.flush(new Blob([format]));
        await nextTask();
        fixture.detectChanges();
      }

      expect(saved.map((file) => file.name)).toEqual([`reporte-soporte-${todayIso()}.xlsx`, `reporte-soporte-${todayIso()}.pdf`]);
      expect(saved.every((file) => file.href.startsWith('blob:'))).toBeTrue();
      expect(toasts()).toEqual([]);
    });

    it('covers what is on screen: the period chosen, and no archived cases when the box is unchecked', async () => {
      await open();
      pick('Desde', '2026-01-01');
      read().flush(DATA);
      pick('Hasta', '2026-06-30');
      read().flush(DATA);
      archivedBox().click();
      fixture.detectChanges();
      read().flush(DATA);
      await show();

      button('PDF').click();
      fixture.detectChanges();
      const request = download('pdf');
      expect(request.request.params.get('from')).toBe('2026-01-01');
      expect(request.request.params.get('to')).toBe('2026-06-30');
      expect(request.request.params.get('archived')).toBe('exclude');
      request.flush(new Blob(['pdf']));
      await nextTask();
    });

    it('keeps both buttons waiting while a file is generated, and the one pressed says so', async () => {
      await open();
      button('Excel').click();
      fixture.detectChanges();

      const generating = button('Generando…');
      expect(generating.disabled).toBeTrue();
      expect(generating.querySelector('app-icon[data-icon=loading]')).not.toBeNull();
      expect(button('PDF').disabled).toBeTrue();
      // Pressed meanwhile, neither asks for another file.
      generating.click();
      button('PDF').click();

      download('xlsx').flush(new Blob(['xlsx']));
      await nextTask();
      fixture.detectChanges();
      expect(button('Excel').disabled).toBeFalse();
      expect(button('PDF').disabled).toBeFalse();
      expect(saved.length).toBe(1);
    });

    it('says why when the server refuses it, saves nothing and can be asked for again', async () => {
      const refusal = 'El reporte en Excel admite hasta 20000 casos y el periodo elegido tiene 20001. Acota el periodo con las fechas "Desde" y "Hasta" y descarga el reporte por partes.';
      await open();
      button('Excel').click();
      fixture.detectChanges();
      download('xlsx').flush(new Blob([JSON.stringify({ message: refusal })], { type: 'application/json' }), { status: 400, statusText: 'Bad Request' });
      // The error body arrives as a file and is read back before the message is shown: that takes more than one turn.
      for (let turn = 0; turn < 50 && !toasts().length; turn++) await nextTask();
      fixture.detectChanges();

      expect(toasts()).toEqual([refusal]);
      expect(saved).toEqual([]);
      expect(button('Excel').disabled).toBeFalse();
      expect(button('PDF').disabled).toBeFalse();
    });
  });
});
