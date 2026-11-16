import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { Say } from '../../core/announcer';
import { Api } from '../../core/api';
import { AppLogo } from '../../core/app-logo';
import { Branding } from '../../core/branding';
import { Confirm } from '../../core/confirm';
import { Icon } from '../../core/icon';
import { Toast } from '../../core/toast';
import { errorMessage, toSmallPng } from '../../core/ui';

/** Longest side of the stored logo. It is shown at most 80 px wide; this leaves room for sharp screens. */
const LOGO_SIDE = 256;

/** The company logo: upload one, see it as it will look, or go back to the default icon. */
@Component({
  selector: 'app-branding-tab',
  imports: [AppLogo, Icon, Say],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card max-w-2xl space-y-4 p-4">
      <div>
        <h2 class="font-semibold">Logo de la empresa</h2>
        <p class="text-xs text-muted">
          Reemplaza el icono del menú y de la pantalla de ingreso, y se usa también como icono de la pestaña del navegador. Lo ven todas las personas que
          usan el sistema.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-4">
        <app-logo size="xl" class="border border-line" />
        <div class="min-w-48 flex-1 space-y-2">
          <div class="flex flex-wrap gap-2">
            <!-- Each says in words what it is doing: the icon that turns stands still with less motion asked for. -->
            <button type="button" class="btn btn-primary" [disabled]="busy() !== ''" (click)="picker.click()">
              <app-icon [name]="busy() === 'upload' ? 'loading' : 'upload'" />
              {{ busy() === 'upload' ? 'Subiendo…' : branding.logoUrl() ? 'Cambiar imagen' : 'Subir imagen' }}
            </button>
            @if (branding.logoUrl()) {
              <button type="button" class="btn btn-ghost" [disabled]="busy() !== ''" (click)="remove()">{{ busy() === 'remove' ? 'Quitando…' : 'Quitar logo' }}</button>
            }
          </div>
          <p class="text-2xs text-muted">
            PNG, JPG, WebP o SVG. Mejor una imagen cuadrada con fondo transparente. Se guarda reducida a {{ side }} px, así que no importa el tamaño del
            archivo original.
          </p>
        </div>
      </div>

      <input #picker type="file" class="sr-only" tabindex="-1" aria-label="Imagen del logo" accept="image/png,image/jpeg,image/webp,image/svg+xml" (change)="upload(picker)" />

      <!-- Said at once as it comes (see Say): an alert that comes with its words may not be read. -->
      @if (error()) {
        <p class="alert-error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
      }
    </div>
  `,
})
export class BrandingTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  protected readonly branding = inject(Branding);

  protected readonly side = LOGO_SIDE;
  /** What is being done to the logo, if anything: one at a time. */
  protected readonly busy = signal<'' | 'upload' | 'remove'>('');
  protected readonly error = signal('');

  protected async upload(picker: HTMLInputElement): Promise<void> {
    const file = picker.files?.[0];
    // Emptied at once: choosing the same file again must count as a new choice.
    picker.value = '';
    if (!file) return;
    this.busy.set('upload');
    this.error.set('');
    try {
      const { logoVersion } = await this.api.saveLogo(await toSmallPng(file, LOGO_SIDE));
      this.branding.use(logoVersion);
      this.toast.ok('Logo actualizado');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set('');
    }
  }

  protected async remove(): Promise<void> {
    if (!(await this.confirm.ask({ title: '¿Quitar el logo y volver al icono por defecto?', confirmLabel: 'Quitar', danger: true }))) return;
    this.busy.set('remove');
    this.error.set('');
    try {
      await this.api.removeLogo();
      this.branding.use(null);
      this.toast.ok('Logo eliminado');
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set('');
    }
  }
}
