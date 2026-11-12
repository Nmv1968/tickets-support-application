import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Assignee } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Toast } from '../../core/toast';

/**
 * The people a case can be assigned to. A list of names: whoever attends cases goes here, whether
 * or not they are a user of the app.
 */
@Component({
  selector: 'app-assignees-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end" (ngSubmit)="create()">
        <div>
          <label class="label" for="assignee-name">Nombre del responsable</label>
          <input id="assignee-name" class="input" name="name" placeholder="Ana Torres" maxlength="80" autocomplete="off" [(ngModel)]="name" />
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!name().trim() || busy()"><i class="mdi mdi-plus" aria-hidden="true"></i> Agregar</button>
      </form>

      <div class="card divide-y divide-line">
        @for (person of catalogs.assignees(); track person.id) {
          <div class="flex flex-wrap items-center gap-2 px-3 py-1.5" [class.opacity-60]="!person.active">
            <input
              class="cell-control min-w-40 flex-1 cursor-text font-medium"
              maxlength="80"
              [value]="person.name"
              [attr.aria-label]="'Nombre del responsable ' + person.name"
              (change)="rename(person, $event)"
            />
            @if (usernames().get(person.id); as username) {
              <span class="badge bg-elevated text-muted" title="Usuario del sistema que es este responsable"><i class="mdi mdi-account-outline" aria-hidden="true"></i> {{ username }}</span>
            }
            <!-- Kept together: on a narrow screen the whole group goes under the name, to the right. -->
            <div class="ml-auto flex items-center gap-2">
              <span class="text-xs text-muted">{{ person.tickets }} {{ person.tickets === 1 ? 'caso' : 'casos' }}</span>
              @if (!person.active) {
                <span class="badge bg-elevated text-muted">Inactivo</span>
              }
              <button type="button" class="btn btn-soft px-2 py-1 text-xs" [disabled]="busy()" (click)="toggle(person)">{{ person.active ? 'Desactivar' : 'Activar' }}</button>
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-danger disabled:text-muted"
                [disabled]="busy() || person.tickets > 0"
                [title]="person.tickets > 0 ? 'Tiene casos asignados: desactívalo o reasigna sus casos' : 'Eliminar'"
                [attr.aria-label]="'Eliminar a ' + person.name"
                (click)="remove(person)"
              >
                <i class="mdi mdi-trash-can-outline text-base leading-none" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        } @empty {
          <p class="p-6 text-center text-muted">No hay responsables. Agrega arriba a quienes atienden los casos.</p>
        }
      </div>
      <p class="text-xs text-muted">
        Los responsables no necesitan ser usuarios del sistema: basta el nombre. Un responsable inactivo ya no aparece al registrar o reasignar casos, pero conserva los que
        tiene. Solo se puede eliminar a quien no tiene casos. «Cliente» ya es una opción de cada caso; no hace falta agregarlo.
      </p>
    </div>
  `,
})
export class AssigneesTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly catalogs = inject(Catalogs);

  protected readonly name = signal('');
  /** A write is on its way: a second click must not send it twice. */
  protected readonly busy = signal(false);
  /** Usernames of the users linked to each responsible, by responsible id. */
  protected readonly usernames = computed(() => {
    const byAssignee = new Map<number, string>();
    for (const user of this.catalogs.users()) {
      if (user.assigneeId === null) continue;
      const others = byAssignee.get(user.assigneeId);
      byAssignee.set(user.assigneeId, others ? `${others}, ${user.username}` : user.username);
    }
    return byAssignee;
  });

  constructor() {
    // The number of cases of each responsible moves with every assignment: read it again on arrival.
    this.catalogs.reload().catch((error: unknown) => this.toast.error(error));
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      await action();
      this.toast.ok(done);
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    } finally {
      // Also after a refusal: the list on screen may be what was out of date.
      await this.catalogs.reload().catch(() => undefined);
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    if (await this.run(() => this.api.createAssignee(name), 'Responsable agregado')) this.name.set('');
  }

  protected async rename(person: Assignee, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const name = input.value.trim();
    const renamed = !!name && name !== person.name && (await this.run(() => this.api.updateAssignee(person.id, { name }), 'Nombre actualizado'));
    // An empty or refused name: the field goes back to the name the responsible has.
    if (!renamed) input.value = person.name;
  }

  protected toggle(person: Assignee): void {
    void this.run(() => this.api.updateAssignee(person.id, { active: !person.active }), person.active ? 'Responsable desactivado' : 'Responsable activado');
  }

  protected remove(person: Assignee): void {
    void this.run(() => this.api.deleteAssignee(person.id), 'Responsable eliminado');
  }
}
