import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Role, User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { SELECT } from '../../core/select';
import { Toast } from '../../core/toast';
import { ROLE_LABEL, ROLE_OPTIONS } from '../../core/ui';

/** The users of the app and their role. Only an administrator has this tab (see SettingsPage). */
@Component({
  selector: 'app-users-tab',
  imports: [FormsModule, ...SELECT, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_10rem_auto] lg:items-end" (ngSubmit)="create()">
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
        <div>
          <label class="label" for="user-role">Rol</label>
          <ng-select labelForId="user-role" name="role" bindValue="id" bindLabel="label" [items]="roles" [clearable]="false" [searchable]="false" [(ngModel)]="role" />
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!name().trim() || username().trim().length < 3 || password().length < 6">
          <app-icon name="plus" /> Agregar
        </button>
      </form>

      <div class="card @container overflow-auto">
        <table class="w-full text-left">
          <thead class="bg-elevated text-xs text-muted">
            <tr>
              <th class="px-3 py-2 font-medium">Nombre y usuario</th>
              <th class="px-3 py-2 font-medium">Rol</th>
              <th class="px-3 py-2 font-medium">Acceso</th>
              <th class="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            @for (user of catalogs.users(); track user.id) {
              <tr class="border-t border-line" [class.opacity-60]="!user.active">
                <td class="px-1.5 py-1">
                  <!--
                    Room for a name of some 24 characters, and the username under it rather than in a column of its own: the
                    row fits the card of a 1024 px screen, its buttons in two lines (see below). A phone scrolls the table sideways.
                  -->
                  <input class="cell-control min-w-[25ch] cursor-text font-medium" [value]="user.name" [attr.aria-label]="'Nombre de ' + user.username" (change)="rename(user, $event)" />
                  <div class="px-1.5 pb-0.5 text-xs wrap-anywhere text-muted">{{ user.username }}</div>
                </td>
                <td class="px-3 py-2 whitespace-nowrap">{{ roleLabel[user.role] }}</td>
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
                  <!-- In two lines where that is what the table needs to fit its card; in one, scrolled to, where nothing would make it fit. -->
                  <div class="flex justify-end gap-1 @min-[44rem]:flex-wrap">
                    @if (passwordFor() === user.id) {
                      <input class="input w-40 px-2 py-1" type="password" placeholder="Nueva contraseña" autocomplete="new-password" [attr.aria-label]="'Nueva contraseña de ' + user.username" [(ngModel)]="newPassword" (keydown.enter)="setPassword(user)" />
                      <button type="button" class="btn btn-primary px-2 py-1" [disabled]="newPassword().length < 6" (click)="setPassword(user)">Guardar</button>
                      <button type="button" class="btn btn-ghost px-2 py-1" (click)="passwordFor.set(null)">Cancelar</button>
                    } @else if (user.id === auth.user()?.id) {
                      <!-- Nobody changes their own role or locks themselves out: another administrator does it. Their own
                           password is changed in Mi cuenta, with the current one: reset here, it would end this very session. -->
                      <span class="px-2 py-1 text-xs whitespace-nowrap text-muted">Tu contraseña, en Mi cuenta</span>
                    } @else {
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs" (click)="askPassword(user)">
                        <app-icon name="key-outline" /> Contraseña
                      </button>
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs whitespace-nowrap" (click)="switchRole(user)">
                        {{ user.role === 'ADMIN' ? 'Hacer agente' : 'Hacer administrador' }}
                      </button>
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs" (click)="toggle(user)">
                        {{ user.active ? 'Desactivar' : 'Activar' }}
                      </button>
                    }
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="text-xs text-muted">
        Un agente trabaja los casos y agrega responsables, empresas, tipos de soporte y módulos. Un administrador, además, maneja los usuarios, el SLA, los
        recordatorios, la IA y el logo. Un usuario inactivo no puede ingresar. Una contraseña nueva, otro rol o desactivar a alguien cierra las sesiones que
        tenga abiertas. Quienes atienden los casos se administran aparte, en la pestaña Responsables.
      </p>
    </div>
  `,
})
export class UsersTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  protected readonly auth = inject(Auth);
  protected readonly catalogs = inject(Catalogs);

  protected readonly roles = ROLE_OPTIONS;
  protected readonly roleLabel = ROLE_LABEL;
  protected readonly name = signal('');
  protected readonly username = signal('');
  protected readonly password = signal('');
  protected readonly role = signal<Role>('AGENT');
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
      await this.api.createUser({ name: this.name().trim(), username: this.username().trim(), password: this.password(), role: this.role() });
      this.name.set('');
      this.username.set('');
      this.password.set('');
      this.role.set('AGENT');
    }, 'Usuario creado');
  }

  protected switchRole(user: User): void {
    const role: Role = user.role === 'ADMIN' ? 'AGENT' : 'ADMIN';
    void this.run(() => this.api.updateUser(user.id, { role }), `Rol de ${user.name}: ${ROLE_LABEL[role]}`);
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
