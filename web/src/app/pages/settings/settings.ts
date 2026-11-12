import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Toast } from '../../core/toast';
import { AiTab } from './ai-tab';
import { AssigneesTab } from './assignees-tab';
import { BrandingTab } from './branding-tab';
import { ModulesTab } from './modules-tab';
import { RemindersTab } from './reminders-tab';
import { SlaTab } from './sla-tab';
import { UsersTab } from './users-tab';

type TabId = 'users' | 'assignees' | 'modules' | 'sla' | 'reminders' | 'ai' | 'branding' | 'account';

@Component({
  selector: 'app-settings',
  imports: [FormsModule, UsersTab, AssigneesTab, ModulesTab, SlaTab, RemindersTab, AiTab, BrandingTab],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mx-auto max-w-4xl space-y-4 p-3 md:p-5">
      <h1 class="text-lg font-semibold">Configuración</h1>

      <div class="flex gap-1 overflow-x-auto rounded-control bg-elevated p-1" role="tablist">
        @for (item of tabs; track item.id) {
          <button
            type="button"
            role="tab"
            class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium whitespace-nowrap"
            [class.bg-surface]="tab() === item.id"
            [class.text-muted]="tab() !== item.id"
            [attr.aria-selected]="tab() === item.id"
            (click)="tab.set(item.id)"
          >
            <i class="mdi text-base leading-none" [class]="item.icon" aria-hidden="true"></i>
            {{ item.label }}
          </button>
        }
      </div>

      @switch (tab()) {
        @case ('users') {
          <app-users-tab />
        }
        @case ('assignees') {
          <app-assignees-tab />
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
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);

  protected readonly tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'users', label: 'Usuarios', icon: 'mdi-account-multiple-outline' },
    { id: 'assignees', label: 'Responsables', icon: 'mdi-account-hard-hat-outline' },
    { id: 'modules', label: 'Módulos', icon: 'mdi-view-grid-outline' },
    { id: 'sla', label: 'SLA', icon: 'mdi-timer-cog-outline' },
    { id: 'reminders', label: 'Recordatorios', icon: 'mdi-bell-cog-outline' },
    { id: 'ai', label: 'IA', icon: 'mdi-creation-outline' },
    { id: 'branding', label: 'Empresa', icon: 'mdi-domain' },
    { id: 'account', label: 'Mi cuenta', icon: 'mdi-account-key-outline' },
  ];
  protected readonly tab = signal<TabId>('users');
  protected readonly current = signal('');
  protected readonly next = signal('');

  protected async changePassword(): Promise<void> {
    try {
      await this.api.changePassword(this.current(), this.next());
      this.current.set('');
      this.next.set('');
      this.toast.ok('Contraseña cambiada');
    } catch (error) {
      this.toast.error(error);
    }
  }
}
