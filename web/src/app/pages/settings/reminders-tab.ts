import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Reminders } from '../../core/reminders';
import { SELECT } from '../../core/select';
import { Toast } from '../../core/toast';

type Unit = 'hours' | 'days';

const UNITS: { id: Unit; label: string }[] = [
  { id: 'hours', label: 'horas' },
  { id: 'days', label: 'días' },
];

/** What the bell reminds the team about, and when: forgotten cases and delivery promises. */
@Component({
  selector: 'app-reminders-tab',
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="grid max-w-4xl gap-4 lg:grid-cols-2">
      <form class="card space-y-4 p-4" (ngSubmit)="saveStale()">
        <div>
          <h2 class="font-semibold">Casos olvidados</h2>
          <p class="text-xs text-muted">
            Un caso abierto (Pendiente o Sin resolver) sin ningún movimiento durante este tiempo aparece en Avisos, en la campana del menú.
          </p>
        </div>

        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" class="sr-only" role="switch" name="enabled" [(ngModel)]="enabled" />
          <span class="toggle" aria-hidden="true"></span>
          Avisar de casos olvidados
        </label>

        <!-- Off, the fields say so themselves (disabled): their labels are not dimmed, which left them unreadable. -->
        <div class="flex items-end gap-2">
          <div>
            <label class="label" for="reminder-amount">Tiempo sin movimiento</label>
            <input id="reminder-amount" class="input w-28" type="number" min="1" name="amount" [disabled]="!enabled()" [(ngModel)]="amount" />
          </div>
          <div>
            <label class="label" for="reminder-unit">Unidad</label>
            <ng-select
              class="w-28"
              labelForId="reminder-unit"
              name="unit"
              bindValue="id"
              bindLabel="label"
              [items]="units"
              [clearable]="false"
              [searchable]="false"
              [disabled]="!enabled()"
              [(ngModel)]="unit"
            />
          </div>
        </div>

        <button type="submit" class="btn btn-primary" [disabled]="loading()">Guardar</button>

        <p class="text-xs text-muted">
          Cuenta como movimiento: una observación nueva, un adjunto o cualquier cambio en el caso (estado, responsable, prioridad…).
          El tiempo corre en horas corridas, incluidos fines de semana. El aviso desaparece solo cuando alguien atiende el caso.
        </p>
      </form>

      <form class="card space-y-4 p-4" (ngSubmit)="savePromise()">
        <div>
          <h2 class="font-semibold">Promesa de entrega</h2>
          <p class="text-xs text-muted">
            Un caso abierto con fecha prometida al cliente aparece en Avisos el día prometido y sigue ahí mientras esté vencido. Eso no se puede apagar.
          </p>
        </div>

        <label class="flex cursor-pointer items-center gap-2">
          <input type="checkbox" class="sr-only" role="switch" name="soonEnabled" [(ngModel)]="soonEnabled" />
          <span class="toggle" aria-hidden="true"></span>
          Avisar también antes de la fecha prometida
        </label>

        <div class="flex items-end gap-2">
          <div>
            <label class="label" for="promise-days">Días de anticipación</label>
            <input id="promise-days" class="input w-28" type="number" min="1" max="60" name="soonDays" [disabled]="!soonEnabled()" [(ngModel)]="soonDays" />
          </div>
          <span class="pb-2 text-xs text-muted">día(s) antes</span>
        </div>

        <button type="submit" class="btn btn-primary" [disabled]="loading()">Guardar</button>

        <p class="text-xs text-muted">
          Con 2 días de anticipación, un caso prometido para el viernes aparece en Avisos desde el miércoles.
          El aviso se quita al resolver el caso, cambiar la fecha prometida o quitar la promesa.
        </p>
      </form>
    </div>
  `,
})
export class RemindersTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly reminders = inject(Reminders);

  protected readonly units = UNITS;
  protected readonly loading = signal(true);
  // Forgotten cases
  protected readonly enabled = signal(true);
  protected readonly amount = signal(2);
  protected readonly unit = signal<Unit>('days');
  // Delivery promise, advance notice
  protected readonly soonEnabled = signal(false);
  protected readonly soonDays = signal(1);

  constructor() {
    this.api
      .reminderSettings()
      .then(({ staleHours, promiseSoonDays }) => {
        this.enabled.set(staleHours > 0);
        if (staleHours > 0) {
          // Whole days read better as days.
          const days = staleHours % 24 === 0;
          this.unit.set(days ? 'days' : 'hours');
          this.amount.set(days ? staleHours / 24 : staleHours);
        }
        this.soonEnabled.set(promiseSoonDays > 0);
        if (promiseSoonDays > 0) this.soonDays.set(promiseSoonDays);
      })
      .catch((error: unknown) => this.toast.error(error))
      .finally(() => this.loading.set(false));
  }

  protected async saveStale(): Promise<void> {
    const amount = Math.round(Number(this.amount()));
    if (this.enabled() && (!Number.isFinite(amount) || amount < 1)) {
      this.toast.error('El tiempo debe ser al menos 1');
      return;
    }
    const staleHours = this.enabled() ? amount * (this.unit() === 'days' ? 24 : 1) : 0;
    if (staleHours > 24 * 365) {
      this.toast.error('El tiempo máximo es un año');
      return;
    }
    await this.save({ staleHours }, staleHours ? 'Recordatorio guardado' : 'Recordatorio de casos olvidados apagado');
  }

  protected async savePromise(): Promise<void> {
    const days = Math.round(Number(this.soonDays()));
    if (this.soonEnabled() && (!Number.isFinite(days) || days < 1 || days > 60)) {
      this.toast.error('La anticipación debe estar entre 1 y 60 días');
      return;
    }
    const promiseSoonDays = this.soonEnabled() ? days : 0;
    await this.save({ promiseSoonDays }, promiseSoonDays ? 'Aviso anticipado guardado' : 'Aviso anticipado apagado');
  }

  private async save(settings: { staleHours?: number; promiseSoonDays?: number }, done: string): Promise<void> {
    try {
      await this.api.saveReminderSettings(settings);
      await this.reminders.refresh();
      this.toast.ok(done);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
