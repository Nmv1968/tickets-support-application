import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { SystemModule } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { SELECT } from '../../core/select';
import { Toast } from '../../core/toast';

/** Catalog of the supported software's modules. It changes as the software grows, so it is edited here. */
@Component({
  selector: 'app-modules-tab',
  imports: [FormsModule, ...SELECT, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-[2fr_1fr_auto] sm:items-end" (ngSubmit)="create()">
        <div>
          <label class="label" for="module-name">Nombre del módulo</label>
          <input id="module-name" class="input" name="name" placeholder="Notas de crédito" [(ngModel)]="name" />
        </div>
        <div>
          <label class="label" for="module-parent">Dentro de (opcional)</label>
          <!-- Left empty, the module is a main one: that is what the placeholder says. -->
          <ng-select labelForId="module-parent" name="parent" placeholder="Módulo principal" bindValue="id" bindLabel="name" [items]="parents()" [(ngModel)]="parentId" />
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!name().trim()"><app-icon name="plus" /> Agregar</button>
      </form>

      <div class="card divide-y divide-line">
        @for (module of all(); track module.id) {
          <div class="flex items-center gap-2 px-3 py-1.5" [class.opacity-60]="!module.active" [class.pl-9]="module.parentId">
            @if (module.parentId) {
              <app-icon name="subdirectory-arrow-right" class="text-muted" />
            }
            <input class="cell-control flex-1 cursor-text" [value]="module.name" [attr.aria-label]="'Nombre del módulo ' + module.name" (change)="rename(module, $event)" />
            @if (!module.active) {
              <span class="badge bg-elevated text-muted">Inactivo</span>
            }
            <button type="button" class="btn btn-soft px-2 py-1 text-xs" (click)="toggle(module)">{{ module.active ? 'Desactivar' : 'Activar' }}</button>
          </div>
        } @empty {
          <p class="p-6 text-center text-muted">No hay módulos. Agrega el primero arriba.</p>
        }
      </div>
      <p class="text-xs text-muted">
        Un módulo inactivo ya no aparece al registrar casos, pero los casos anteriores lo conservan. La IA clasifica cada caso con los módulos activos de esta lista.
      </p>
    </div>
  `,
})
export class ModulesTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly catalogs = inject(Catalogs);

  protected readonly all = signal<SystemModule[]>([]);
  protected readonly parents = computed(() => this.all().filter((module) => module.parentId === null && module.active));
  protected readonly name = signal('');
  /** Null: the module being added is a main one. */
  protected readonly parentId = signal<number | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.all.set(await this.api.modules(true));
    } catch (error) {
      this.toast.error(error);
    }
  }

  /** Sends a write and reads the list again, also after a refusal. True when it was stored. */
  private async run(action: () => Promise<unknown>): Promise<boolean> {
    try {
      await action();
    } catch (error) {
      this.toast.error(error);
      await this.load();
      return false;
    }
    await Promise.all([this.load(), this.catalogs.reload().catch((error: unknown) => this.toast.error(error))]);
    return true;
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      await this.api.createModule({ name: this.name().trim(), parentId: this.parentId() });
      this.name.set('');
    });
  }

  /**
   * A name edited in its row, sent when the field is left. An empty or refused name (another
   * module has it in the same place) puts back the name the module has: the list read again
   * still has it, so nothing else would redraw the field.
   */
  protected async rename(module: SystemModule, event: Event): Promise<void> {
    const field = event.target as HTMLInputElement;
    const name = field.value.trim();
    const renamed = !!name && name !== module.name && (await this.run(() => this.api.updateModule(module.id, { name })));
    if (!renamed) field.value = module.name;
  }

  protected toggle(module: SystemModule): void {
    void this.run(() => this.api.updateModule(module.id, { active: !module.active }));
  }
}
