import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import type { ChartConfiguration } from 'chart.js';
import { Api } from '../core/api';
import type { Dashboard } from '../core/api';
import { ChartView } from '../core/chart-view';
import { Theme } from '../core/theme';
import { TicketEvents } from '../core/ticket-events';
import { Toast } from '../core/toast';
import { PRIORITY_LABEL, downloadBlob, formatMinutes, todayIso } from '../core/ui';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Rows a horizontal chart fits in the height the charts have. With more, "Casos por tipo de soporte" grows. */
const ROWS_THAT_FIT = 12;

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
      scales: { x: { stacked, ticks: { precision: 0 } }, y: { stacked, grid: { display: false } } },
    },
  };
}

@Component({
  selector: 'app-dashboard',
  imports: [FormsModule, ChartView],
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
        <input class="input w-auto" type="date" aria-label="Desde" title="Desde" [ngModel]="from()" (ngModelChange)="setRange($event, to())" />
        <input class="input w-auto" type="date" aria-label="Hasta" title="Hasta" [ngModel]="to()" (ngModelChange)="setRange(from(), $event)" />
        <label class="flex cursor-pointer items-center gap-1.5 py-1 text-xs" title="Cuenta también los casos archivados. Sin marcar, solo los que siguen en las listas">
          <input type="checkbox" class="accent-primary" [(ngModel)]="includeArchived" />
          Incluir archivados
        </label>
        <!-- The report of what is on screen: the same period, with the archived cases or without them. -->
        <div class="flex gap-2" role="group" aria-label="Descargar el reporte">
          <button type="button" class="btn btn-soft" [disabled]="exporting() !== null" (click)="export('xlsx')" title="Reporte en Excel, con una hoja de datos para tablas dinámicas o Power BI">
            <i class="mdi text-base" [class]="exporting() === 'xlsx' ? 'mdi-loading mdi-spin' : 'mdi-file-excel-outline text-success'" aria-hidden="true"></i>
            {{ exporting() === 'xlsx' ? 'Generando…' : 'Excel' }}
          </button>
          <button type="button" class="btn btn-soft" [disabled]="exporting() !== null" (click)="export('pdf')" title="Reporte en PDF, para leer o imprimir">
            <i class="mdi text-base" [class]="exporting() === 'pdf' ? 'mdi-loading mdi-spin' : 'mdi-file-pdf-box text-danger'" aria-hidden="true"></i>
            {{ exporting() === 'pdf' ? 'Generando…' : 'PDF' }}
          </button>
        </div>
      </div>

      @if (data(); as d) {
        <div class="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
          @for (kpi of kpis(); track kpi.label) {
            <div class="card p-3">
              <div class="flex items-center gap-1.5 text-xs text-muted">
                <i class="mdi text-base leading-none" [class]="kpi.icon + ' ' + kpi.color" aria-hidden="true"></i>
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
          <div class="grid gap-3 lg:grid-cols-2">
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Casos por mes</h2>
              <app-chart class="h-64" [config]="monthlyChart()" label="Casos por mes, resueltos y abiertos" />
            </section>
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Casos por responsable</h2>
              <app-chart class="h-64" [config]="assigneeChart()" label="Casos por responsable y estado" />
            </section>
            <section class="card p-4">
              <h2 class="mb-2 font-semibold">Empresas con más casos</h2>
              <app-chart class="h-64" [config]="companyChart()" label="Las diez empresas con más casos" />
            </section>
            @if (d.byModule.length) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por módulo</h2>
                <app-chart class="h-64" [config]="moduleChart()" label="Casos por módulo" />
              </section>
            }
            @if (hasPriorities()) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por prioridad</h2>
                <app-chart class="h-64" [config]="priorityChart()" label="Casos por prioridad" />
              </section>
            }
            @if (hasSupportTypes()) {
              <section class="card p-4">
                <h2 class="mb-2 font-semibold">Casos por tipo de soporte</h2>
                <app-chart [style.height.rem]="supportTypeHeight()" [config]="supportTypeChart()" label="Casos por tipo de soporte" />
                <p class="mt-2 text-2xs text-muted">Un caso con varios tipos cuenta en cada uno.</p>
              </section>
            }
          </div>
        }
      } @else {
        <p class="p-10 text-center text-muted">Cargando…</p>
      }
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
  /** What the screen is about: the cases of the period, with the archived ones or without them. Its report covers the same. */
  private readonly selection = computed(() => ({ from: this.from(), to: this.to(), includeArchived: this.includeArchived() }));
  protected readonly data = signal<Dashboard | null>(null);
  /** The file of the report being generated. Both buttons wait for it. */
  protected readonly exporting = signal<'xlsx' | 'pdf' | null>(null);
  private loadSequence = 0;

  protected readonly kpis = computed(() => {
    const d = this.data();
    if (!d) return [];
    const t = d.totals;
    return [
      { label: 'Total', value: String(t.total), hint: '', icon: 'mdi-format-list-bulleted', color: 'text-primary' },
      { label: 'Sin resolver', value: String(t.unresolved), hint: '', icon: 'mdi-alert-circle-outline', color: 'text-danger' },
      { label: 'Pendientes', value: String(t.pending), hint: '', icon: 'mdi-progress-clock', color: 'text-warning' },
      { label: 'Resueltos', value: String(t.resolved), hint: t.total ? `${Math.round((t.resolved / t.total) * 100)}% del total` : '', icon: 'mdi-check-circle-outline', color: 'text-success' },
      { label: 'Vencidos', value: String(t.overdue), hint: 'abiertos fuera de plazo', icon: 'mdi-clock-alert-outline', color: 'text-danger' },
      {
        label: 'Tiempo de resolución',
        value: d.avgResolutionHours === null ? '—' : d.avgResolutionHours >= 48 ? `${Math.round(d.avgResolutionHours / 24)} d` : `${d.avgResolutionHours} h`,
        hint: 'promedio, casos resueltos en la app',
        icon: 'mdi-timer-sand',
        color: 'text-primary',
      },
      { label: 'Cumplimiento SLA', value: d.slaCompliance === null ? '—' : `${d.slaCompliance}%`, hint: 'casos con prioridad', icon: 'mdi-shield-check-outline', color: 'text-success' },
      {
        label: 'Estimado vs real',
        value: d.estimatedMinutes ? `${Math.round((d.spentMinutes / d.estimatedMinutes) * 100)}%` : '—',
        hint: d.estimatedMinutes ? `${formatMinutes(d.spentMinutes)} de ${formatMinutes(d.estimatedMinutes)}` : 'sin estimaciones',
        icon: 'mdi-scale-balance',
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
          { label: 'Resueltos', data: monthly.map((m) => m.resolved), backgroundColor: color.success, borderRadius: 4, maxBarThickness: 56 },
          { label: 'Abiertos', data: monthly.map((m) => m.open), backgroundColor: color.warning, borderRadius: 4, maxBarThickness: 56 },
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
        { label: 'Resueltos', data: rows.map((r) => r.resolved), backgroundColor: color.success, borderRadius: 4 },
        { label: 'Pendientes', data: rows.map((r) => r.pending), backgroundColor: color.warning, borderRadius: 4 },
        { label: 'Sin resolver', data: rows.map((r) => r.unresolved), backgroundColor: color.danger, borderRadius: 4 },
      ],
      true,
    );
  });

  protected readonly companyChart = computed<ChartConfiguration>(() => {
    const rows = this.data()?.byCompany ?? [];
    return horizontalBars(rows.map((r) => r.name), [{ label: 'Casos', data: rows.map((r) => r.total), backgroundColor: this.theme.palette().primary, borderRadius: 4 }], false);
  });

  protected readonly moduleChart = computed<ChartConfiguration>(() => {
    const rows = this.data()?.byModule ?? [];
    return horizontalBars(rows.map((r) => r.name), [{ label: 'Casos', data: rows.map((r) => r.total), backgroundColor: this.theme.palette().primary, borderRadius: 4 }], false);
  });

  protected readonly hasPriorities = computed(() => (this.data()?.byPriority ?? []).some((p) => p.priority !== null));

  protected readonly priorityChart = computed<ChartConfiguration>(() => {
    const rows = this.data()?.byPriority ?? [];
    const color = this.theme.palette();
    const byPriority = { CRITICAL: color.danger, HIGH: color.warning, MEDIUM: color.primary, LOW: color.success };
    return {
      type: 'doughnut',
      data: {
        labels: rows.map((r) => (r.priority ? PRIORITY_LABEL[r.priority] : 'Sin prioridad')),
        datasets: [{ data: rows.map((r) => r.total), backgroundColor: rows.map((r) => (r.priority ? byPriority[r.priority] : color.neutral)), borderWidth: 0 }],
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
   * Height of that chart, in rem: the one of the others, and more with more types than fit in
   * it. Every type is drawn, and a chart that is too low leaves the names of some rows out.
   */
  protected readonly supportTypeHeight = computed(() => 16 + Math.max(0, (this.data()?.bySupportType.length ?? 0) - ROWS_THAT_FIT) * 1.25);

  constructor() {
    // Reloads when the period or the choice about archived cases changes, and when cases change,
    // here or elsewhere (see TicketEvents).
    effect(() => {
      const selection = this.selection();
      untracked(() => void this.load(selection));
    });
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe(() => void this.load());
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

  private async load({ from, to, includeArchived } = this.selection()): Promise<void> {
    // Only the answer to the latest request is shown: an older one, for another period or with
    // the archived cases the person has just left out, can arrive after it.
    const sequence = ++this.loadSequence;
    try {
      const data = await this.api.dashboard(from, to, includeArchived);
      if (sequence === this.loadSequence) this.data.set(data);
    } catch (error) {
      this.toast.error(error);
    }
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
