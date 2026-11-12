import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Priority } from '../../core/api';
import { Toast } from '../../core/toast';
import { PRIORITY_CLASS, PRIORITY_LABEL } from '../../core/ui';

@Component({
  selector: 'app-sla-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <form class="card max-w-md space-y-3 p-4" (ngSubmit)="save()">
      <h2 class="font-semibold">Horas para resolver, por prioridad</h2>
      @for (item of items(); track item.priority) {
        <div class="flex items-center gap-3">
          <label class="flex w-28 items-center gap-1.5" [for]="'sla-' + item.priority">
            <i class="mdi mdi-flag" [class]="priorityClass[item.priority]" aria-hidden="true"></i>
            {{ priorityLabel[item.priority] }}
          </label>
          <input [id]="'sla-' + item.priority" class="input w-28" type="number" min="1" [name]="item.priority" [ngModel]="item.hours" (ngModelChange)="setHours(item.priority, $event)" />
          <span class="text-xs text-muted">horas</span>
        </div>
      }
      <button type="submit" class="btn btn-primary">Guardar</button>
      <p class="text-xs text-muted">
        La fecha límite de un caso es su hora de registro más estas horas (horas corridas, no laborables). Un caso sin prioridad no tiene fecha límite.
        Los cambios aplican a casos nuevos o cuando se cambia la prioridad de uno existente.
      </p>
    </form>
  `,
})
export class SlaTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);

  protected readonly priorityLabel = PRIORITY_LABEL;
  protected readonly priorityClass = PRIORITY_CLASS;
  protected readonly items = signal<{ priority: Priority; hours: number }[]>([]);

  constructor() {
    this.api
      .sla()
      // Most urgent first.
      .then((items) => this.items.set([...items].reverse()))
      .catch((error: unknown) => this.toast.error(error));
  }

  protected setHours(priority: Priority, hours: number): void {
    this.items.update((items) => items.map((item) => (item.priority === priority ? { ...item, hours } : item)));
  }

  protected async save(): Promise<void> {
    const items = this.items().map((item) => ({ priority: item.priority, hours: Math.round(Number(item.hours)) }));
    if (items.some((item) => !Number.isFinite(item.hours) || item.hours < 1)) {
      this.toast.error('Cada prioridad necesita al menos 1 hora');
      return;
    }
    try {
      await this.api.saveSla(items);
      this.toast.ok('SLA guardado');
    } catch (error) {
      this.toast.error(error);
    }
  }
}
