import { ChangeDetectionStrategy, Component, computed, inject, linkedSignal, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type { ChartConfiguration, Scale } from 'chart.js';
import { Say } from '../core/announcer';
import { Api } from '../core/api';
import { ChartView } from '../core/chart-view';
import { Hint } from '../core/hint';
import { Icon } from '../core/icon';
import type { IconName } from '../core/icons';
import { liveResource } from '../core/loading';
import { SoftDisabled } from '../core/soft-disabled';
import { Status } from '../core/status';
import { Theme } from '../core/theme';
import { TicketEvents } from '../core/ticket-events';
import { Toast } from '../core/toast';
import { PRIORITY_LABEL, downloadBlob, formatMinutes, todayIso } from '../core/ui';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** A number at the top of the dashboard, with what it counts. */
interface Kpi {
  label: string;
  value: string;
  hint: string;
  icon: IconName;
  color: string;
}

/** The period and the cases the screen is about. */
interface Selection {
  from: string;
  to: string;
  includeArchived: boolean;
}

/** "Desde" after "Hasta": a period with no day in it. */
function reversed(from: string, to: string): boolean {
  return !!from && !!to && from > to;
}

/**
 * The pieces of a stacked bar or of a doughnut, each drawn with a line of the colour of the card
 * around it: two pieces side by side are told apart by that line, and not by their colours alone.
 */
function separated(surface: string, width = 1): { borderColor: string; borderWidth: number; borderSkipped: false } {
  return { borderColor: surface, borderWidth: width, borderSkipped: false };
}

/** Height of a chart, in rem: the class `h-64` of the ones that do not grow. */
const CHART_HEIGHT = 16;

/** About the width of a letter of the names on the axis of a chart, in px. */
const LABEL_LETTER_PX = 7;

/**
 * Height in rem of a chart of lying bars with this many rows: the one of the others, and more
 * with more rows than fit in it. Each row keeps some 1.25rem besides the axis and the legend, and
 * with them its name: in a chart too low, Chart.js leaves the names of some rows out (every
 * other one, on a phone).
 */
function barsHeight(rows: number): number {
  return Math.max(CHART_HEIGHT, 4 + rows * 1.25);
}

/**
 * The name of a row as its axis writes it: whole while it fits in two fifths of the chart, and
 * shortened with an ellipsis past that. Chart.js gives the axis half the chart at most, and cut
 * what did not fit from the start of the name, the part that tells two names apart. The whole
 * name is in the tooltip of the bar.
 */
function rowName(this: Scale, value: number | string): string {
  const name = this.getLabelForValue(Number(value));
  const letters = Math.max(8, Math.floor((this.chart.width * 0.4) / LABEL_LETTER_PX));
  return name.length > letters ? `${name.slice(0, letters - 1).trimEnd()}…` : name;
}

/** "2023-07" → "jul 23" */
function monthLabel(month: string): string {
  const [year, number] = month.split('-');
  return `${MONTHS[Number(number) - 1]} ${year.slice(2)}`;
}

function horizontalBars(labels: string[], datasets: ChartConfiguration<'bar'>['data']['datasets'], stacked: boolean): ChartConfiguration {
  return {
    type: 'bar',
    // Capped thickness: a chart with one or two rows should not become a solid block.
    data: { labels, datasets: datasets.map((dataset) => ({ ...dataset, maxBarThickness: 26 })) },
    options: {
      indexAxis: 'y',
      plugins: { legend: { display: datasets.length > 1, position: 'bottom' } },
      // Every row named: the chart is as high as its rows need (see barsHeight).
      scales: { x: { stacked, ticks: { precision: 0 } }, y: { stacked, grid: { display: false }, ticks: { autoSkip: false, callback: rowName } } },
    },
  };
}

/** One bar per row with its number of cases, all in `color`: the cases by company, by module. */
function caseBars(rows: readonly { name: string; total: number }[], color: string): ChartConfiguration {
  return horizontalBars(rows.map((r) => r.name), [{ label: 'Casos', data: rows.map((r) => r.total), backgroundColor: color, borderRadius: 4 }], false);
}

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, ChartView, Hint, Icon, Say, SoftDisabled, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4 p-3 md:p-5">
      <div class="flex flex-wrap items-center gap-2">
        <h1 class="mr-auto text-lg font-semibold">Dashboard</h1>
        <div class="flex rounded-control bg-elevated p-0.5" role="group" aria-label="Periodo">
          <button type="button" class="segment" [attr.aria-pressed]="preset() === 'all'" (click)="applyPreset('all')">Todo</button>
          <button type="button" class="segment" [attr.aria-pressed]="preset() === 'year'" (click)="applyPreset('year')">Este año</button>
          <button type="button" class="segment" [attr.aria-pressed]="preset() === 'month'" (click)="applyPreset('month')">Este mes</button>
        </div>
        <!-- Each field with its word in sight: it was only in a title, and two dates side by side did not say which was which. -->
        <label class="flex items-center gap-1.5 text-xs text-muted">
          Desde
          <input class="input w-auto" type="date" aria-label="Desde" title="Desde" [ngModel]="from()" (ngModelChange)="setRange($event, to())" />
        </label>
        <label class="flex items-center gap-1.5 text-xs text-muted">
          Hasta
          <input
            class="input w-auto aria-[invalid=true]:border-danger"
            type="date"
            aria-label="Hasta"
            title="Hasta"
            [ngModel]="to()"
            (ngModelChange)="setRange(from(), $event)"
            [attr.aria-invalid]="rangeReversed() ? 'true' : null"
            [attr.aria-describedby]="rangeReversed() ? 'dashboard-range-error' : null"
          />
        </label>
        <!-- What it counts is behind its "?", and is the description of the checkbox too (see Hint). -->
        <span class="flex items-center gap-0.5">
          <label class="flex cursor-pointer items-center gap-1.5 py-1 text-xs" title="Cuenta también los casos archivados. Sin marcar, solo los que siguen en las listas">
            <input type="checkbox" class="accent-primary" aria-describedby="dashboard-archived-hint" [(ngModel)]="includeArchived" />
            Incluir archivados
          </label>
          <app-hint class="text-xs text-muted" textId="dashboard-archived-hint" about="Incluir archivados" text="Cuenta también los casos archivados. Sin marcar, solo los que siguen en las listas" />
        </span>
        <!--
          The report of what is on screen: the same period, with the archived cases or without them. What each
          format holds is behind the "?" (see Hint): it was only in the titles of the buttons.
        -->
        <div class="flex items-center gap-2" role="group" aria-label="Descargar el reporte" aria-describedby="dashboard-report-hint">
          <button type="button" class="btn btn-soft" [appSoftDisabled]="exporting() !== null" (click)="export('xlsx')" title="Reporte en Excel, con una hoja de datos para tablas dinámicas o Power BI">
            <app-icon [name]="exporting() === 'xlsx' ? 'loading' : 'file-excel-outline'" class="text-base" [class.text-success]="exporting() !== 'xlsx'" />
            {{ exporting() === 'xlsx' ? 'Generando…' : 'Excel' }}
          </button>
          <button type="button" class="btn btn-soft" [appSoftDisabled]="exporting() !== null" (click)="export('pdf')" title="Reporte en PDF, para leer o imprimir">
            <app-icon [name]="exporting() === 'pdf' ? 'loading' : 'file-pdf-box'" class="text-base" [class.text-danger]="exporting() !== 'pdf'" />
            {{ exporting() === 'pdf' ? 'Generando…' : 'PDF' }}
          </button>
          <app-hint
            class="-ml-1 text-xs text-muted"
            textId="dashboard-report-hint"
            about="Descargar el reporte"
            text="Excel: el reporte con una hoja de datos para tablas dinámicas o Power BI. PDF: el reporte para leer o imprimir."
          />
        </div>
        @if (rangeReversed()) {
          <!-- On a line of its own, under the period. Said at once as it comes (see Say), as an error. -->
          <p class="field-error mt-0 basis-full" id="dashboard-range-error" appSay sayAs="assertive">
            <app-icon name="alert-circle-outline" class="text-danger" /> La fecha final es anterior a la inicial. Se siguen mostrando los números del periodo anterior.
          </p>
        }
      </div>

      <!--
        Said to a screen reader while the numbers of another period are read: the ones on screen stay until they come. Not when
        they are read again for a change someone else made: that is done in silence.
      -->
      <app-status class="sr-only">{{ data() && asked() ? 'Actualizando los números…' : '' }}</app-status>

      @if (data(); as d) {
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          @for (kpi of kpis(); track kpi.label) {
            <div class="card p-3">
              <div class="flex items-center gap-1.5 text-xs text-muted">
                <app-icon [name]="kpi.icon" class="text-base leading-none" [class]="kpi.color" />
                {{ kpi.label }}
              </div>
              <div class="mt-1 text-2xl font-semibold">{{ kpi.value }}</div>
              @if (kpi.hint) {
                <div class="text-2xs text-muted">{{ kpi.hint }}</div>
              }
            </div>
          }
        </div>

        @if (d.totals.total === 0) {
          <p class="card p-10 text-center text-muted">No hay casos en este periodo.</p>
        } @else {
          <!-- One column of the width of the screen, never of the canvas in it (grid-cols-1): on a small phone it was wider than the screen. -->
          <div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Casos por mes</h2>
              <app-chart class="h-64" [config]="monthlyChart()" label="Casos por mes, resueltos y abiertos" category="Mes" />
            </section>
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Casos por responsable</h2>
              <app-chart [style.height.rem]="assigneeHeight()" [config]="assigneeChart()" label="Casos por responsable y estado" category="Responsable" />
            </section>
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Empresas con más casos</h2>
              <app-chart [style.height.rem]="companyHeight()" [config]="companyChart()" label="Las diez empresas con más casos" category="Empresa" />
            </section>
            @if (d.byModule.length) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por módulo</h2>
                <app-chart [style.height.rem]="moduleHeight()" [config]="moduleChart()" label="Casos por módulo" category="Módulo" />
              </section>
            }
            @if (hasPriorities()) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por prioridad</h2>
                <app-chart class="h-64" [config]="priorityChart()" label="Casos por prioridad" category="Prioridad" />
              </section>
            }
            @if (hasSupportTypes()) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por tipo de soporte</h2>
                <app-chart [style.height.rem]="supportTypeHeight()" [config]="supportTypeChart()" label="Casos por tipo de soporte" category="Tipo de soporte" />
                <p class="mt-2 text-2xs text-muted">Un caso con varios tipos cuenta en cada uno.</p>
              </section>
            }
          </div>
        }
      }
      <app-status class="block">
        @if (!data()) {
          <p class="p-10 text-center text-muted">Cargando…</p>
        }
      </app-status>
    </div>
  `,
})
export class DashboardPage {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  /** The charts take their colours from the theme, and are drawn again when it switches. */
  private readonly theme = inject(Theme);

  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly preset = signal<'all' | 'year' | 'month' | ''>('all');
  /** Archived cases count: the numbers are about the work done. Unchecked, only the cases still in the lists. */
  protected readonly includeArchived = signal(true);
  /** "Desde" is after "Hasta": said under "Hasta", and nothing is asked for that period. */
  protected readonly rangeReversed = computed(() => reversed(this.from(), this.to()));
  /**
   * What the screen is about: the cases of the period, with the archived ones or without them. Its
   * report covers the same. While "Desde" is after "Hasta", the last period that had days in it:
   * the screen does not say "No hay casos en este periodo" of one that is a mistake.
   */
  private readonly selection = linkedSignal<Selection, Selection>({
    source: () => ({ from: this.from(), to: this.to(), includeArchived: this.includeArchived() }),
    computation: (next, previous) => (reversed(next.from, next.to) && previous ? previous.value : next),
  });
  /**
   * The numbers of the selection, read again when it changes, and in silence when cases change
   * here or elsewhere (see liveResource and the constructor).
   */
  private readonly numbers = liveResource({
    params: this.selection,
    load: ({ from, to, includeArchived }, abort) => this.api.dashboard(from, to, includeArchived, abort),
    failed: (error) => this.toast.error(error),
  });
  protected readonly data = this.numbers.value.asReadonly();
  protected readonly asked = this.numbers.asked;
  /** The file of the report being generated. Both buttons wait for it. */
  protected readonly exporting = signal<'xlsx' | 'pdf' | null>(null);

  protected readonly kpis = computed((): Kpi[] => {
    const d = this.data();
    if (!d) return [];
    const t = d.totals;
    return [
      { label: 'Total', value: String(t.total), hint: '', icon: 'format-list-bulleted', color: 'text-primary' },
      { label: 'Sin resolver', value: String(t.unresolved), hint: '', icon: 'alert-circle-outline', color: 'text-danger' },
      { label: 'Pendientes', value: String(t.pending), hint: '', icon: 'progress-clock', color: 'text-warning' },
      { label: 'Resueltos', value: String(t.resolved), hint: t.total ? `${Math.round((t.resolved / t.total) * 100)}% del total` : '', icon: 'check-circle-outline', color: 'text-success' },
      { label: 'Vencidos', value: String(t.overdue), hint: 'abiertos fuera de plazo', icon: 'clock-alert-outline', color: 'text-danger' },
      {
        label: 'Tiempo de resolución',
        value: d.avgResolutionHours === null ? '—' : d.avgResolutionHours >= 48 ? `${Math.round(d.avgResolutionHours / 24)} d` : `${d.avgResolutionHours} h`,
        hint: 'promedio, casos resueltos en la app',
        icon: 'timer-sand',
        color: 'text-primary',
      },
      { label: 'Cumplimiento SLA', value: d.slaCompliance === null ? '—' : `${d.slaCompliance}%`, hint: 'casos con prioridad', icon: 'shield-check-outline', color: 'text-success' },
      {
        label: 'Estimado vs real',
        value: d.estimatedMinutes ? `${Math.round((d.spentMinutes / d.estimatedMinutes) * 100)}%` : '—',
        hint: d.estimatedMinutes ? `${formatMinutes(d.spentMinutes)} de ${formatMinutes(d.estimatedMinutes)}` : 'sin estimaciones',
        icon: 'scale-balance',
        color: 'text-primary',
      },
    ];
  });

  protected readonly monthlyChart = computed<ChartConfiguration>(() => {
    const monthly = this.data()?.monthly ?? [];
    const color = this.theme.palette();
    return {
      type: 'bar',
      data: {
        labels: monthly.map((m) => monthLabel(m.month)),
        datasets: [
          { label: 'Resueltos', data: monthly.map((m) => m.resolved), backgroundColor: color.resolved, ...separated(color.surface), borderRadius: 4, maxBarThickness: 56 },
          { label: 'Abiertos', data: monthly.map((m) => m.open), backgroundColor: color.pending, ...separated(color.surface), borderRadius: 4, maxBarThickness: 56 },
        ],
      },
      options: {
        plugins: { legend: { position: 'bottom' } },
        scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { precision: 0 } } },
      },
    };
  });

  protected readonly assigneeChart = computed<ChartConfiguration>(() => {
    const rows = (this.data()?.byAssignee ?? []).slice(0, 12);
    const color = this.theme.palette();
    return horizontalBars(
      rows.map((r) => r.name),
      [
        { label: 'Resueltos', data: rows.map((r) => r.resolved), backgroundColor: color.resolved, ...separated(color.surface), borderRadius: 4 },
        { label: 'Pendientes', data: rows.map((r) => r.pending), backgroundColor: color.pending, ...separated(color.surface), borderRadius: 4 },
        { label: 'Sin resolver', data: rows.map((r) => r.unresolved), backgroundColor: color.unresolved, ...separated(color.surface), borderRadius: 4 },
      ],
      true,
    );
  });

  protected readonly companyChart = computed(() => caseBars(this.data()?.byCompany ?? [], this.theme.palette().primary));

  protected readonly moduleChart = computed(() => caseBars(this.data()?.byModule ?? [], this.theme.palette().primary));

  protected readonly hasPriorities = computed(() => (this.data()?.byPriority ?? []).some((p) => p.priority !== null));

  protected readonly priorityChart = computed<ChartConfiguration>(() => {
    const rows = this.data()?.byPriority ?? [];
    const color = this.theme.palette();
    const byPriority = { CRITICAL: color.unresolved, HIGH: color.pending, MEDIUM: color.primary, LOW: color.resolved };
    return {
      type: 'doughnut',
      data: {
        labels: rows.map((r) => (r.priority ? PRIORITY_LABEL[r.priority] : 'Sin prioridad')),
        datasets: [{ data: rows.map((r) => r.total), backgroundColor: rows.map((r) => (r.priority ? byPriority[r.priority] : color.neutral)), ...separated(color.surface, 2) }],
      },
      options: { plugins: { legend: { position: 'right' } } },
    };
  });

  /** The cases without a type come as one more row, with no colour: alone, they say nothing. */
  protected readonly hasSupportTypes = computed(() => (this.data()?.bySupportType ?? []).some((type) => type.color !== null));

  /**
   * Bars and not slices: a case with two types counts in both, so the rows do not add up to the
   * total. Each bar is in the colour the team gave its type, whatever it is: the thin outline
   * keeps in view the bar of a type in the colour of the card it is drawn on.
   */
  protected readonly supportTypeChart = computed<ChartConfiguration>(() => {
    const rows = this.data()?.bySupportType ?? [];
    const color = this.theme.palette();
    return horizontalBars(
      rows.map((r) => r.name),
      [{ label: 'Casos', data: rows.map((r) => r.total), backgroundColor: rows.map((r) => r.color ?? color.neutral), borderColor: color.muted, borderWidth: 1, borderSkipped: false, borderRadius: 4 }],
      false,
    );
  });

  /**
   * Heights of the charts of lying bars, in rem: each grows with its rows (see barsHeight). The
   * types and the modules are the team's catalogs and have no limit; the others show the first
   * rows of a list.
   */
  protected readonly assigneeHeight = computed(() => barsHeight(this.assigneeChart().data.labels?.length ?? 0));
  protected readonly companyHeight = computed(() => barsHeight(this.companyChart().data.labels?.length ?? 0));
  protected readonly moduleHeight = computed(() => barsHeight(this.moduleChart().data.labels?.length ?? 0));
  protected readonly supportTypeHeight = computed(() => barsHeight(this.supportTypeChart().data.labels?.length ?? 0));

  constructor() {
    // Any change to cases, here or elsewhere (see TicketEvents), can change the numbers.
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe(() => this.numbers.reread());
  }

  protected applyPreset(preset: 'all' | 'year' | 'month'): void {
    const today = todayIso();
    this.preset.set(preset);
    this.from.set(preset === 'all' ? '' : preset === 'year' ? `${today.slice(0, 4)}-01-01` : `${today.slice(0, 7)}-01`);
    this.to.set(preset === 'all' ? '' : today);
  }

  protected setRange(from: string, to: string): void {
    this.preset.set('');
    this.from.set(from);
    this.to.set(to);
  }

  /** Downloads the report of what is on screen: the same period, and the same choice about archived cases. */
  protected async export(format: 'xlsx' | 'pdf'): Promise<void> {
    // Also a second press that arrives before the buttons are drawn disabled.
    if (this.exporting()) return;
    const { from, to, includeArchived } = this.selection();
    this.exporting.set(format);
    try {
      downloadBlob(await this.api.dashboardExport(format, from, to, includeArchived), `reporte-soporte-${todayIso()}.${format}`);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.exporting.set(null);
    }
  }
}
