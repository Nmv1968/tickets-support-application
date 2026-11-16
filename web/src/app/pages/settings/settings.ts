import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Auth } from '../../core/auth';
import { Icon } from '../../core/icon';
import type { IconName } from '../../core/icons';
import { Toast } from '../../core/toast';
import { AiTab } from './ai-tab';
import { BrandingTab } from './branding-tab';
import { ModulesTab } from './modules-tab';
import { ASSIGNEES, COMPANIES, NamedCatalogTab } from './named-catalog-tab';
import { RemindersTab } from './reminders-tab';
import { SlaTab } from './sla-tab';
import { SupportTypesTab } from './support-types-tab';
import { UsersTab } from './users-tab';

type TabId = 'users' | 'assignees' | 'companies' | 'supportTypes' | 'modules' | 'sla' | 'reminders' | 'ai' | 'branding' | 'account';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, UsersTab, NamedCatalogTab, SupportTypesTab, ModulesTab, SlaTab, RemindersTab, AiTab, BrandingTab, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl space-y-4 p-3 md:p-5">
      <h1 class="text-lg font-semibold">Configuración</h1>

      <!-- More tabs than fit in a line: a phone scrolls them sideways, a wider screen puts them in two lines. -->
      <div class="flex gap-1 overflow-x-auto rounded-control bg-elevated p-1 md:flex-wrap" role="tablist">
        @for (item of tabs(); track item.id) {
          <button
            type="button"
            role="tab"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap"
            [class.bg-surface]="shown() === item.id"
            [class.text-muted]="shown() !== item.id"
            [attr.aria-selected]="shown() === item.id"
            (click)="tab.set(item.id)"
          >
            <app-icon [name]="item.icon" class="text-base leading-none" />
            {{ item.label }}
          </button>
        }
      </div>

      @switch (shown()) {
        @case ('users') {
          <app-users-tab />
        }
        @case ('assignees') {
          <app-named-catalog-tab [catalog]="assignees" />
        }
        @case ('companies') {
          <app-named-catalog-tab [catalog]="companies" />
        }
        @case ('supportTypes') {
          <app-support-types-tab />
        }
        @case ('modules') {
          <app-modules-tab />
        }
        @case ('sla') {
          <app-sla-tab />
        }
        @case ('reminders') {
          <app-reminders-tab />
        }
        @case ('ai') {
          <app-ai-tab />
        }
        @case ('branding') {
          <app-branding-tab />
        }
        @case ('account') {
          <form class="card max-w-md space-y-3 p-4" (ngSubmit)="changePassword()">
            <h2 class="font-semibold">Cambiar mi contraseña</h2>
            <div>
              <label class="label" for="pw-current">Contraseña actual</label>
              <input id="pw-current" class="input" type="password" name="current" autocomplete="current-password" [(ngModel)]="current" />
            </div>
            <div>
              <label class="label" for="pw-next">Contraseña nueva (mínimo 6 caracteres)</label>
              <input id="pw-next" class="input" type="password" name="next" autocomplete="new-password" [(ngModel)]="next" />
            </div>
            <button type="submit" class="btn btn-primary" [disabled]="!current() || next().length < 6">Cambiar contraseña</button>
          </form>
        }
      }
    </div>
  `,
})
export class SettingsPage {
  private readonly toast = inject(Toast);
  private readonly auth = inject(Auth);

  /** `admin`: only an administrator sees the tab. An agent has the catalogs and their own account. */
  private readonly allTabs: { id: TabId; label: string; icon: IconName; admin?: true }[] = [
    { id: 'users', label: 'Usuarios', icon: 'account-multiple-outline', admin: true },
    { id: 'assignees', label: 'Responsables', icon: 'account-hard-hat-outline' },
    { id: 'companies', label: 'Empresas', icon: 'domain' },
    { id: 'supportTypes', label: 'Tipos de soporte', icon: 'tag-multiple-outline' },
    { id: 'modules', label: 'Módulos', icon: 'view-grid-outline' },
    { id: 'sla', label: 'SLA', icon: 'timer-cog-outline', admin: true },
    { id: 'reminders', label: 'Recordatorios', icon: 'bell-cog-outline', admin: true },
    { id: 'ai', label: 'IA', icon: 'creation-outline', admin: true },
    // "Logo" and not "Empresa": the companies of the catalog are the clients, and have their own tab.
    { id: 'branding', label: 'Logo', icon: 'image-outline', admin: true },
    { id: 'account', label: 'Mi cuenta', icon: 'account-key-outline' },
  ];
  protected readonly tabs = computed(() => (this.auth.isAdmin() ? this.allTabs : this.allTabs.filter((item) => !item.admin)));
  /** The tab chosen. */
  protected readonly tab = signal<TabId>('users');
  /** The tab on screen: the one chosen while this user has it, the first one they have otherwise. */
  protected readonly shown = computed(() => (this.tabs().some((item) => item.id === this.tab()) ? this.tab() : this.tabs()[0].id));
  protected readonly assignees = ASSIGNEES;
  protected readonly companies = COMPANIES;
  protected readonly current = signal('');
  protected readonly next = signal('');

  protected async changePassword(): Promise<void> {
    try {
      await this.auth.changePassword(this.current(), this.next());
      this.current.set('');
      this.next.set('');
      this.toast.ok('Contraseña cambiada. Si tenías la sesión abierta en otro navegador o equipo, allí se cerró.');
    } catch (error) {
      this.toast.error(error);
    }
  }
}
