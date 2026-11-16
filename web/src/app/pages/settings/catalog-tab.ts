import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { Toast } from '../../core/toast';

/** What a catalog tab of Configuración does with its writes (see catalogTab). */
export interface CatalogTab {
  /** A write is on its way: a second click must not send it twice. */
  readonly busy: Signal<boolean>;
  /** Sends a write, says how it went, and reads the catalogs again. True when it was stored. */
  run(action: () => Promise<unknown>, done: string): Promise<boolean>;
  /** A name edited in its row, sent when the field is left. The field holds the name the entry has unless the new one is stored. */
  rename(event: Event, current: string, save: (name: string) => Promise<unknown>): Promise<void>;
  /** Asks first: it cannot be undone, and its button is next to the one that only deactivates. */
  remove(question: string, action: () => Promise<unknown>, done: string): Promise<void>;
}

/**
 * What every catalog tab of Configuración shares (the companies, the responsibles, the support
 * types). On arrival it reads the catalogs again: the number of cases of each entry moves with
 * every case registered or changed. Then its writes go one at a time, each said in a toast, and
 * each ends with the catalogs read again, also after a refusal: the list on screen may be what
 * was out of date.
 *
 * For a field of the tab (`protected readonly tab = catalogTab()`): it injects what it needs.
 */
export function catalogTab(): CatalogTab {
  const catalogs = inject(Catalogs);
  const toast = inject(Toast);
  const confirm = inject(Confirm);
  /** Given with the question: with the tab closed, the question goes with it. */
  const destroyRef = inject(DestroyRef);
  const busy = signal(false);

  catalogs.reload().catch((error: unknown) => toast.error(error));

  const run = async (action: () => Promise<unknown>, done: string): Promise<boolean> => {
    if (busy()) return false;
    busy.set(true);
    try {
      await action();
      toast.ok(done);
      return true;
    } catch (error) {
      toast.error(error);
      return false;
    } finally {
      await catalogs.reload().catch(() => undefined);
      busy.set(false);
    }
  };

  return {
    busy: busy.asReadonly(),
    run,
    async rename(event, current, save) {
      const field = event.target as HTMLInputElement;
      const name = field.value.trim();
      const renamed = !!name && name !== current && (await run(() => save(name), 'Nombre actualizado'));
      // An empty or refused name: the field goes back to the name the entry has.
      if (!renamed) field.value = current;
    },
    async remove(question, action, done) {
      if (!(await confirm.ask({ title: question, confirmLabel: 'Eliminar', danger: true }, destroyRef))) return;
      await run(action, done);
    },
  };
}

let rows = 0;

/**
 * The end of a row of a catalog: how many cases the entry has, whether it is inactive, and the
 * buttons to deactivate or activate it and to delete it, each named with the entry ("Desactivar
 * Acme"): a list of them all said "Desactivar". An entry with cases cannot be deleted: its trash
 * says what to do instead, and stays within reach of the keyboard to say it (aria-disabled, with
 * the reason as its description; the help of the tab says it on screen). Pressed, it says it in a
 * toast, as the API would have refused it: its title shows only under a mouse that stays on it.
 *
 * Kept together: on a narrow screen the whole group goes under the name, to the right.
 */
@Component({
  selector: 'app-catalog-entry-actions',
  imports: [Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ml-auto flex items-center gap-2' },
  template: `
    @let e = entry();
    <span class="text-xs text-muted">{{ e.tickets }} {{ e.tickets === 1 ? 'caso' : 'casos' }}</span>
    @if (!e.active) {
      <span class="badge bg-elevated text-muted">{{ inactiveLabel() }}</span>
    }
    <button type="button" class="btn btn-soft px-2 py-1 text-xs" [appSoftDisabled]="busy()" [attr.aria-label]="(e.active ? 'Desactivar ' : 'Activar ') + name()" (click)="toggled.emit()">
      {{ e.active ? 'Desactivar' : 'Activar' }}
    </button>
    <button
      type="button"
      class="btn btn-ghost btn-icon px-2 py-1 text-danger aria-disabled:text-muted"
      [appSoftDisabled]="busy() || e.tickets > 0"
      [title]="e.tickets > 0 ? inUse() : 'Eliminar'"
      [attr.aria-label]="removeLabel()"
      [attr.aria-describedby]="e.tickets > 0 ? inUseId : null"
      (click)="removed.emit()"
      (refused)="sayInUse()"
    >
      <app-icon name="trash-can-outline" class="text-base leading-none" />
    </button>
    <span hidden [id]="inUseId">{{ inUse() }}</span>
  `,
})
export class CatalogEntryActions {
  readonly entry = input.required<{ active: boolean; tickets: number }>();
  /** The name of the entry, which names its buttons. */
  readonly name = input.required<string>();
  readonly busy = input(false);
  /** The badge of an inactive entry, in the gender of its noun: "Inactiva", "Inactivo". */
  readonly inactiveLabel = input.required<string>();
  /** Why an entry with cases cannot be deleted, and what to do instead: the title of its disabled trash. */
  readonly inUse = input.required<string>();
  /** The accessible name of the trash: "Eliminar Acme". */
  readonly removeLabel = input.required<string>();
  readonly toggled = output<void>();
  readonly removed = output<void>();

  protected readonly inUseId = `catalog-in-use-${++rows}`;
  private readonly toast = inject(Toast);

  /** The trash of an entry with cases was pressed: why it cannot be deleted, and what to do instead. Not while a write is on its way. */
  protected sayInUse(): void {
    if (this.entry().tickets > 0 && !this.busy()) this.toast.error(this.inUse());
  }
}
