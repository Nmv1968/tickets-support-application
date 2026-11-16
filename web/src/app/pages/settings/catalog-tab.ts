import { ChangeDetectionStrategy, Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import type { Signal } from '@angular/core';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { Icon } from '../../core/icon';
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

/**
 * The end of a row of a catalog: how many cases the entry has, whether it is inactive, and the
 * buttons to deactivate or activate it and to delete it. An entry with cases cannot be deleted:
 * its trash is disabled, and says what to do instead.
 *
 * Kept together: on a narrow screen the whole group goes under the name, to the right.
 */
@Component({
  selector: 'app-catalog-entry-actions',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ml-auto flex items-center gap-2' },
  template: `
    @let e = entry();
    <span class="text-xs text-muted">{{ e.tickets }} {{ e.tickets === 1 ? 'caso' : 'casos' }}</span>
    @if (!e.active) {
      <span class="badge bg-elevated text-muted">{{ inactiveLabel() }}</span>
    }
    <button type="button" class="btn btn-soft px-2 py-1 text-xs" [disabled]="busy()" (click)="toggled.emit()">{{ e.active ? 'Desactivar' : 'Activar' }}</button>
    <button
      type="button"
      class="btn btn-ghost px-2 py-1 text-danger disabled:text-muted"
      [disabled]="busy() || e.tickets > 0"
      [title]="e.tickets > 0 ? inUse() : 'Eliminar'"
      [attr.aria-label]="removeLabel()"
      (click)="removed.emit()"
    >
      <app-icon name="trash-can-outline" class="text-base leading-none" />
    </button>
  `,
})
export class CatalogEntryActions {
  readonly entry = input.required<{ active: boolean; tickets: number }>();
  readonly busy = input(false);
  /** The badge of an inactive entry, in the gender of its noun: "Inactiva", "Inactivo". */
  readonly inactiveLabel = input.required<string>();
  /** Why an entry with cases cannot be deleted, and what to do instead: the title of its disabled trash. */
  readonly inUse = input.required<string>();
  /** The accessible name of the trash: "Eliminar Acme". */
  readonly removeLabel = input.required<string>();
  readonly toggled = output<void>();
  readonly removed = output<void>();
}
