import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { Company } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { Confirm } from '../../core/confirm';
import { Toast } from '../../core/toast';

/** The client companies that report cases. A list of names: every case is of one of them. */
@Component({
  selector: 'app-companies-tab',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <form class="card grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-end" (ngSubmit)="create()">
        <div>
          <label class="label" for="company-name">Nombre de la empresa</label>
          <input id="company-name" class="input" name="name" placeholder="Acme S.A." maxlength="200" autocomplete="off" [(ngModel)]="name" />
        </div>
        <button type="submit" class="btn btn-primary" [disabled]="!name().trim() || busy()"><i class="mdi mdi-plus" aria-hidden="true"></i> Agregar</button>
      </form>

      <div class="card divide-y divide-line">
        @for (company of catalogs.companies(); track company.id) {
          <div class="flex flex-wrap items-center gap-2 px-3 py-1.5" [class.opacity-60]="!company.active">
            <input
              class="cell-control min-w-40 flex-1 cursor-text font-medium"
              maxlength="200"
              [value]="company.name"
              [attr.aria-label]="'Nombre de la empresa ' + company.name"
              (change)="rename(company, $event)"
            />
            <!-- Kept together: on a narrow screen the whole group goes under the name, to the right. -->
            <div class="ml-auto flex items-center gap-2">
              <span class="text-xs text-muted">{{ company.tickets }} {{ company.tickets === 1 ? 'caso' : 'casos' }}</span>
              @if (!company.active) {
                <span class="badge bg-elevated text-muted">Inactiva</span>
              }
              <button type="button" class="btn btn-soft px-2 py-1 text-xs" [disabled]="busy()" (click)="toggle(company)">{{ company.active ? 'Desactivar' : 'Activar' }}</button>
              <button
                type="button"
                class="btn btn-ghost px-2 py-1 text-danger disabled:text-muted"
                [disabled]="busy() || company.tickets > 0"
                [title]="company.tickets > 0 ? 'Tiene casos: desactívala o cambia la empresa de sus casos' : 'Eliminar'"
                [attr.aria-label]="'Eliminar ' + company.name"
                (click)="remove(company)"
              >
                <i class="mdi mdi-trash-can-outline text-base leading-none" aria-hidden="true"></i>
              </button>
            </div>
          </div>
        } @empty {
          <p class="p-6 text-center text-muted">No hay empresas. Agrega arriba las que reportan casos.</p>
        }
      </div>
      <p class="text-xs text-muted">
        Al cambiar el nombre de una empresa, sus casos pasan a mostrar el nuevo. Una empresa inactiva ya no aparece al registrar casos, pero conserva los que tiene. Solo se
        puede eliminar una empresa sin casos.
      </p>
    </div>
  `,
})
export class CompaniesTab {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);
  private readonly confirm = inject(Confirm);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly catalogs = inject(Catalogs);

  protected readonly name = signal('');
  /** A write is on its way: a second click must not send it twice. */
  protected readonly busy = signal(false);

  constructor() {
    // The number of cases of each company moves with every case registered: read it again on arrival.
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
    if (!name) return;
    if (await this.run(() => this.api.createCompany(name), 'Empresa agregada')) this.name.set('');
  }

  protected async rename(company: Company, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const name = input.value.trim();
    const renamed = !!name && name !== company.name && (await this.run(() => this.api.updateCompany(company.id, { name }), 'Nombre actualizado'));
    // An empty or refused name: the field goes back to the name the company has.
    if (!renamed) input.value = company.name;
  }

  protected toggle(company: Company): void {
    void this.run(() => this.api.updateCompany(company.id, { active: !company.active }), company.active ? 'Empresa desactivada' : 'Empresa activada');
  }

  /** Asked first: it cannot be undone, and its button is next to the one that only deactivates. */
  protected async remove(company: Company): Promise<void> {
    if (!(await this.confirm.ask({ title: `¿Eliminar la empresa «${company.name}»?`, confirmLabel: 'Eliminar', danger: true }, this.destroyRef))) return;
    await this.run(() => this.api.deleteCompany(company.id), 'Empresa eliminada');
  }
}
