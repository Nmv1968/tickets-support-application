import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { Chart } from 'chart.js';
import type { CartesianScaleOptions, FontSpec } from 'chart.js';
import { toFont } from 'chart.js/helpers';
import { Announcer } from '../core/announcer';
import type { Dashboard } from '../core/api';
import { STATUS_DELAY_MS } from '../core/status';
import { Theme } from '../core/theme';
import { TicketEvents } from '../core/ticket-events';
import { todayIso } from '../core/ui';
import { httpTestBed } from '../testing/http';
import { buttonIn, isDisabled, nextTask, said, toasts } from '../testing/screen';
import { resizeScreen } from '../testing/viewport';
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
    http = httpTestBed();
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

  // Which date was "Desde" and which "Hasta" was only in their titles, and what each report holds only in the titles of its buttons.
  it('writes the word of each date of the period beside it, and what each report holds behind a "?"', async () => {
    await open();
    for (const field of ['Desde', 'Hasta']) {
      const input = el.querySelector<HTMLInputElement>(`input[aria-label="${field}"]`)!;
      expect(input.labels?.length).toBe(1);
      expect(input.labels![0].textContent?.trim()).toBe(field);
    }
    const group = el.querySelector<HTMLElement>('[role=group][aria-label="Descargar el reporte"]')!;
    const help = group.querySelector<HTMLButtonElement>('button[aria-label="Ayuda sobre Descargar el reporte"]')!;
    const text = el.querySelector<HTMLElement>(`#${group.getAttribute('aria-describedby')}`)!;
    expect(help.getAttribute('aria-describedby')).toBe(text.id);
    expect(text.textContent?.trim()).toBe('Excel: el reporte con una hoja de datos para tablas dinámicas o Power BI. PDF: el reporte para leer o imprimir.');
  });

  describe('"Casos por prioridad"', () => {
    /** The colour of each slice of the chart on screen. */
    const slices = (): unknown => chart('Casos por prioridad')?.data.datasets[0].backgroundColor;

    // It was drawn in the grey of the secondary text, which is dark slate in the light theme: the
    // slice that says the least stood out the most. The light grey that took its place was 2.8:1
    // against the card: now a grey of the charts, softer than any slice and 3:1 against the card.
    it('draws the slice of the cases without priority in the neutral grey of the charts, in each theme', async () => {
      await open();
      expect(theme.palette().muted).toBe('#5b6472');
      expect(slices()).toEqual(['#b7791f', '#868b95']);

      theme.toggle();
      fixture.detectChanges();
      expect(theme.palette().muted).toBe('#9b9b9f');
      expect(slices()).toEqual(['#f7c260', '#747479']);
    });

    // The slices touched: told apart by their colours alone.
    it('separates the slices with a line in the colour of the card', async () => {
      await open();
      const dataset = chart('Casos por prioridad')?.data.datasets[0];
      expect(dataset?.borderColor).toBe('#ffffff');
      expect(dataset?.borderWidth).toBe(2);
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
      expect(types()?.data.datasets[0].backgroundColor).toEqual(['#b91c1c', '#12b76a', '#868b95']);
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
      expect(types()?.data.datasets[0].backgroundColor).toEqual(['#b91c1c', '#12b76a', '#747479']);
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

    // What the box counts was only in the title of its label.
    it('says what the box counts with its "?", which the box is described by', async () => {
      create();
      read().flush(DATA);
      await show();
      const help = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Ayuda sobre Incluir archivados"]')!;
      const text = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`#${help.getAttribute('aria-describedby')}`)!;

      expect(text.textContent?.trim()).toBe('Cuenta también los casos archivados. Sin marcar, solo los que siguen en las listas');
      expect(archivedBox().getAttribute('aria-describedby')).toBe(text.id);
      help.click();
      await show();
      expect(text.hidden).toBeFalse();
      help.click();
      await show();
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
      expect(isDisabled(generating)).toBeTrue();
      expect(generating.querySelector('app-icon[data-icon=loading]')).not.toBeNull();
      expect(isDisabled(button('PDF'))).toBeTrue();
      // Pressed meanwhile, neither asks for another file.
      generating.click();
      button('PDF').click();

      download('xlsx').flush(new Blob(['xlsx']));
      await nextTask();
      fixture.detectChanges();
      expect(isDisabled(button('Excel'))).toBeFalse();
      expect(isDisabled(button('PDF'))).toBeFalse();
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
      expect(isDisabled(button('Excel'))).toBeFalse();
      expect(isDisabled(button('PDF'))).toBeFalse();
    });

    // The pressed button disabled itself, and the browser put the focus nowhere.
    it('keeps the focus on the button pressed while the file is generated, and after', async () => {
      await open();
      button('Excel').focus();
      button('Excel').click();
      fixture.detectChanges();

      expect(document.activeElement).toBe(button('Generando…'));
      download('xlsx').flush(new Blob(['xlsx']));
      await nextTask();
      fixture.detectChanges();
      expect(document.activeElement).toBe(button('Excel'));
    });
  });

  // "Desde" after "Hasta" said "No hay casos en este periodo.", with nothing about the dates.
  describe('a period that ends before it starts', () => {
    const until = (): HTMLInputElement => el.querySelector<HTMLInputElement>('input[aria-label="Hasta"]')!;

    it('is said under "Hasta", tied to it, and the numbers of the period before stay', async () => {
      await open();
      pick('Desde', '2026-06-01');
      read().flush(DATA);
      await show();
      pick('Hasta', '2026-01-31');
      await show();

      expect(until().getAttribute('aria-invalid')).toBe('true');
      const message = el.querySelector(`#${until().getAttribute('aria-describedby')}`)!;
      expect(message.textContent).toContain('La fecha final es anterior a la inicial.');
      // Said at once as it comes: it was an alert that came with its words, which a screen reader may not read.
      expect(message.closest('[role=alert], [role=status], [aria-live]')).toBeNull();
      const words = 'La fecha final es anterior a la inicial. Se siguen mostrando los números del periodo anterior.';
      expect(said()).toEqual([words]);
      expect(TestBed.inject(Announcer).said()[0].politeness).toBe('assertive');
      // Nothing is asked for it (http.verify after each test), and the numbers on screen stay.
      expect(el.textContent).not.toContain('No hay casos en este periodo.');
      expect(indicator('Total')).toBe('5');

      pick('Hasta', '2026-06-30');
      expect(until().hasAttribute('aria-invalid')).toBeFalse();
      expect(said()).toEqual([]);
      const asked = read();
      expect(asked.request.params.get('from')).toBe('2026-06-01');
      expect(asked.request.params.get('to')).toBe('2026-06-30');
      asked.flush(DATA);
      await show();
    });
  });

  // Nothing told a screen reader that the numbers were on their way. Then "Cargando…" came with its
  // status, which a screen reader may not read, and "Actualizando…" was said for every case anyone saved.
  it('says it is reading the numbers where a screen reader hears it, the first time and with each period, and not for a change someone else made', async () => {
    create();
    const statuses = (): string[] => Array.from(el.querySelectorAll('app-status'), (status) => (status.textContent ?? '').trim());
    // On screen before what they say: "Cargando…" comes into a status already there.
    expect(statuses()).toEqual(['', '']);
    await new Promise((resolve) => setTimeout(resolve, STATUS_DELAY_MS));
    fixture.detectChanges();
    expect(statuses()).toEqual(['', 'Cargando…']);
    read().flush(DATA);
    await show();
    expect(statuses()).toEqual(['', '']);

    pick('Desde', '2026-01-01');
    expect(statuses()).toEqual(['Actualizando los números…', '']);
    read().flush(DATA);
    await show();
    expect(statuses()).toEqual(['', '']);

    TestBed.inject(TicketEvents).outdated(null);
    fixture.detectChanges();
    expect(statuses()).toEqual(['', '']);
    read().flush(DATA);
    await show();
    expect(statuses()).toEqual(['', '']);
  });

  // Drawn for real on a screen of the size of each test.
  describe('on the screen', () => {
    /** Names as long as the catalogs of the team have them; twelve responsibles, ten companies. */
    const LONG: Dashboard = {
      ...DATA,
      byAssignee: Array.from({ length: 12 }, (_, index) => ({ name: `Responsable ${index + 1} de la Mesa de Ayuda`, unresolved: 1, pending: 1, resolved: index, total: index + 2 })),
      byCompany: Array.from({ length: 10 }, (_, index) => ({ name: `Laboratorios Farmacéuticos Número ${index + 1} de la Sierra y la Amazonía Cía. Ltda.`, total: 10 - index })),
      byModule: [{ name: 'Contabilidad general > Cierre de periodo', total: 4 }],
    };

    /** What the axis of the rows of a chart writes, as it is drawn: none of the rows left out. */
    const rowNames = (label: string): string[] => chart(label)!.scales['y'].ticks.map((tick) => String(tick.label));

    // At 320 px the cards were 334 px wide, and the page scrolled sideways.
    it('on a small phone keeps every chart inside the screen', async () => {
      resizeScreen(320, 568);
      await open(LONG);

      const cards = Array.from(el.querySelectorAll<HTMLElement>('section.card'));
      expect(cards.length).toBeGreaterThan(3);
      for (const card of cards) {
        expect(card.getBoundingClientRect().right).withContext(card.textContent ?? '').toBeLessThanOrEqual(320 - 12);
        expect(card.querySelector('canvas')!.getBoundingClientRect().right).toBeLessThanOrEqual(card.getBoundingClientRect().right);
      }
    });

    // On a phone "Casos por responsable" named 6 of its 12 rows, and the names of the companies
    // lost their start, the part that tells them apart, at every width.
    for (const [width, height] of [
      [390, 844],
      [1920, 1080],
    ]) {
      it(`at ${width} px names every row of its lying bars, each from its start`, async () => {
        resizeScreen(width, height);
        await open(LONG);

        expect(rowNames('Casos por responsable y estado').length).toBe(12);
        const companies = rowNames('Las diez empresas con más casos');
        expect(companies.length).toBe(10);
        for (const [index, name] of companies.entries()) {
          const whole = LONG.byCompany[index].name;
          expect(whole.startsWith(name.replace(/…$/, ''))).withContext(name).toBeTrue();
          expect(name === whole || name.endsWith('…')).withContext(name).toBeTrue();
        }
        // Each name fits the axis that writes it: Chart.js cut what did not, from the start.
        const drawn = chart('Las diez empresas con más casos')!;
        const scale = drawn.scales['y'];
        drawn.ctx.font = toFont((scale.options as CartesianScaleOptions).ticks.font as Partial<FontSpec>).string;
        for (const name of companies) expect(drawn.ctx.measureText(name).width).withContext(name).toBeLessThanOrEqual(scale.width);
      });
    }
  });
});
