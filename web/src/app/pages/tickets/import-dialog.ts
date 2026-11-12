import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Api } from '../../core/api';
import type { ImportResult } from '../../core/api';
import { Toast } from '../../core/toast';
import { STATUS_LABEL, downloadBlob, errorMessage, formatDay } from '../../core/ui';

const COLUMN_LABEL: Record<keyof ImportResult['columns'], string> = {
  date: 'Fecha',
  company: 'Empresa',
  description: 'Descripción',
  status: 'Estado',
  assignee: 'Responsable',
  note: 'Observación',
};

/** Brings the existing spreadsheet into the app: first a preview, then the import. */
@Component({
  selector: 'app-import-dialog',
  imports: [FormsModule, A11yModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop" (click)="onBackdrop($event)">
      <div class="card flex max-h-full w-full max-w-2xl flex-col" role="dialog" aria-modal="true" aria-labelledby="import-title" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <i class="mdi mdi-file-import-outline text-xl text-primary" aria-hidden="true"></i>
          <h2 id="import-title" class="font-semibold">Importar hoja de casos</h2>
          <button type="button" class="btn btn-ghost ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar">
            <i class="mdi mdi-close text-lg" aria-hidden="true"></i>
          </button>
        </header>

        <div class="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          <p class="text-muted">
            Archivo <strong>.xlsx</strong> o <strong>.csv</strong> con encabezados como los de la hoja actual: Fecha, Empresa, Descripción, Estado, Responsable, Observación.
            Solo Empresa y Descripción son obligatorias. La columna Fecha se toma como fecha del caso; la fecha de registro de todos será la de hoy.
          </p>

          <div class="flex flex-wrap items-center gap-3 rounded-control border border-line px-3 py-2.5">
            <i class="mdi mdi-file-excel-outline text-2xl text-success" aria-hidden="true"></i>
            <p class="min-w-48 flex-1 text-xs text-muted">
              <strong class="block text-sm text-ink">¿Vas a armar la hoja desde cero?</strong>
              Usa la plantilla: trae las columnas listas, la fecha como fecha y listas para elegir el estado y el responsable. Llénala y súbela aquí.
            </p>
            <button type="button" class="btn btn-soft" [disabled]="downloading()" (click)="downloadTemplate()">
              <i class="mdi" [class]="downloading() ? 'mdi-loading mdi-spin' : 'mdi-download'" aria-hidden="true"></i>
              Descargar plantilla
            </button>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="import-file">Archivo</label>
              <input id="import-file" class="input" type="file" accept=".xlsx,.csv" (change)="onFile($event)" />
            </div>
            <div>
              <label class="label" for="import-order">Fechas escritas como texto</label>
              <select id="import-order" class="input" [ngModel]="dateOrder()" (ngModelChange)="setOrder($event)">
                <option value="mdy">mes/día/año (7/27/2023)</option>
                <option value="dmy">día/mes/año (27/7/2023)</option>
              </select>
            </div>
          </div>

          @if (error()) {
            <p class="alert-error" role="alert">{{ error() }}</p>
          }

          @if (preview(); as p) {
            <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div class="rounded-control bg-elevated p-2.5">
                <div class="text-xl font-semibold text-primary">{{ p.toCreate }}</div>
                <div class="text-xs text-muted">Casos a importar</div>
              </div>
              <div class="rounded-control bg-elevated p-2.5">
                <div class="text-xl font-semibold">{{ p.duplicates }}</div>
                <div class="text-xs text-muted">Ya existen (se omiten)</div>
              </div>
              <div class="rounded-control bg-elevated p-2.5">
                <div class="text-xl font-semibold">{{ p.skippedEmpty }}</div>
                <div class="text-xs text-muted">Filas vacías</div>
              </div>
              <div class="rounded-control bg-elevated p-2.5">
                <div class="text-xl font-semibold">{{ p.newPeople.length }}</div>
                <div class="text-xs text-muted">Responsables nuevos</div>
              </div>
            </div>

            <div class="flex flex-wrap gap-1.5 text-xs">
              @for (column of columnKeys; track column) {
                <span class="badge" [class]="p.columns[column] ? 'st-RESOLVED' : 'bg-elevated text-muted'">
                  {{ columnLabel[column] }}: {{ p.columns[column] ?? 'no encontrada' }}
                </span>
              }
            </div>

            @if (p.newPeople.length) {
              <p class="text-xs text-muted">
                Se crean como responsables sin acceso: <strong>{{ p.newPeople.join(', ') }}</strong>.
                Para que inicien sesión, ponles contraseña en Configuración &gt; Usuarios.
              </p>
            }

            @if (p.sample.length) {
              <div class="overflow-auto rounded-control border border-line">
                <table class="w-full text-left text-xs">
                  <thead class="bg-elevated text-muted">
                    <tr>
                      <th class="px-2 py-1.5">Fecha</th>
                      <th class="px-2 py-1.5">Empresa</th>
                      <th class="px-2 py-1.5">Descripción</th>
                      <th class="px-2 py-1.5">Estado</th>
                      <th class="px-2 py-1.5">Responsable</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (row of p.sample; track $index) {
                      <tr class="border-t border-line">
                        <td class="px-2 py-1.5 whitespace-nowrap">{{ formatDay(row.date) }}</td>
                        <td class="px-2 py-1.5">{{ row.company }}</td>
                        <td class="px-2 py-1.5">{{ row.description }}</td>
                        <td class="px-2 py-1.5 whitespace-nowrap">{{ statusLabel[row.status] }}</td>
                        <td class="px-2 py-1.5">{{ row.assignee ?? '' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
              <p class="text-2xs text-muted">Primeras filas. Verifica que las fechas se leen bien antes de importar.</p>
            }
          }
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancelar</button>
          <button type="button" class="btn btn-primary" [disabled]="busy() || !preview()?.toCreate" (click)="run()">
            {{ busy() ? 'Procesando…' : 'Importar ' + (preview()?.toCreate ?? 0) + ' casos' }}
          </button>
        </footer>
      </div>
    </div>
  `,
})
export class ImportDialog {
  private readonly api = inject(Api);
  private readonly toast = inject(Toast);

  readonly closed = output<void>();
  readonly imported = output<void>();

  protected readonly columnLabel = COLUMN_LABEL;
  protected readonly columnKeys = Object.keys(COLUMN_LABEL) as (keyof ImportResult['columns'])[];
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly formatDay = formatDay;

  protected readonly dateOrder = signal<'mdy' | 'dmy'>('mdy');
  protected readonly preview = signal<ImportResult | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private file: File | null = null;
  protected readonly downloading = signal(false);

  /** The spreadsheet to fill in, already in the format the import reads. */
  protected async downloadTemplate(): Promise<void> {
    this.downloading.set(true);
    try {
      downloadBlob(await this.api.importTemplate(), 'plantilla-casos-soporte.xlsx');
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.downloading.set(false);
    }
  }

  /** Returns nothing on purpose: a handler that evaluates to false makes Angular cancel the click (see AiDraftDialog). */
  protected onBackdrop(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.closed.emit();
  }

  protected onFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    void this.analyze();
  }

  protected setOrder(order: 'mdy' | 'dmy'): void {
    this.dateOrder.set(order);
    void this.analyze();
  }

  private async analyze(): Promise<void> {
    this.preview.set(null);
    this.error.set('');
    if (!this.file) return;
    this.busy.set(true);
    try {
      this.preview.set(await this.api.importFile(this.file, true, this.dateOrder()));
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }

  protected async run(): Promise<void> {
    if (!this.file) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const result = await this.api.importFile(this.file, false, this.dateOrder());
      this.toast.ok(`${result.toCreate} casos importados`);
      this.imported.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.busy.set(false);
    }
  }
}
