import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Branding } from './branding';
import { Icon } from './icon';

const BOX = { sm: 'size-8', md: 'size-9', lg: 'size-11', xl: 'size-20' } as const;
const ICON = { sm: 'text-lg', md: 'text-xl', lg: 'text-2xl', xl: 'text-5xl' } as const;

/**
 * The mark of the app: the company logo when one is set (Configuración > Logo), otherwise the
 * default icon on the brand colour. Decorative: the name of the app is always written beside it.
 */
@Component({
  selector: 'app-logo',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class]': 'box()' },
  template: `
    @if (branding.logoUrl(); as url) {
      <img class="size-full object-contain" [src]="url" alt="" />
    } @else {
      <app-icon name="lifebuoy" [class]="icon()" />
    }
  `,
})
export class AppLogo {
  protected readonly branding = inject(Branding);

  readonly size = input<keyof typeof BOX>('md');

  protected readonly icon = computed(() => ICON[this.size()]);
  /** A logo brings its own colours and shape: the brand-coloured square is only for the default icon. */
  protected readonly box = computed(
    () => `grid shrink-0 place-items-center overflow-hidden rounded-control ${BOX[this.size()]} ${this.branding.logoUrl() ? '' : 'bg-primary-fill text-white'}`,
  );
}
