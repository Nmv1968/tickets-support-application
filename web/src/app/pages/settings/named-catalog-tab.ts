import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import { Catalogs, NAME_MAX } from '../../core/catalogs';
import { Icon } from '../../core/icon';
import { SoftDisabled } from '../../core/soft-disabled';
import { CatalogEntryActions, catalogTab } from './catalog-tab';

/** An entry of a catalog that is a list of names. */
export interface NamedEntry {
  id: number;
  name: string;
  active: boolean;
  /** Cases that have it. With any, it cannot be deleted. */
  tickets: number;
}

/** A catalog that is a list of names, each with its cases: what its tab lists, sends and says. */
export interface NamedCatalog {
  readonly list: (catalogs: Catalogs) => readonly NamedEntry[];
  readonly create: (api: Api, name: string) => Promise<unknown>;
  readonly update: (api: Api, id: number, change: { name?: string; active?: boolean }) => Promise<unknown>;
  readonly remove: (api: Api, id: number) => Promise<unknown>;
  /** The id of the field of a new name, which its label points at. */
  readonly fieldId: string;
  /** "Nombre de la empresa": the label of that field. Followed by the name, it names the field of each row. */
  readonly nameLabel: string;
  readonly placeholder: string;
  /** The longest name the server stores. */
  readonly maxLength: number;
  /** The badge of an inactive entry. */
  readonly inactive: string;
  /** The title of the trash of an entry with cases. */
  readonly inUse: string;
  /** The accessible name of the trash of an entry. */
  readonly removeLabel: (name: string) => string;
  /** What is asked before deleting an entry. */
  readonly removeQuestion: (name: string) => string;
  /** What the list says while it has nothing. */
  readonly empty: string;
  /** Under the list: what renaming, deactivating and deleting do. */
  readonly help: string;
  readonly toasts: { readonly added: string; readonly activated: string; readonly deactivated: string; readonly removed: string };
}

/** The client companies that report cases. A list of names: every case is of one of them. */
export const COMPANIES: NamedCatalog = {
  list: (catalogs) => catalogs.companies(),
  create: (api, name) => api.createCompany(name),
  update: (api, id, change) => api.updateCompany(id, change),
  remove: (api, id) => api.deleteCompany(id),
  fieldId: 'company-name',
  nameLabel: 'Nombre de la empresa',
  placeholder: 'Acme S.A.',
  maxLength: NAME_MAX.company,
  inactive: 'Inactiva',
  inUse: 'Tiene casos: desactívala o cambia la empresa de sus casos',
  removeLabel: (name) => `Eliminar ${name}`,
  removeQuestion: (name) => `¿Eliminar la empresa «${name}»?`,
  empty: 'No hay empresas. Agrega arriba las que reportan casos.',
  help: 'Al cambiar el nombre de una empresa, sus casos pasan a mostrar el nuevo. Una empresa inactiva ya no aparece al registrar casos, pero conserva los que tiene. Solo se puede eliminar una empresa sin casos.',
  toasts: { added: 'Empresa agregada', activated: 'Empresa activada', deactivated: 'Empresa desactivada', removed: 'Empresa eliminada' },
};

/**
 * The people a case can be assigned to. A list of names of its own: whoever attends cases goes
 * here, and being a user of the app has nothing to do with it.
 */
export const ASSIGNEES: NamedCatalog = {
  list: (catalogs) => catalogs.assignees(),
  create: (api, name) => api.createAssignee(name),
  update: (api, id, change) => api.updateAssignee(id, change),
  remove: (api, id) => api.deleteAssignee(id),
  fieldId: 'assignee-name',
  nameLabel: 'Nombre del responsable',
  placeholder: 'Ana Torres',
  maxLength: NAME_MAX.assignee,
  inactive: 'Inactivo',
  inUse: 'Tiene casos asignados: desactívalo o reasigna sus casos',
  removeLabel: (name) => `Eliminar a ${name}`,
  removeQuestion: (name) => `¿Eliminar al responsable «${name}»?`,
  empty: 'No hay responsables. Agrega arriba a quienes atienden los casos.',
  help: 'Un responsable inactivo ya no aparece al registrar o reasignar casos, pero conserva los que tiene. Solo se puede eliminar a quien no tiene casos.',
  toasts: { added: 'Responsable agregado', activated: 'Responsable activado', deactivated: 'Responsable desactivado', removed: 'Responsable eliminado' },
};

/**
 * The tab of a catalog that is a list of names (`COMPANIES`, `ASSIGNEES`): a field to add one,
 * and each entry with its name to edit in place, its cases, and the buttons to deactivate and
 * delete it. `<app-named-catalog-tab [catalog]="companies" />`.
 */
@Component({
  selector: 'app-named-catalog-tab',
  imports: [FormsModule, CatalogEntryActions, Icon, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let c = catalog();
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end" (ngSubmit)="create()">
        <div>
          <label class="label" [for]="c.fieldId">{{ c.nameLabel }}</label>
          <input [id]="c.fieldId" class="input" name="name" [placeholder]="c.placeholder" [maxlength]="c.maxLength" autocomplete="off" [(ngModel)]="name" />
        </div>
        <!-- Keeps the focus once the entry is added and the field is empty again. -->
        <button type="submit" class="btn btn-primary" [appSoftDisabled]="!name().trim() || tab.busy()"><app-icon name="plus" /> Agregar</button>
      </form>

      <div class="card divide-y divide-line">
        @for (entry of entries(); track entry.id) {
          <!-- An inactive entry says so in its badge, and its name is in the softer colour: still readable, as the rest of the row. -->
          <div class="flex flex-wrap items-center gap-2 px-3 py-1.5">
            <input
              class="cell-control min-w-40 flex-1 cursor-text font-medium"
              [class.text-muted]="!entry.active"
              [attr.maxlength]="c.maxLength"
              [value]="entry.name"
              [attr.aria-label]="c.nameLabel + ' ' + entry.name"
              (change)="rename(entry, $event)"
            />
            <app-catalog-entry-actions
              [entry]="entry"
              [name]="entry.name"
              [busy]="tab.busy()"
              [inactiveLabel]="c.inactive"
              [inUse]="c.inUse"
              [removeLabel]="c.removeLabel(entry.name)"
              (toggled)="toggle(entry)"
              (removed)="remove(entry)"
            />
          </div>
        } @empty {
          <p class="p-6 text-center text-muted">{{ c.empty }}</p>
        }
      </div>
      <p class="text-xs text-muted">{{ c.help }}</p>
    </div>
  `,
})
export class NamedCatalogTab {
  private readonly api = inject(Api);
  private readonly catalogs = inject(Catalogs);

  readonly catalog = input.required<NamedCatalog>();

  protected readonly tab = catalogTab();
  protected readonly entries = computed(() => this.catalog().list(this.catalogs));
  protected readonly name = signal('');

  protected async create(): Promise<void> {
    const name = this.name().trim();
    if (!name) return;
    const catalog = this.catalog();
    if (await this.tab.run(() => catalog.create(this.api, name), catalog.toasts.added)) this.name.set('');
  }

  protected rename(entry: NamedEntry, event: Event): Promise<void> {
    return this.tab.rename(event, entry.name, (name) => this.catalog().update(this.api, entry.id, { name }));
  }

  protected toggle(entry: NamedEntry): void {
    const { update, toasts } = this.catalog();
    void this.tab.run(() => update(this.api, entry.id, { active: !entry.active }), entry.active ? toasts.deactivated : toasts.activated);
  }

  protected remove(entry: NamedEntry): Promise<void> {
    const catalog = this.catalog();
    return this.tab.remove(catalog.removeQuestion(entry.name), () => catalog.remove(this.api, entry.id), catalog.toasts.removed);
  }
}
