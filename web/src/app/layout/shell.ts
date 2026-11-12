import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppLogo } from '../core/app-logo';
import { Auth } from '../core/auth';
import { Branding } from '../core/branding';
import { Catalogs } from '../core/catalogs';
import { Live } from '../core/live';
import { Reminders } from '../core/reminders';
import { RemindersPanel } from './reminders-panel';
import { Theme } from '../core/theme';
import { Toast } from '../core/toast';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RemindersPanel, AppLogo],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex h-dvh">
      <aside class="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div class="flex items-center gap-2.5 px-4 py-4">
          <app-logo />
          <div>
            <div class="leading-tight font-semibold">Soporte</div>
            <div class="text-xs text-muted">Casos técnicos</div>
          </div>
        </div>

        <nav class="flex-1 space-y-1 px-2" aria-label="Principal">
          @for (link of links; track link.path) {
            <a class="nav-link" [routerLink]="link.path" routerLinkActive="active">
              <i class="mdi text-lg leading-none" [class]="link.icon" aria-hidden="true"></i>
              {{ link.label }}
            </a>
          }
          <button type="button" class="nav-link w-full" (click)="remindersOpen.set(true)" [attr.aria-label]="'Avisos: ' + reminders.count() + ' casos'">
            <i class="mdi text-lg leading-none" [class]="reminders.count() ? 'mdi-bell-ring-outline' : 'mdi-bell-outline'" aria-hidden="true"></i>
            Avisos
            @if (reminders.count()) {
              <span class="badge ml-auto bg-danger text-white">{{ reminders.count() }}</span>
            }
          </button>
        </nav>

        <div class="border-t border-line p-2">
          <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
            <span class="flex-1 truncate" [title]="auth.user()?.username ?? ''">{{ auth.user()?.name }}</span>
            <span
              class="inline-flex items-center gap-1"
              [title]="live.connected() ? 'Los cambios de otras personas y del asistente aparecen solos' : 'Sin conexión en vivo. Reintentando; mientras tanto recarga para ver cambios'"
            >
              <span class="size-2 rounded-full" [class]="live.connected() ? 'bg-success' : 'bg-warning'" aria-hidden="true"></span>
              {{ live.connected() ? 'En vivo' : 'Reconectando' }}
            </span>
          </div>
          <button type="button" class="nav-link w-full" (click)="theme.toggle()">
            <i class="mdi text-lg leading-none" [class]="theme.dark() ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" aria-hidden="true"></i>
            {{ theme.dark() ? 'Tema claro' : 'Tema oscuro' }}
          </button>
          <button type="button" class="nav-link w-full" (click)="auth.logout()">
            <i class="mdi mdi-logout text-lg leading-none" aria-hidden="true"></i>
            Salir
          </button>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 md:hidden">
          <app-logo size="sm" />
          <span class="flex-1 font-semibold">Soporte</span>
          <button type="button" class="btn btn-ghost relative px-2" (click)="remindersOpen.set(true)" [attr.aria-label]="'Avisos: ' + reminders.count() + ' casos'">
            <i class="mdi text-lg" [class]="reminders.count() ? 'mdi-bell-ring-outline' : 'mdi-bell-outline'" aria-hidden="true"></i>
            @if (reminders.count()) {
              <span class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger px-1 text-center text-[10px] leading-4 font-semibold text-white">{{ reminders.count() }}</span>
            }
          </button>
          <button type="button" class="btn btn-ghost px-2" (click)="theme.toggle()" aria-label="Cambiar tema">
            <i class="mdi text-lg" [class]="theme.dark() ? 'mdi-white-balance-sunny' : 'mdi-weather-night'" aria-hidden="true"></i>
          </button>
          <button type="button" class="btn btn-ghost px-2" (click)="auth.logout()" aria-label="Salir">
            <i class="mdi mdi-logout text-lg" aria-hidden="true"></i>
          </button>
        </header>

        <main class="min-h-0 flex-1 overflow-auto">
          <router-outlet />
        </main>

        <nav class="flex border-t border-line bg-surface md:hidden" aria-label="Principal">
          @for (link of links; track link.path) {
            <a class="tab-link" [routerLink]="link.path" routerLinkActive="active">
              <i class="mdi text-xl leading-none" [class]="link.icon" aria-hidden="true"></i>
              {{ link.label }}
            </a>
          }
        </nav>
      </div>
    </div>

    @if (remindersOpen()) {
      <app-reminders-panel (closed)="remindersOpen.set(false)" />
    }
  `,
})
export class Shell {
  protected readonly auth = inject(Auth);
  protected readonly theme = inject(Theme);
  protected readonly reminders = inject(Reminders);
  protected readonly live = inject(Live);
  protected readonly remindersOpen = signal(false);
  private readonly catalogs = inject(Catalogs);
  private readonly toast = inject(Toast);
  private readonly branding = inject(Branding);

  protected readonly links = [
    { path: '/casos', label: 'Casos', icon: 'mdi-format-list-bulleted' },
    { path: '/tablero', label: 'Tablero', icon: 'mdi-view-column-outline' },
    { path: '/dashboard', label: 'Dashboard', icon: 'mdi-chart-box-outline' },
    { path: '/configuracion', label: 'Configuración', icon: 'mdi-cog-outline' },
  ];

  constructor() {
    this.catalogs.ensure().catch((error: unknown) => this.toast.error(error));
    this.reminders.start();
    this.live.start();
    inject(DestroyRef).onDestroy(() => {
      this.reminders.stop();
      this.live.stop();
    });

    // Changes made elsewhere (another person, another tab, an assistant through MCP).
    // Changes to cases reach the bell on their own (see Reminders.start).
    effect(() => {
      if (!this.live.settings()) return;
      untracked(() => {
        this.reminders.refreshSoon();
        // The company logo is a setting too: someone else may have just changed it.
        void this.branding.load();
      });
    });
    effect(() => {
      if (this.live.catalogs()) untracked(() => this.catalogs.reload().catch(() => undefined));
    });
  }
}
