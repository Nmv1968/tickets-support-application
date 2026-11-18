import { A11yModule } from '@angular/cdk/a11y';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Say } from '../../core/announcer';
import { Api } from '../../core/api';
import type { ImportResult, ImportUnknown } from '../../core/api';
import { BackdropClick } from '../../core/backdrop-click';
import { Hint } from '../../core/hint';
import { Icon } from '../../core/icon';
import { latest } from '../../core/loading';
import { SELECT } from '../../core/select';
import { SoftDisabled } from '../../core/soft-disabled';
import { Toast } from '../../core/toast';
import { PRIORITY_LABEL, STATUS_LABEL, downloadBlob, errorMessage, formatCaseDate } from '../../core/ui';

type DateOrder = 'mdy' | 'dmy';

const COLUMN_LABEL: Record<keyof ImportResult['columns'], string> = {
  date: 'Fecha',
  time: 'Hora',
  company: 'Empresa',
  description: 'Descripción',
  status: 'Estado',
  priority: 'Prioridad',
  module: 'Módulo',
  assignees: 'Responsable',
  supportTypes: 'Tipo de soporte',
  note: 'Observación',
};

/**
 * The catalogs and the fixed lists a sheet names values of, as the preview calls them. An import
 * can add to the first three.
 */
const CATALOG_LABEL: Record<keyof ImportUnknown, string> = {
  companies: 'Empresas',
  assignees: 'Responsables',
  supportTypes: 'Tipos de soporte',
  modules: 'Módulos',
  priorities: 'Prioridades',
  statuses: 'Estados',
};

/** How many of something, in words: "1 fila rechazada", "3 filas rechazadas". */
function count(total: number, one: string, many: string): string {
  return `${total} ${total === 1 ? one : many}`;
}

/** What an import added to the catalogs, in a sentence: "Se crearon 2 empresas y 1 responsable". Empty when it added nothing. */
function createdText(created: ImportResult['created']): string {
  const parts = [
    created.companies.length ? count(created.companies.length, 'empresa', 'empresas') : '',
    created.assignees.length ? count(created.assignees.length, 'responsable', 'responsables') : '',
    created.supportTypes.length ? count(created.supportTypes.length, 'tipo de soporte', 'tipos de soporte') : '',
  ].filter(Boolean);
  if (!parts.length) return '';
  const total = created.companies.length + created.assignees.length + created.supportTypes.length;
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} y ${parts.at(-1)}`;
  return `${total === 1 ? 'Se creó' : 'Se crearon'} ${list}`;
}

/**
 * What an import did, for the toast that follows it: the cases that came in and, when there are
 * any, the rows that stayed out and what the catalogs gained. The dialog closes with it, and the
 * preview that said so goes with the dialog.
 */
function importedText(result: Pick<ImportResult, 'toCreate' | 'rejected' | 'created'>): string {
  const cases = count(result.toCreate, 'caso importado', 'casos importados');
  const more = [result.rejected > 0 ? count(result.rejected, 'fila rechazada', 'filas rechazadas') : '', createdText(result.created)].filter(Boolean);
  // Alone it reads as it always did, without a full stop.
  return more.length ? `${[cases, ...more].join('. ')}.` : cases;
}

const DATE_ORDERS: readonly { id: DateOrder; label: string }[] = [
  { id: 'mdy', label: 'mes/día/año (7/27/2023)' },
  { id: 'dmy', label: 'día/mes/año (27/7/2023)' },
];

/** Values of the sheet for one catalog, under the name the preview gives it. */
interface CatalogValues {
  label: string;
  values: string[];
}

/** The catalogs that have values in `lists`, each with its own, in the order the preview shows them. */
function byCatalog(lists: Partial<ImportUnknown>): CatalogValues[] {
  return (Object.keys(CATALOG_LABEL) as (keyof ImportUnknown)[]).map((catalog) => ({ label: CATALOG_LABEL[catalog], values: lists[catalog] ?? [] })).filter((list) => list.values.length > 0);
}

/**
 * Brings the existing spreadsheet into the app: first a preview, then the import. A row that
 * names a company, a responsible, a support type, a module, a priority or a status the system
 * does not have is rejected, and the preview says which rows those are and why.
 */
@Component({
  selector: 'app-import-dialog',
  imports: [FormsModule, A11yModule, BackdropClick, ...SELECT, Hint, Icon, Say, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'closed.emit()' },
  template: `
    <div class="modal-backdrop" (appBackdropClick)="closed.emit()">
      <div class="card overlay max-h-full w-full max-w-2xl" role="dialog" aria-modal="true" aria-labelledby="import-title" cdkTrapFocus [cdkTrapFocusAutoCapture]="true">
        <header class="flex items-center gap-2 border-b border-line px-4 py-3">
          <app-icon name="file-import-outline" class="text-xl text-primary" />
          <h2 id="import-title" class="font-semibold">Importar hoja de casos</h2>
          <button type="button" class="btn btn-ghost btn-icon ml-auto px-2" (click)="closed.emit()" aria-label="Cerrar">
            <app-icon name="close" class="text-lg" />
          </button>
        </header>

        <div class="overlay-body space-y-4 p-4">
          <p class="text-muted">
            Archivo <strong>.xlsx</strong> o <strong>.csv</strong> con encabezados como: Fecha, Hora, Empresa, Descripción, Estado, Prioridad, Módulo, Responsable, Tipo de soporte, Observación.
            Solo Empresa y Descripción son obligatorias. La columna Fecha se toma como fecha del caso; la fecha de registro de todos será la de hoy.
            La empresa, el responsable, los tipos de soporte, el módulo, la prioridad y el estado de una fila tienen que existir en el sistema: la fila que nombra uno que no existe se rechaza.
          </p>

          <div class="flex flex-wrap items-center gap-3 rounded-control border border-line px-3 py-2.5">
            <app-icon name="file-excel-outline" class="text-2xl text-success" />
            <p class="min-w-48 flex-1 text-xs text-muted">
              <strong class="block text-sm text-ink">¿Vas a armar la hoja desde cero?</strong>
              Usa la plantilla: trae las columnas listas, la fecha como fecha y listas para elegir entre las empresas, los responsables, los módulos y los tipos de soporte registrados. Llénala y súbela aquí.
            </p>
            <button type="button" class="btn btn-soft" [appSoftDisabled]="downloading()" (click)="downloadTemplate()">
              <app-icon [name]="downloading() ? 'loading' : 'download'" />
              {{ downloading() ? 'Descargando plantilla…' : 'Descargar plantilla' }}
            </button>
          </div>

          <div class="grid gap-3 sm:grid-cols-2">
            <div>
              <label class="label" for="import-file">Archivo</label>
              <input id="import-file" class="input" type="file" accept=".xlsx,.csv" (click)="forgetFile($event)" (change)="onFile($event)" />
            </div>
            <div>
              <label class="label" for="import-order">Fechas escritas como texto</label>
              <!-- Its list hangs from the body: inside the dialog it would be cut where the dialog scrolls. -->
              <ng-select
                labelForId="import-order"
                bindValue="id"
                bindLabel="label"
                appendTo="body"
                [items]="dateOrders"
                [clearable]="false"
                [searchable]="false"
                [ngModel]="dateOrder()"
                (ngModelChange)="setOrder($event)"
              />
            </div>
          </div>

          <!-- Said at once as it comes (see Say): an alert that comes with its words may not be read. -->
          @if (error()) {
            <p class="alert-error" [appSay]="error()" sayAs="assertive">{{ error() }}</p>
          }

          @if (preview(); as p) {
            <!-- Dimmed while it is made again for the box "Crear…", which stays where the person pressed it. -->
            <div class="space-y-4" [class.opacity-60]="busy()" [attr.aria-busy]="busy()">
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
                  <div class="text-xl font-semibold" [class.text-danger]="p.rejected > 0">{{ p.rejected }}</div>
                  <div class="text-xs text-muted">Filas rechazadas</div>
                </div>
              </div>

              <!-- On more lines when it has to: a sheet can name a column with several headers, longer than a phone is wide. -->
              <div class="flex flex-wrap gap-1.5 text-xs">
                @for (column of columnKeys; track column) {
                  <span class="badge whitespace-normal" [class]="p.columns[column] ? 'st-RESOLVED' : 'bg-elevated text-muted'">
                    {{ columnLabel[column] }}: {{ p.columns[column] ?? 'no encontrada' }}
                  </span>
                }
              </div>

              @if (p.rejected > 0) {
                <section aria-labelledby="import-rejected">
                  <h3 id="import-rejected" class="section-title mb-1.5">Filas rechazadas ({{ p.rejected }})</h3>
                  <!--
                    A box that scrolls, and the keyboard scrolls it too: it takes the focus, with its name and its ring,
                    and is never higher than a part of the dialog, so that both stay in view.
                  -->
                  <div class="max-h-80 overflow-auto rounded-control border border-line focus-visible:outline-2 focus-visible:outline-primary" tabindex="0" role="region" aria-label="Filas rechazadas">
                    <table class="w-full text-left text-xs">
                      <thead class="bg-elevated text-muted">
                        <tr>
                          <!-- Named "Fila" alone: its "?" is not part of the header (see Hint). -->
                          <th class="px-2 py-1.5" title="Número de la fila en la hoja" aria-label="Fila" aria-describedby="import-row-hint">
                            Fila <app-hint textId="import-row-hint" about="Fila" text="Número de la fila en la hoja" />
                          </th>
                          <th class="px-2 py-1.5">Por qué no se importa</th>
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of p.rejectedSample; track row.row) {
                          <tr class="border-t border-line align-top">
                            <td class="px-2 py-1.5 font-mono whitespace-nowrap">{{ row.row }}</td>
                            <td class="px-2 py-1.5">
                              @for (reason of row.reasons; track $index) {
                                <div>{{ reason }}</div>
                              }
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <p class="mt-1 text-2xs text-muted">
                    @if (p.rejected > p.rejectedSample.length) {
                      Se muestran las primeras {{ p.rejectedSample.length }}.
                    }
                    Estas filas no se importan; las demás sí. Corrige la hoja, o registra lo que falta en Configuración, y elige el archivo otra vez.
                  </p>
                </section>
              }

              @if (showValues()) {
                <section class="space-y-2 rounded-control border border-line px-3 py-2.5" aria-labelledby="import-values">
                  <h3 id="import-values" class="section-title">Valores de la hoja que no existen en el sistema</h3>
                  @if (canCreate()) {
                    <!-- Before the lists, which can be long: a sheet with years of history names many companies. -->
                    <label class="flex cursor-pointer items-start gap-2">
                      <input type="checkbox" class="mt-0.5 accent-primary" [ngModel]="createMissing()" (ngModelChange)="setCreateMissing($event)" />
                      <span>
                        Crear las empresas, responsables y tipos de soporte que no existen
                        <span class="block text-2xs text-muted">Revisa antes que no sean nombres mal escritos. Los módulos, las prioridades y los estados no se crean desde una hoja.</span>
                      </span>
                    </label>
                  }
                  @if (toAdd().length) {
                    <div>
                      <p class="text-xs font-medium">Se crearán al importar</p>
                      <ul class="text-xs">
                        @for (catalog of toAdd(); track catalog.label) {
                          <li><span class="text-muted">{{ catalog.label }} ({{ catalog.values.length }}):</span> {{ catalog.values.join(', ') }}</li>
                        }
                      </ul>
                    </div>
                  }
                  @if (missing().length) {
                    <div>
                      <p class="text-xs font-medium">No existen: las filas que los nombran se rechazan</p>
                      <ul class="text-xs">
                        @for (catalog of missing(); track catalog.label) {
                          <li><span class="text-muted">{{ catalog.label }} ({{ catalog.values.length }}):</span> {{ catalog.values.join(', ') }}</li>
                        }
                      </ul>
                    </div>
                  }
                </section>
              }

              @if (p.sample.length) {
                <div>
                  <!-- Scrolled by the keyboard too, as the one of the rejected rows. -->
                  <div class="max-h-80 overflow-auto rounded-control border border-line focus-visible:outline-2 focus-visible:outline-primary" tabindex="0" role="region" aria-label="Primeras filas que se importan">
                    <table class="w-full text-left text-xs">
                      <thead class="bg-elevated text-muted">
                        <tr>
                          <th class="px-2 py-1.5">Fecha</th>
                          <th class="px-2 py-1.5">Empresa</th>
                          <th class="px-2 py-1.5">Descripción</th>
                          <th class="px-2 py-1.5">Estado</th>
                          <th class="px-2 py-1.5">Responsables</th>
                          <!-- The columns a sheet may not have are shown only for a sheet that has them. -->
                          @if (p.columns.priority) {
                            <th class="px-2 py-1.5">Prioridad</th>
                          }
                          @if (p.columns.module) {
                            <th class="px-2 py-1.5">Módulo</th>
                          }
                          @if (p.columns.supportTypes) {
                            <th class="px-2 py-1.5">Tipos de soporte</th>
                          }
                        </tr>
                      </thead>
                      <tbody>
                        @for (row of p.sample; track $index) {
                          <tr class="border-t border-line">
                            <td class="px-2 py-1.5 whitespace-nowrap">{{ formatCaseDate(row) }}</td>
                            <td class="px-2 py-1.5">{{ row.company }}</td>
                            <td class="px-2 py-1.5">{{ row.description }}</td>
                            <td class="px-2 py-1.5 whitespace-nowrap">{{ statusLabel[row.status] }}</td>
                            <td class="px-2 py-1.5">{{ row.assignees.join(', ') }}</td>
                            @if (p.columns.priority) {
                              <td class="px-2 py-1.5 whitespace-nowrap">{{ row.priority ? priorityLabel[row.priority] : '' }}</td>
                            }
                            @if (p.columns.module) {
                              <td class="px-2 py-1.5">{{ row.module ?? '' }}</td>
                            }
                            @if (p.columns.supportTypes) {
                              <td class="px-2 py-1.5">{{ row.supportTypes.join(', ') }}</td>
                            }
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                  <p class="mt-1 text-2xs text-muted">Primeras filas que se importan. Verifica que las fechas se leen bien antes de importar.</p>
                </div>
              }
            </div>
          }
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button type="button" class="btn btn-ghost" (click)="closed.emit()">Cancelar</button>
          <!-- Says how many cases come in: the rejected rows and the ones that already exist are not among them. -->
          <button type="button" class="btn btn-primary" [appSoftDisabled]="busy() || !preview()?.toCreate" (click)="run()">
            {{ busy() ? 'Procesando…' : confirmLabel() }}
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
  protected readonly dateOrders = DATE_ORDERS;
  protected readonly statusLabel = STATUS_LABEL;
  protected readonly priorityLabel = PRIORITY_LABEL;
  protected readonly formatCaseDate = formatCaseDate;

  protected readonly dateOrder = signal<DateOrder>('mdy');
  /**
   * "Crear las empresas, responsables y tipos de soporte que no existen". Off unless the person
   * asks for it: a name that is in no catalog is as often a name written wrong.
   */
  protected readonly createMissing = signal(false);
  protected readonly preview = signal<ImportResult | null>(null);
  protected readonly error = signal('');
  private file: File | null = null;
  /** A preview is on its way. Only the one asked for last counts (see analyze). */
  private readonly previewing = signal(false);
  private readonly previews = latest();
  /** The import itself is on its way. */
  private readonly importing = signal(false);
  protected readonly busy = computed(() => this.previewing() || this.importing());
  protected readonly downloading = signal(false);

  /** How many cases the import brings in, once a preview has counted them. */
  protected readonly confirmLabel = computed(() => {
    const count = this.preview()?.toCreate;
    return count === undefined ? 'Importar' : count === 1 ? 'Importar 1 caso' : `Importar ${count} casos`;
  });
  /** What the import adds to the catalogs, by catalog. Nothing, unless the person asked for it. */
  protected readonly toAdd = computed(() => byCatalog(this.preview()?.created ?? {}));
  /** The values of the sheet that are in no catalog and will not be added: the rows that name them are rejected. */
  protected readonly missing = computed(() => {
    const preview = this.preview();
    if (!preview) return [];
    const { unknown, created } = preview;
    return byCatalog({
      companies: unknown.companies.filter((name) => !created.companies.includes(name)),
      assignees: unknown.assignees.filter((name) => !created.assignees.includes(name)),
      supportTypes: unknown.supportTypes.filter((name) => !created.supportTypes.includes(name)),
      // A module, a priority or a status is never added from a sheet.
      modules: unknown.modules,
      priorities: unknown.priorities,
      statuses: unknown.statuses,
    });
  });
  /**
   * The sheet names a company, a responsible or a support type that does not exist: the import
   * can add them. Also while the box is checked, so that it can always be unchecked.
   */
  protected readonly canCreate = computed(() => {
    const unknown = this.preview()?.unknown;
    return this.createMissing() || (!!unknown && unknown.companies.length + unknown.assignees.length + unknown.supportTypes.length > 0);
  });
  protected readonly showValues = computed(() => this.canCreate() || this.missing().length > 0);

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

  /**
   * The file field is about to ask for a file: the one it had is forgotten, with its preview.
   * A browser says nothing when the file chosen is the one the field already has, and that is
   * what a person does after correcting the rows the preview rejected.
   */
  protected forgetFile(event: Event): void {
    (event.target as HTMLInputElement).value = '';
    if (this.file) this.choose(null);
  }

  protected onFile(event: Event): void {
    this.choose((event.target as HTMLInputElement).files?.[0] ?? null);
  }

  private choose(file: File | null): void {
    this.file = file;
    // Asked for another sheet: what this one would add to the catalogs has to be seen first.
    this.createMissing.set(false);
    void this.analyze();
  }

  protected setOrder(order: DateOrder): void {
    this.dateOrder.set(order);
    void this.analyze();
  }

  /**
   * The preview is made again: with the box checked, the rows that were rejected for those
   * values come in. The one on screen stays until the new one arrives (see analyze).
   */
  protected setCreateMissing(create: boolean): void {
    this.createMissing.set(create);
    void this.analyze(true);
  }

  /**
   * Asks for the preview of the file with the options on screen. `keep` leaves the previous one
   * in view meanwhile: taken away, the box that asked for the new one would go with it, and the
   * focus of whoever pressed it with the keyboard.
   */
  private async analyze(keep = false): Promise<void> {
    // Only the answer to the latest preview is shown, and the one before is cancelled: an older
    // one, for another file or other options, can arrive after it, and the button would then say
    // one thing and import another.
    const asked = this.previews.next();
    const file = this.file;
    if (!keep || !file) this.preview.set(null);
    this.error.set('');
    this.previewing.set(file !== null);
    if (!file) return;
    try {
      const preview = await this.api.importFile(file, true, this.dateOrder(), this.createMissing(), asked.signal);
      if (asked.current()) this.preview.set(preview);
    } catch (error) {
      if (!asked.current()) return;
      // A preview kept on screen is of other options than the ones the import would now use.
      this.preview.set(null);
      this.error.set(errorMessage(error));
    } finally {
      if (asked.current()) this.previewing.set(false);
    }
  }

  protected async run(): Promise<void> {
    // Also a press that arrives before the button is drawn disabled.
    if (!this.file || this.busy()) return;
    this.importing.set(true);
    this.error.set('');
    try {
      const result = await this.api.importFile(this.file, false, this.dateOrder(), this.createMissing());
      this.toast.ok(importedText(result));
      this.imported.emit();
    } catch (error) {
      this.error.set(errorMessage(error));
    } finally {
      this.importing.set(false);
    }
  }
}
