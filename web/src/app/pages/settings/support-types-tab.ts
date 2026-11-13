import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, linkedSignal, model, output, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { SupportType } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { Toast } from '../../core/toast';
import { TypeChip } from '../../core/type-chip';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

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
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <div class="flex items-center gap-1.5">
      <input
        type="color"
        class="h-[2.375rem] w-11 shrink-0 cursor-pointer rounded-control border border-line bg-surface p-1"
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
      -->
      <p class="mt-1 w-0 min-w-full text-xs" role="alert" [id]="errorId">
        <i class="mdi mdi-alert-circle-outline text-danger" aria-hidden="true"></i> El color debe ser un código hexadecimal como #1a2b3c
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
  imports: [FormsModule, TypeChip, ColorField],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Aligned at the top: the message under the colour must not move the other fields. -->
      <form class="card grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-start" (ngSubmit)="create()">
        <div>
          <label class="label" for="type-name">Nombre del tipo de soporte</label>
          <input id="type-name" class="input" name="name" placeholder="Falla del sistema" maxlength="60" autocomplete="off" [(ngModel)]="name" />
        </div>
        <div>
          <span class="label">Color</span>
          <app-color-field #newColor label="Color del tipo nuevo" [(color)]="color" />
        </div>
        <button type="submit" class="btn btn-primary sm:mt-5" [disabled]="!canCreate()"><i class="mdi mdi-plus" aria-hidden="true"></i> Agregar</button>
        <p class="flex flex-wrap items-center gap-2 text-xs text-muted sm:col-span-3">
          Así se verá en los casos:
          <app-type-chip [type]="preview()" />
        </p>
      </form>

      <div class="card divide-y divide-line">
        @for (type of catalogs.supportTypes(); track type.id) {
          <div class="flex flex-wrap items-center gap-2 px-3 py-1.5" [class.opacity-60]="!type.active">
            <app-type-chip [type]="type" />
            <input
              class="cell-control min-w-40 flex-1 cursor-text font-medium"
              maxlength="60"
              [value]="type.name"
              [attr.aria-label]="'Nombre del tipo ' + type.name"
              (change)="rename(type, $event)"
            />
            <app-color-field #field [color]="type.color" [label]="'Color de ' + type.name" (chosen)="recolor(type, $event, field)" />
            <!-- Kept together: on a narrow screen the whole group goes under the name, to the right. -->
            <div class="ml-auto flex items-center gap-2">
              <span class="text-xs text-muted">{{ type.tickets }} {{ type.tickets === 1 ? 'caso' : 'casos' }}</span>
              @if (!type.active) {
                <span class="badge bg-elevated text-muted">Inactivo</span>
              }
              <button type="button" class="btn btn-soft px-2 py-1 text-xs" [disabled]="busy()" (click)="toggle(type)">{{ type.active ? 'Desactivar' : 'Activar' }}</button>
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-danger disabled:text-muted"
                [disabled]="busy() || type.tickets > 0"
                [title]="type.tickets > 0 ? 'Está en casos: desactívalo o quítalo de esos casos' : 'Eliminar'"
                [attr.aria-label]="'Eliminar ' + type.name"
                (click)="remove(type)"
              >
                <i class="mdi mdi-trash-can-outline text-base leading-none" aria-hidden="true"></i>
              </button>
            </div>
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
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly catalogs = inject(Catalogs);

  protected readonly name = signal('');
  protected readonly color = signal(DEFAULT_COLOR);
  /** A write is on its way: a second click must not send it twice. */
  protected readonly busy = signal(false);
  /** The colour field of the type being added. */
  private readonly newColor = viewChild.required<ColorField>('newColor');
  protected readonly canCreate = computed(() => !!this.name().trim() && this.newColor().valid() && !this.busy());
  protected readonly preview = computed(() => ({ name: this.name().trim() || 'Tipo de soporte', color: this.color() }));

  constructor() {
    // The number of cases of each type moves with every case that takes or drops it: read it again on arrival.
    this.catalogs.reload().catch((error: unknown) => this.toast.error(error));
  }

  private async run(action: () => Promise<unknown>, done: string): Promise<boolean> {
    if (this.busy()) return false;
    this.busy.set(true);
    try {
      await action();
      this.toast.ok(done);
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    } finally {
      // Also after a refusal: the list on screen may be what was out of date.
      await this.catalogs.reload().catch(() => undefined);
      this.busy.set(false);
    }
  }

  protected async create(): Promise<void> {
    const name = this.name().trim();
    // Enter in the name sends the form whatever the hex field holds.
    if (!name || !this.newColor().valid()) return;
    // The colour stays for the next one: a team that adds several picks each from the last.
    if (await this.run(() => this.api.createSupportType({ name, color: this.color() }), 'Tipo de soporte agregado')) this.name.set('');
  }

  protected async rename(type: SupportType, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const name = input.value.trim();
    const renamed = !!name && name !== type.name && (await this.run(() => this.api.updateSupportType(type.id, { name }), 'Nombre actualizado'));
    // An empty or refused name: the field goes back to the name the type has.
    if (!renamed) input.value = type.name;
  }

  protected async recolor(type: SupportType, color: string, field: ColorField): Promise<void> {
    const recolored = color !== type.color && (await this.run(() => this.api.updateSupportType(type.id, { color }), 'Color actualizado'));
    // The same colour or a refused one: the field goes back to the colour the type has.
    if (!recolored) field.show(type.color);
  }

  protected toggle(type: SupportType): void {
    void this.run(() => this.api.updateSupportType(type.id, { active: !type.active }), type.active ? 'Tipo de soporte desactivado' : 'Tipo de soporte activado');
  }

  /** Asked first: it cannot be undone, and its button is next to the one that only deactivates. */
  protected async remove(type: SupportType): Promise<void> {
    if (!(await this.confirm.ask({ title: `¿Eliminar el tipo de soporte «${type.name}»?`, confirmLabel: 'Eliminar', danger: true }, this.destroyRef))) return;
    await this.run(() => this.api.deleteSupportType(type.id), 'Tipo de soporte eliminado');
  }
}
