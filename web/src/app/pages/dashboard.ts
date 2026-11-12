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
import { PRIORITY_LABEL, formatMinutes, todayIso } from '../core/ui';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

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
  protected readonly data = signal<Dashboard | null>(null);

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

  constructor() {
    // Reloads when the period changes and when cases change, here or elsewhere (see TicketEvents).
    effect(() => {
      const from = this.from();
      const to = this.to();
      untracked(() => void this.load(from, to));
    });
    inject(TicketEvents)
      .events.pipe(takeUntilDestroyed())
      .subscribe(() => void this.load(this.from(), this.to()));
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

  private async load(from: string, to: string): Promise<void> {
    try {
      this.data.set(await this.api.dashboard(from, to));
    } catch (error) {
      this.toast.error(error);
    }
  }
}
