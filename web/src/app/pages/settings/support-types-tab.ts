import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, model, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Say } from '../../core/announcer';
import { Api } from '../../core/api';
import type { SupportType } from '../../core/api';
import { Catalogs, NAME_MAX } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { HEX_COLOR, TypeChip } from '../../core/type-chip';
import { CatalogEntryActions, catalogTab } from './catalog-tab';

/** The colour a new type starts with: the neutral grey the import and the assistants give the ones they create. */
const DEFAULT_COLOR = '#64748b';

let fields = 0;

/**
 * A colour, chosen with the colour picker of the browser or written as `#rrggbb` in the field
 * next to it. Each of the two follows the other. `color` is always a whole colour, in lowercase:
 * while the field holds anything else, it keeps the last one and the field says what is wrong.
 */
@Component({
  selector: 'app-color-field',
  imports: [Icon, Say],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex items-center gap-1.5">
      <input
        type="color"
        class="h-[2.375rem] w-11 shrink-0 cursor-pointer rounded-control border border-control-line bg-surface p-1"
        [attr.aria-label]="label()"
        [value]="color()"
        (input)="pick($event)"
        (change)="chosen.emit(color())"
      />
      <input
        class="input w-28 font-mono aria-[invalid=true]:border-danger"
        maxlength="7"
        placeholder="#1a2b3c"
        autocomplete="off"
        spellcheck="false"
        [attr.aria-label]="label() + ', en hexadecimal'"
        [attr.aria-invalid]="error() ? 'true' : null"
        [attr.aria-describedby]="error() ? errorId : null"
        [value]="text()"
        (input)="type($event)"
        (change)="leave($event)"
      />
    </div>
    @if (error()) {
      <!--
        In the colour of the text: the danger colour alone is too faint for small text. It stays in the icon and in the border.
        As wide as the two controls and no wider (w-0 min-w-full): the message wraps under them instead of pushing its neighbours aside.
        Said at once as it comes (see Say): an alert that comes with its words may not be read.
      -->
      <p class="mt-1 w-0 min-w-full text-xs" appSay sayAs="assertive" [id]="errorId">
        <app-icon name="alert-circle-outline" class="text-danger" /> El color debe ser un código hexadecimal como #1a2b3c
      </p>
    }
  `,
})
export class ColorField {
  readonly color = model.required<string>();
  /** Names the two controls for who does not see them: "Color de Capacitación". */
  readonly label = input.required<string>();
  /** The person settled on a colour: closed the picker, or left the hex field with a colour in it. */
  readonly chosen = output<string>();

  /** What the hex field holds. Follows the colour, except while the person writes in it. */
  protected readonly text = linkedSignal(() => this.color());
  /** False while the hex field holds something that is not a colour. */
  readonly valid = computed(() => HEX_COLOR.test(this.text().trim()));
  /**
   * The hex field was left with something that is not a colour. Not raised while typing: every
   * colour is something else until its last character.
   */
  protected readonly error = signal(false);
  protected readonly errorId = `color-field-error-${++fields}`;

  /** Puts a colour in both controls, over one the person chose and was not kept. */
  show(color: string): void {
    this.color.set(color);
    this.text.set(color);
    this.error.set(false);
  }

  protected pick(event: Event): void {
    this.show((event.target as HTMLInputElement).value);
  }

  protected type(event: Event): void {
    const typed = (event.target as HTMLInputElement).value;
    const color = typed.trim().toLowerCase();
    if (HEX_COLOR.test(color)) {
      this.color.set(color);
      this.error.set(false);
    }
    // After the colour, which the text would otherwise follow: the field keeps what was typed
    // as it was typed, and is not rewritten under the person's hands.
    this.text.set(typed);
  }

  /** The hex field was left, or Enter was pressed in it. */
  protected leave(event: Event): void {
    this.type(event);
    if (!this.valid()) {
      this.error.set(true);
      return;
    }
    this.text.set(this.color());
    this.chosen.emit(this.color());
  }
}

/** "Tipos de soporte": the labels a case can carry, each with a name and a colour of its own. */
@Component({
  selector: 'app-support-types-tab',
  imports: [FormsModule, TypeChip, ColorField, CatalogEntryActions, Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Aligned at the top: the message under the colour must not move the other fields. -->
      <form class="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-start" (ngSubmit)="create()">
        <div>
          <label class="label" for="type-name">Nombre del tipo de soporte</label>
          <input id="type-name" class="input" name="name" placeholder="Falla del sistema" [maxlength]="nameMax" autocomplete="off" [(ngModel)]="name" />
        </div>
        <div>
          <span class="label">Color</span>
          <app-color-field #newColor label="Color del tipo nuevo" [(color)]="color" />
        </div>
        <!-- Keeps the focus once the type is added and the field is empty again. -->
        <button type="submit" class="btn btn-primary sm:mt-5" [appSoftDisabled]="!canCreate()"><app-icon name="plus" /> Agregar</button>
        <p class="flex flex-wrap items-center gap-2 text-xs text-muted sm:col-span-3">
          Así se verá en los casos:
          <app-type-chip [type]="preview()" />
        </p>
      </form>

      <div class="card divide-y divide-line">
        @for (type of catalogs.supportTypes(); track type.id) {
          <!-- An inactive type says so in its badge, and its name is in the softer colour: still readable, as the rest of the row. -->
          <div class="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <app-type-chip [type]="type" />
            <input
              class="cell-control min-w-40 flex-1 cursor-text font-medium"
              [class.text-muted]="!type.active"
              [attr.maxlength]="nameMax"
              [value]="type.name"
              [attr.aria-label]="'Nombre del tipo ' + type.name"
              (change)="rename(type, $event)"
            />
            <app-color-field #field [color]="type.color" [label]="'Color de ' + type.name" (chosen)="recolor(type, $event, field)" />
            <app-catalog-entry-actions
              [entry]="type"
              [name]="type.name"
              [busy]="tab.busy()"
              inactiveLabel="Inactivo"
              inUse="Está en casos: desactívalo o quítalo de esos casos"
              [removeLabel]="'Eliminar ' + type.name"
              (toggled)="toggle(type)"
              (removed)="remove(type)"
            />
          </div>
        } @empty {
          <p class="p-6 text-center text-muted">No hay tipos de soporte. Agrega arriba el primero.</p>
        }
      </div>
      <p class="text-xs text-muted">
        Un caso puede llevar uno o varios tipos de soporte, o ninguno: dicen qué clase de atención fue (una falla del sistema, una duda de uso, una capacitación…). Un tipo
        inactivo ya no se ofrece en los casos nuevos, pero sigue en los que lo llevan. Solo se puede eliminar un tipo que no está en ningún caso.
      </p>
    </div>
  `,
})
export class SupportTypesTab {
  private readonly api = inject(Api);
  protected readonly catalogs = inject(Catalogs);

  /** Reads the catalogs on arrival, and makes the writes (see catalogTab). */
  protected readonly tab = catalogTab();
  protected readonly nameMax = NAME_MAX.supportType;
  protected readonly name = signal('');
  protected readonly color = signal(DEFAULT_COLOR);
  /** The colour field of the type being added. */
  private readonly newColor = viewChild.required<ColorField>('newColor');
  protected readonly canCreate = computed(() => !!this.name().trim() && this.newColor().valid() && !this.tab.busy());
  protected readonly preview = computed(() => ({ name: this.name().trim() || 'Tipo de soporte', color: this.color() }));

  protected async create(): Promise<void> {
    const name = this.name().trim();
    // Enter in the name sends the form whatever the hex field holds.
    if (!name || !this.newColor().valid()) return;
    // The colour stays for the next one: a team that adds several picks each from the last.
    if (await this.tab.run(() => this.api.createSupportType({ name, color: this.color() }), 'Tipo de soporte agregado')) this.name.set('');
  }

  protected rename(type: SupportType, event: Event): Promise<void> {
    return this.tab.rename(event, type.name, (name) => this.api.updateSupportType(type.id, { name }));
  }

  protected async recolor(type: SupportType, color: string, field: ColorField): Promise<void> {
    const recolored = color !== type.color && (await this.tab.run(() => this.api.updateSupportType(type.id, { color }), 'Color actualizado'));
    // The same colour or a refused one: the field goes back to the colour the type has.
    if (!recolored) field.show(type.color);
  }

  protected toggle(type: SupportType): void {
    void this.tab.run(() => this.api.updateSupportType(type.id, { active: !type.active }), type.active ? 'Tipo de soporte desactivado' : 'Tipo de soporte activado');
  }

  protected remove(type: SupportType): Promise<void> {
    return this.tab.remove(`¿Eliminar el tipo de soporte «${type.name}»?`, () => this.api.deleteSupportType(type.id), 'Tipo de soporte eliminado');
  }
}
