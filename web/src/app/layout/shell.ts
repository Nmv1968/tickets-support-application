import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AppLogo } from '../core/app-logo';
import { Auth } from '../core/auth';
import { Branding } from '../core/branding';
import { Catalogs } from '../core/catalogs';
import { ConfirmDialog } from '../core/confirm';
import { Hint } from '../core/hint';
import { Icon } from '../core/icon';
import type { IconName } from '../core/icons';
import { Live } from '../core/live';
import { Reminders } from '../core/reminders';
import { RemindersPanel } from './reminders-panel';
import { Theme } from '../core/theme';
import { Toast } from '../core/toast';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, RemindersPanel, AppLogo, ConfirmDialog, Hint, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!--
      The first stop of the Tab key: past the menu (seven stops) or the bar of a phone, to the
      screen itself. Hidden until it has the focus.
    -->
    <a
      href="#contenido"
      class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-100 focus:rounded-control focus:bg-primary-fill focus:px-3 focus:py-2 focus:font-medium focus:text-white"
      (click)="skipToContent($event)"
      >Saltar al contenido</a
    >
    <!--
      As high as the screen, with the bars of a phone above and below the content, which scrolls
      between them. On a short screen they would leave it a strip: the page scrolls, bars and all.
    -->
    <div class="flex h-dvh short:h-auto short:min-h-dvh">
      <aside class="hidden w-56 shrink-0 flex-col border-r border-line bg-surface md:flex">
        <div class="flex items-center gap-2.5 px-4 py-4">
          <app-logo />
          <div>
            <div class="leading-tight font-semibold">Soporte</div>
            <div class="text-xs text-muted">Casos técnicos</div>
          </div>
        </div>

        <!-- The link of the screen on says so to who hears the menu (aria-current), not only in its colours. -->
        <nav class="flex-1 space-y-1 px-2" aria-label="Principal">
          @for (link of links; track link.path) {
            <a class="nav-link" [routerLink]="link.path" routerLinkActive="active" ariaCurrentWhenActive="page">
              <app-icon [name]="link.icon" class="text-lg leading-none" />
              {{ link.label }}
            </a>
          }
          <button type="button" class="nav-link w-full" (click)="remindersOpen.set(true)" [attr.aria-label]="'Avisos: ' + reminders.count() + ' casos'">
            <app-icon [name]="reminders.count() ? 'bell-ring-outline' : 'bell-outline'" class="text-lg leading-none" />
            Avisos
            @if (reminders.count()) {
              <span class="badge ml-auto bg-danger-fill text-white">{{ reminders.count() }}</span>
            }
          </button>
        </nav>

        <div class="border-t border-line p-2">
          <!-- Whole, on more lines where it does not fit in one, and the username under it: cut, the rest of a long name was nowhere, and the username only in a title. -->
          <div class="px-3 pt-1.5 text-xs text-muted" data-user>
            <div class="wrap-anywhere">{{ auth.user()?.name }}</div>
            <div class="text-2xs wrap-anywhere">{{ auth.user()?.username }}</div>
          </div>
          <div class="flex items-center gap-2 px-3 py-1.5 text-xs text-muted">
            <!-- What it means, and what to do while it reconnects, behind its "?" (see Hint). -->
            <span class="inline-flex items-center gap-1" [title]="liveHint()">
              <span class="size-2 rounded-full" [class]="live.connected() ? 'bg-success' : 'bg-warning'" aria-hidden="true"></span>
              {{ live.connected() ? 'En vivo' : 'Reconectando' }}
            </span>
            <app-hint class="-ml-1" textId="shell-live-hint" [about]="live.connected() ? 'En vivo' : 'Reconectando'" [text]="liveHint()" />
          </div>
          <button type="button" class="nav-link w-full" (click)="theme.toggle()">
            <app-icon [name]="theme.dark() ? 'white-balance-sunny' : 'weather-night'" class="text-lg leading-none" />
            {{ theme.dark() ? 'Tema claro' : 'Tema oscuro' }}
          </button>
          <button type="button" class="nav-link w-full" (click)="auth.logout()">
            <app-icon name="logout" class="text-lg leading-none" />
            Salir
          </button>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <!-- Closer together on a short screen, with the button of the menu too: at 320 px "Soporte" was left two lines. -->
        <header class="flex items-center gap-2 border-b border-line bg-surface px-3 py-2 short:gap-1 md:hidden">
          <app-logo size="sm" />
          <span class="flex-1 font-semibold">Soporte</span>
          <button type="button" class="btn btn-ghost btn-icon relative px-2" (click)="remindersOpen.set(true)" [attr.aria-label]="'Avisos: ' + reminders.count() + ' casos'">
            <app-icon [name]="reminders.count() ? 'bell-ring-outline' : 'bell-outline'" class="text-lg" />
            @if (reminders.count()) {
              <span class="absolute -top-0.5 -right-0.5 min-w-4 rounded-full bg-danger-fill px-1 text-center text-[10px] leading-4 font-semibold text-white">{{ reminders.count() }}</span>
            }
          </button>
          <!-- Named by what it does, as the one of the menu: "Cambiar tema" did not say which one is on. -->
          <button type="button" class="btn btn-ghost btn-icon px-2" (click)="theme.toggle()" [attr.aria-label]="theme.dark() ? 'Tema claro' : 'Tema oscuro'">
            <app-icon [name]="theme.dark() ? 'white-balance-sunny' : 'weather-night'" class="text-lg" />
          </button>
          <button type="button" class="btn btn-ghost btn-icon px-2" (click)="auth.logout()" aria-label="Salir">
            <app-icon name="logout" class="text-lg" />
          </button>
          <!--
            On a short screen (a phone on its side, a page zoomed to 400 %) the bar of tabs would be
            after the content, thousands of pixels down: the four screens are behind this button,
            under the header. A disclosure: Escape closes it and leaves the focus here. Last in the
            header, so that the next Tab goes into the menu it opened.
          -->
          <button
            #menuButton
            type="button"
            class="btn btn-ghost btn-icon hidden px-2 short:inline-flex"
            aria-label="Menú"
            aria-controls="short-menu"
            [attr.aria-expanded]="menuOpen()"
            (click)="menuOpen.set(!menuOpen())"
            (keydown.escape)="closeMenu($event)"
          >
            <app-icon [name]="menuOpen() ? 'close' : 'menu'" class="text-lg" />
          </button>
        </header>

        <!-- In the page only on a short screen, as its button, where it stands for the bar of tabs. -->
        <nav
          id="short-menu"
          class="hidden border-b border-line bg-surface max-md:short:flex"
          [hidden]="!menuOpen()"
          aria-label="Principal"
        >
          @for (link of links; track link.path) {
            <a
              class="tab-link"
              [routerLink]="link.path"
              routerLinkActive="active"
              ariaCurrentWhenActive="page"
              (click)="closeMenu()"
              (keydown.escape)="closeMenu($event)"
            >
              <app-icon [name]="link.icon" class="text-xl leading-none" />
              {{ link.label }}
            </a>
          }
        </nav>

        <main #main id="contenido" tabindex="-1" class="min-h-0 flex-1 overflow-auto outline-none short:flex-auto short:overflow-visible">
          <router-outlet />
        </main>

        <!-- Not on a short screen, where it would be after everything else: the menu of the header stands for it. -->
        <nav class="flex border-t border-line bg-surface md:hidden short:hidden" aria-label="Principal">
          @for (link of links; track link.path) {
            <a class="tab-link" [routerLink]="link.path" routerLinkActive="active" ariaCurrentWhenActive="page">
              <app-icon [name]="link.icon" class="text-xl leading-none" />
              {{ link.label }}
            </a>
          }
        </nav>
      </div>
    </div>

    @if (remindersOpen()) {
      <app-reminders-panel (closed)="remindersOpen.set(false)" />
    }
    <!-- After everything else: the question it asks goes over the panel or the dialog that asked. -->
    <app-confirm />
  `,
})
export class Shell {
  protected readonly auth = inject(Auth);
  protected readonly theme = inject(Theme);
  protected readonly reminders = inject(Reminders);
  protected readonly live = inject(Live);
  protected readonly remindersOpen = signal(false);
  protected readonly liveHint = computed(() =>
    this.live.connected() ? 'Los cambios de otras personas y del asistente aparecen solos' : 'Sin conexión en vivo. Reintentando; mientras tanto recarga para ver cambios',
  );
  private readonly catalogs = inject(Catalogs);
  private readonly toast = inject(Toast);
  private readonly branding = inject(Branding);
  private readonly main = viewChild.required<ElementRef<HTMLElement>>('main');
  private readonly menuButton = viewChild.required<ElementRef<HTMLButtonElement>>('menuButton');
  /** The four screens, behind the button of the header on a short screen. */
  protected readonly menuOpen = signal(false);

  protected readonly links: { path: string; label: string; icon: IconName }[] = [
    { path: '/casos', label: 'Casos', icon: 'format-list-bulleted' },
    { path: '/tablero', label: 'Tablero', icon: 'view-column-outline' },
    { path: '/dashboard', label: 'Dashboard', icon: 'chart-box-outline' },
    { path: '/configuracion', label: 'Configuración', icon: 'cog-outline' },
  ];

  constructor() {
    // A session may be older than the last change to its user (or than the roles themselves).
    // A rejected session already goes back to the login on its own (authInterceptor).
    this.auth.refresh().catch(() => undefined);
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

  /**
   * Closes the menu of a short screen, and stops the Escape that closed it: the screen under it
   * would hear it too. The focus is left on its button, where it was opened, when it was in the
   * menu: a link pressed there leaves the screen with the menu.
   */
  protected closeMenu(event?: Event): void {
    if (!this.menuOpen()) return;
    event?.stopPropagation();
    event?.preventDefault();
    const button = this.menuButton().nativeElement;
    const within = document.activeElement instanceof Node && (button === document.activeElement || document.getElementById('short-menu')?.contains(document.activeElement));
    this.menuOpen.set(false);
    if (within) button.focus();
  }

  /**
   * "Saltar al contenido": the focus goes to the screen, and the next Tab to its first control.
   * Without following the link, which would put `#contenido` in the address of the screen.
   */
  protected skipToContent(event: MouseEvent): void {
    event.preventDefault();
    this.main().nativeElement.focus();
  }
}
