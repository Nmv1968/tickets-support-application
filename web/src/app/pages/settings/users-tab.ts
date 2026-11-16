import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { Toast } from '../../core/toast';

@Component({
  selector: 'app-users-tab',
  imports: [FormsModule, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] lg:items-end" (ngSubmit)="create()">
        <div>
          <label class="label" for="user-name">Nombre</label>
          <input id="user-name" class="input" name="name" placeholder="Ana Torres" [(ngModel)]="name" />
        </div>
        <div>
          <label class="label" for="user-username">Usuario</label>
          <input id="user-username" class="input" name="username" placeholder="ana.torres" autocomplete="off" [(ngModel)]="username" />
        </div>
        <div>
          <label class="label" for="user-password">Contraseña (mínimo 6)</label>
          <input id="user-password" class="input" name="password" type="password" autocomplete="new-password" [(ngModel)]="password" />
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!name().trim() || username().trim().length < 3 || password().length < 6">
          <app-icon name="plus" /> Agregar
        </button>
      </form>

      <div class="card overflow-auto">
        <table class="w-full text-left">
          <thead class="bg-elevated text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">Nombre</th>
              <th class="px-3 py-2 font-medium">Usuario</th>
              <th class="px-3 py-2 font-medium">Acceso</th>
              <th class="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            @for (user of catalogs.users(); track user.id) {
              <tr class="border-t border-line" [class.opacity-60]="!user.active">
                <td class="px-1.5 py-1">
                  <input class="cell-control cursor-text font-medium" [value]="user.name" [attr.aria-label]="'Nombre de ' + user.username" (change)="rename(user, $event)" />
                </td>
                <td class="px-3 py-2 text-muted">{{ user.username }}</td>
                <td class="px-3 py-2">
                  @if (!user.active) {
                    <span class="badge bg-elevated text-muted">Inactivo</span>
                  } @else if (user.canLogin) {
                    <span class="badge st-RESOLVED">Puede ingresar</span>
                  } @else {
                    <span class="badge st-PENDING" title="Asígnale una contraseña para que pueda ingresar.">Sin contraseña</span>
                  }
                </td>
                <td class="px-3 py-1.5">
                  <div class="flex justify-end gap-1">
                    @if (passwordFor() === user.id) {
                      <input class="input w-40 px-2 py-1" type="password" placeholder="Nueva contraseña" autocomplete="new-password" [attr.aria-label]="'Nueva contraseña de ' + user.username" [(ngModel)]="newPassword" (keydown.enter)="setPassword(user)" />
                      <button type="button" class="btn btn-primary px-2 py-1" [disabled]="newPassword().length < 6" (click)="setPassword(user)">Guardar</button>
                      <button type="button" class="btn btn-ghost px-2 py-1" (click)="passwordFor.set(null)">Cancelar</button>
                    } @else {
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs" (click)="askPassword(user)">
                        <app-icon name="key-outline" /> Contraseña
                      </button>
                      @if (user.id !== auth.user()?.id) {
                        <button type="button" class="btn btn-soft px-2 py-1 text-xs" (click)="toggle(user)">
                          {{ user.active ? 'Desactivar' : 'Activar' }}
                        </button>
                      }
                    }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted">
        Todos los usuarios tienen el mismo acceso. Un usuario inactivo no puede ingresar. Quienes atienden los casos se administran aparte, en la pestaña Responsables.
      </p>
    </div>
  `,
})
export class UsersTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly auth = inject(Auth);
  protected readonly catalogs = inject(Catalogs);

  protected readonly name = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly passwordFor = signal<number | null>(null);
  protected readonly newPassword = signal('');

  private async run(action: () => Promise<unknown>, done: string): Promise<void> {
    try {
      await action();
      await this.catalogs.reload();
      this.toast.ok(done);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async create(): Promise<void> {
    await this.run(async () => {
      await this.api.createUser({ name: this.name().trim(), username: this.username().trim(), password: this.password() });
      this.name.set('');
      this.username.set('');
      this.password.set('');
    }, 'Usuario creado');
  }

  protected rename(user: User, event: Event): void {
    const name = (event.target as HTMLInputElement).value.trim();
    if (name && name !== user.name) void this.run(() => this.api.updateUser(user.id, { name }), 'Nombre actualizado');
  }

  protected toggle(user: User): void {
    void this.run(() => this.api.updateUser(user.id, { active: !user.active }), user.active ? 'Usuario desactivado' : 'Usuario activado');
  }

  protected askPassword(user: User): void {
    this.newPassword.set('');
    this.passwordFor.set(user.id);
  }

  protected async setPassword(user: User): Promise<void> {
    if (this.newPassword().length < 6) return;
    await this.run(() => this.api.updateUser(user.id, { password: this.newPassword() }), `Contraseña de ${user.name} actualizada`);
    this.passwordFor.set(null);
  }
}
