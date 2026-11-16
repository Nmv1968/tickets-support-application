import { ChangeDetectionStrategy, Component, ElementRef, Injector, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Role, User } from '../../core/api';
import { Auth } from '../../core/auth';
import { Catalogs } from '../../core/catalogs';
import { focusAfterRender, focusProblem } from '../../core/focus';
import { Icon } from '../../core/icon';
import { SELECT } from '../../core/select';
import { SoftDisabled } from '../../core/soft-disabled';
import { Toast } from '../../core/toast';
import { ROLE_LABEL, ROLE_OPTIONS } from '../../core/ui';

/** The shortest username and password a new user can have: what the API asks for. */
const USERNAME_MIN = 3;
const PASSWORD_MIN = 6;

/** The users of the app and their role. Only an administrator has this tab (see SettingsPage). */
@Component({
  selector: 'app-users-tab',
  imports: [FormsModule, ...SELECT, Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Aligned at the top: the message under a field must not move the others. -->
      <form class="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_10rem_auto] lg:items-start" (ngSubmit)="create()">
        <div>
          <label class="label" for="user-name">Nombre</label>
          <input
            id="user-name"
            class="input aria-[invalid=true]:border-danger"
            name="name"
            placeholder="Ana Torres"
            required
            [(ngModel)]="name"
            [attr.aria-invalid]="problems().name ? 'true' : null"
            [attr.aria-describedby]="problems().name ? 'user-name-error' : null"
          />
          @if (problems().name; as problem) {
            <p class="field-error" id="user-name-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" for="user-username">Usuario (mínimo {{ usernameMin }})</label>
          <input
            id="user-username"
            class="input aria-[invalid=true]:border-danger"
            name="username"
            placeholder="ana.torres"
            autocomplete="off"
            required
            [(ngModel)]="username"
            [attr.aria-invalid]="problems().username ? 'true' : null"
            [attr.aria-describedby]="problems().username ? 'user-username-error' : null"
          />
          @if (problems().username; as problem) {
            <p class="field-error" id="user-username-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" for="user-password">Contraseña (mínimo {{ passwordMin }})</label>
          <input
            id="user-password"
            class="input aria-[invalid=true]:border-danger"
            name="password"
            type="password"
            autocomplete="new-password"
            required
            [(ngModel)]="password"
            [attr.aria-invalid]="problems().password ? 'true' : null"
            [attr.aria-describedby]="problems().password ? 'user-password-error' : null"
          />
          @if (problems().password; as problem) {
            <p class="field-error" id="user-password-error"><app-icon name="alert-circle-outline" class="text-danger" /> {{ problem }}</p>
          }
        </div>
        <div>
          <label class="label" for="user-role">Rol</label>
          <ng-select labelForId="user-role" name="role" bindValue="id" bindLabel="label" [items]="roles" [clearable]="false" [searchable]="false" [(ngModel)]="role" />
        </div>
        <!-- Never disabled for a field left short: pressed, it says which one. While it waits it keeps the focus. -->
        <button type="submit" class="btn btn-primary lg:mt-5" [appSoftDisabled]="creating()">
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
              <!-- An inactive user says so in its badge, and its name is in the softer colour: still readable, as the rest of the row. -->
              <tr class="border-t border-line">
                <td class="px-1.5 py-1">
                  <!--
                    Room for a name of some 24 characters, and the username under it rather than in a column of its own: the
                    row fits the card of a 1024 px screen, its buttons in two lines (see below). A phone scrolls the table sideways.
                  -->
                  <input class="cell-control min-w-[25ch] cursor-text font-medium" [class.text-muted]="!user.active" [value]="user.name" [attr.aria-label]="'Nombre de ' + user.username" (change)="rename(user, $event)" />
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
                      <input
                        class="input w-40 px-2 py-1"
                        type="password"
                        placeholder="Nueva contraseña"
                        autocomplete="new-password"
                        data-new-password
                        [attr.aria-label]="'Nueva contraseña de ' + user.username"
                        [(ngModel)]="newPassword"
                        (keydown.enter)="setPassword(user)"
                      />
                      <button type="button" class="btn btn-primary px-2 py-1" [appSoftDisabled]="newPassword().length < passwordMin" (click)="setPassword(user)">Guardar</button>
                      <button type="button" class="btn btn-ghost px-2 py-1" (click)="closePassword(user)">Cancelar</button>
                    } @else if (user.id === auth.user()?.id) {
                      <!-- Nobody changes their own role or locks themselves out: another administrator does it. Their own
                           password is changed in Mi cuenta, with the current one: reset here, it would end this very session. -->
                      <span class="px-2 py-1 text-xs whitespace-nowrap text-muted">Tu contraseña, en Mi cuenta</span>
                    } @else {
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs" [attr.data-password-of]="user.id" [attr.aria-label]="'Contraseña de ' + user.name" (click)="askPassword(user)">
                        <app-icon name="key-outline" /> Contraseña
                      </button>
                      <button
                        type="button"
                        class="btn btn-soft px-2 py-1 text-xs whitespace-nowrap"
                        [attr.aria-label]="(user.role === 'ADMIN' ? 'Hacer agente a ' : 'Hacer administrador a ') + user.name"
                        (click)="switchRole(user)"
                      >
                        {{ user.role === 'ADMIN' ? 'Hacer agente' : 'Hacer administrador' }}
                      </button>
                      <button type="button" class="btn btn-soft px-2 py-1 text-xs" [attr.aria-label]="(user.active ? 'Desactivar a ' : 'Activar a ') + user.name" (click)="toggle(user)">
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
        recordatorios, la IA y el logo. Un usuario inactivo no puede ingresar, ni uno «Sin contraseña» hasta que le asignes una con «Contraseña». Una
        contraseña nueva, otro rol o desactivar a alguien cierra las sesiones que tenga abiertas. Quienes atienden los casos se administran aparte, en la pestaña Responsables.
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
  protected readonly usernameMin = USERNAME_MIN;
  protected readonly passwordMin = PASSWORD_MIN;
  protected readonly creating = signal(false);
  /** "Agregar" was pressed with a field missing or short: from then on each one says so, until it is right. */
  private readonly tried = signal(false);
  protected readonly problems = computed((): { name?: string; username?: string; password?: string } => {
    if (!this.tried()) return {};
    return {
      name: this.name().trim() ? undefined : 'Escribe el nombre.',
      username: this.username().trim().length >= USERNAME_MIN ? undefined : `El usuario necesita al menos ${USERNAME_MIN} caracteres.`,
      password: this.password().length >= PASSWORD_MIN ? undefined : `La contraseña necesita al menos ${PASSWORD_MIN} caracteres.`,
    };
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly injector = inject(Injector);

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
    if (this.creating()) return;
    this.tried.set(true);
    const problems = this.problems();
    if (problems.name || problems.username || problems.password) {
      // To the first field that is missing or short, which says what it needs (see focusProblem).
      const [field, message] = problems.name ? ['user-name', problems.name] : problems.username ? ['user-username', problems.username] : ['user-password', problems.password ?? ''];
      focusProblem(this.injector, () => this.host.querySelector(`#${field}`), message);
      return;
    }
    this.creating.set(true);
    try {
      await this.run(async () => {
        await this.api.createUser({ name: this.name().trim(), username: this.username().trim(), password: this.password(), role: this.role() });
        this.name.set('');
        this.username.set('');
        this.password.set('');
        this.role.set('AGENT');
        // Empty again, and not yet missing: nothing was pressed for the next user.
        this.tried.set(false);
      }, 'Usuario creado');
    } finally {
      this.creating.set(false);
    }
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

  /** "Contraseña": its buttons give way to the field of the new one, which takes the focus. */
  protected askPassword(user: User): void {
    this.newPassword.set('');
    this.passwordFor.set(user.id);
    focusAfterRender(this.injector, () => this.host.querySelector('[data-new-password]'));
  }

  /** The field goes, and the focus back to the "Contraseña" of the same user. */
  protected closePassword(user: User): void {
    this.passwordFor.set(null);
    focusAfterRender(this.injector, () => this.host.querySelector(`[data-password-of="${user.id}"]`));
  }

  protected async setPassword(user: User): Promise<void> {
    if (this.newPassword().length < PASSWORD_MIN) return;
    await this.run(() => this.api.updateUser(user.id, { password: this.newPassword() }), `Contraseña de ${user.name} actualizada`);
    this.closePassword(user);
  }
}
