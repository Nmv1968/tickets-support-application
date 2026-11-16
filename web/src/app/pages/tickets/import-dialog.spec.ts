import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Announcer } from '../../core/announcer';
import type { ImportResult, ImportRow } from '../../core/api';
import { Toast } from '../../core/toast';
import { httpTestBed } from '../../testing/http';
import { chooseOption, ngSelect, openSelect, selectedTexts } from '../../testing/ng-select';
import { isDisabled, nextTask, said, toasts } from '../../testing/screen';
import { textOf } from '../../testing/text';
import { resizeScreen } from '../../testing/viewport';
import { ImportDialog } from './import-dialog';

// The template is how a person gets the format the import reads without guessing it.
describe('ImportDialog, the template to fill in', () => {
  let fixture: ComponentFixture<ImportDialog>;
  let http: HttpTestingController;
  let saved: { name: string; href: string }[];

  /** The button of the template, by what it says when idle or while it downloads. */
  const button = (text = /Descarga(r|ndo) plantilla/): HTMLButtonElement => {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    return buttons.find((item) => text.test(item.textContent ?? '')) as HTMLButtonElement;
  };

  beforeEach(() => {
    http = httpTestBed();
    // A click on a link with `download` saves a file: here it is only recorded.
    saved = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
    fixture = TestBed.createComponent(ImportDialog);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('downloads the spreadsheet from the server and saves it under its name', async () => {
    button().click();
    fixture.detectChanges();
    expect(isDisabled(button())).toBeTrue();
    // In words: its icon that turns stands still with less motion asked for.
    expect(textOf(button())).toBe('Descargando plantilla…');

    const request = http.expectOne({ method: 'GET', url: '/api/import/template' });
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['xlsx']));
    await nextTask();
    fixture.detectChanges();

    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('plantilla-casos-soporte.xlsx');
    expect(saved[0].href).toMatch(/^blob:/);
    expect(isDisabled(button())).toBeFalse();
    expect(textOf(button())).toBe('Descargar plantilla');
  });

  it('says why when the download fails, saves nothing and can be tried again', async () => {
    const toast = spyOn(TestBed.inject(Toast), 'error');

    button().click();
    http
      .expectOne('/api/import/template')
      .flush(new Blob([JSON.stringify({ message: 'No se pudo generar la plantilla' })], { type: 'application/json' }), {
        status: 500,
        statusText: 'Server Error',
      });
    // The error body arrives as a file and is read back before the message is shown: that takes more than one turn.
    for (let turn = 0; turn < 50 && !toast.calls.count(); turn++) await nextTask();
    fixture.detectChanges();

    expect(saved).toEqual([]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(isDisabled(button())).toBeFalse();
  });

  it('does not touch the file chosen for the import', async () => {
    button().click();
    http.expectOne('/api/import/template').flush(new Blob(['xlsx']));
    await nextTask();
    fixture.detectChanges();

    // No preview was asked for and the import button still waits for a file.
    const importButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((item) => item.textContent?.includes('Importar'));
    expect(isDisabled(importButton)).toBeTrue();
  });
});

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    date: '2026-11-05',
    time: null,
    company: 'Acme',
    description: 'No imprime',
    status: 'PENDING',
    priority: null,
    module: null,
    assignee: 'Ana',
    supportTypes: [],
    note: null,
    ...overrides,
  };
}

/** What the server answers about a sheet where every value exists: three rows, all of them to import. */
function result(overrides: Partial<ImportResult> = {}): ImportResult {
  return {
    dryRun: true,
    createMissing: false,
    columns: { date: 'Fecha', time: null, company: 'Empresa', description: 'Descripción', status: 'Estado', priority: null, module: null, assignee: 'Responsable', supportTypes: null, note: null },
    totalRows: 3,
    skippedEmpty: 0,
    duplicates: 0,
    toCreate: 3,
    rejected: 0,
    rejectedSample: [],
    unknown: { companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: [] },
    created: { companies: [], assignees: [], supportTypes: [] },
    sample: [row()],
    ...overrides,
  };
}

/** A sheet that names things the system does not have: two companies, a responsible, a module and a priority. */
const WITH_UNKNOWN = result({
  toCreate: 1,
  rejected: 4,
  rejectedSample: [
    { row: 3, reasons: ['La empresa «Bodega Sur» no existe'] },
    { row: 5, reasons: ['La empresa «Ferretería El Tornillo» no existe', 'El módulo «Nómina» no existe'] },
    { row: 6, reasons: ['El responsable «Zoe» no existe'] },
    { row: 8, reasons: ['La prioridad «Urgente» no existe'] },
  ],
  unknown: { companies: ['Bodega Sur', 'Ferretería El Tornillo'], assignees: ['Zoe'], supportTypes: [], modules: ['Nómina'], priorities: ['Urgente'], statuses: [] },
});

/** The same sheet when the import is asked to create what does not exist: the rows of the module and of the priority stay out. */
const CREATING = result({
  createMissing: true,
  toCreate: 3,
  rejected: 2,
  rejectedSample: [
    { row: 5, reasons: ['El módulo «Nómina» no existe'] },
    { row: 8, reasons: ['La prioridad «Urgente» no existe'] },
  ],
  unknown: WITH_UNKNOWN.unknown,
  // The company of row 5 is not created: its row does not come in.
  created: { companies: ['Bodega Sur'], assignees: ['Zoe'], supportTypes: [] },
});

// Nothing is stored until the person has seen what the sheet would bring, and what it would not.
describe('ImportDialog, the preview of a sheet', () => {
  let fixture: ComponentFixture<ImportDialog>;
  let http: HttpTestingController;
  let el: HTMLElement;
  /** Times the dialog said the cases were imported. */
  let imported: number;

  beforeEach(() => {
    http = httpTestBed();
    fixture = TestBed.createComponent(ImportDialog);
    el = fixture.nativeElement as HTMLElement;
    imported = 0;
    fixture.componentInstance.imported.subscribe(() => imported++);
    fixture.detectChanges();
  });

  // Also catches a request nobody expected: any left unanswered fails the test.
  afterEach(() => http.verify());

  /** Lets what was answered, or done on the page, reach the screen. */
  async function show(): Promise<void> {
    fixture.detectChanges();
    await nextTask();
    fixture.detectChanges();
  }

  const fileField = (): HTMLInputElement => el.querySelector<HTMLInputElement>('#import-file')!;

  /** A file picked in the file field, as the browser reports it. */
  function chooseFile(name = 'casos.xlsx'): void {
    const picked = new DataTransfer();
    picked.items.add(new File(['hoja'], name));
    fileField().files = picked.files;
    fileField().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  /** A request to the import that is on its way: a preview, unless the test says it is the real one. */
  function request(kind: 'preview' | 'import' = 'preview'): TestRequest {
    return http.expectOne((sent) => sent.method === 'POST' && sent.url === '/api/import' && sent.params.has('dryRun') === (kind === 'preview'));
  }

  /** Chooses a file and answers its preview. */
  async function preview(answer: ImportResult = result()): Promise<void> {
    chooseFile();
    request().flush(answer);
    await show();
  }

  /** The button that imports, whatever it says. */
  const confirm = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('footer .btn-primary')!;

  /** The number of a tile of the preview, by the words under it. Empty when there is no preview. */
  function tile(label: string): string {
    const found = Array.from(el.querySelectorAll('.rounded-control')).find((item) => item.lastElementChild?.textContent?.trim() === label);
    return found?.firstElementChild?.textContent?.trim() ?? '';
  }

  /** "Crear las empresas, responsables y tipos de soporte que no existen". Null while it is not offered. */
  const createBox = (): HTMLInputElement | null => el.querySelector<HTMLInputElement>('input[type=checkbox]');

  /** Checks or unchecks that box, as a press on it does. */
  function pressCreateBox(): void {
    createBox()!.click();
    fixture.detectChanges();
  }

  /** The text of a section of the preview, by how its heading starts. Empty when the preview does not have it. */
  function section(heading: string): string {
    const found = Array.from(el.querySelectorAll('section')).find((item) => item.querySelector('h3')?.textContent?.startsWith(heading));
    return textOf(found);
  }

  // The two titles the preview lists values of the sheet under.
  const TO_ADD = 'Se crearán al importar';
  const MISSING = 'No existen: las filas que los nombran se rechazan';

  /** The values listed under one of those titles: a line per catalog. */
  function values(title: string): string[] {
    const heading = Array.from(el.querySelectorAll('section[aria-labelledby=import-values] p')).find((item) => item.textContent?.trim() === title);
    return Array.from(heading?.nextElementSibling?.querySelectorAll('li') ?? [], (item) => textOf(item));
  }

  /** The headers of the table of the first rows to import, the last table of the preview. */
  const sampleHeaders = (): string[] => Array.from(Array.from(el.querySelectorAll('table')).at(-1)?.querySelectorAll('thead th') ?? [], (header) => header.textContent?.trim() ?? '');
  const sampleCells = (): string[] => Array.from(Array.from(el.querySelectorAll('table')).at(-1)?.querySelectorAll('tbody td') ?? [], (cell) => cell.textContent?.trim() ?? '');

  it('is asked for as soon as a file is chosen, and stores nothing: neither cases nor what the catalogs lack', async () => {
    expect(isDisabled(confirm())).toBeTrue();
    chooseFile();

    const asked = request();
    expect(asked.request.params.get('dryRun')).toBe('1');
    expect(asked.request.params.get('dateOrder')).toBe('mdy');
    expect(asked.request.params.has('createMissing')).toBeFalse();
    expect((asked.request.body as FormData).get('file')).toEqual(jasmine.any(File));
    expect(confirm().textContent?.trim()).toBe('Procesando…');
    asked.flush(result({ totalRows: 9, toCreate: 3, duplicates: 2, skippedEmpty: 4 }));
    await show();

    expect(tile('Casos a importar')).toBe('3');
    expect(tile('Ya existen (se omiten)')).toBe('2');
    expect(tile('Filas vacías')).toBe('4');
    expect(tile('Filas rechazadas')).toBe('0');
  });

  it('puts on the button that imports how many cases will come in, and leaves it off with none', async () => {
    // Nothing counted yet: the button has no number to give.
    expect(confirm().textContent?.trim()).toBe('Importar');
    await preview(result({ toCreate: 12 }));
    expect(confirm().textContent?.trim()).toBe('Importar 12 casos');
    expect(isDisabled(confirm())).toBeFalse();

    chooseFile('uno.xlsx');
    request().flush(result({ toCreate: 1 }));
    await show();
    expect(confirm().textContent?.trim()).toBe('Importar 1 caso');

    chooseFile('ninguno.xlsx');
    request().flush(result({ toCreate: 0, rejected: 3 }));
    await show();
    expect(confirm().textContent?.trim()).toBe('Importar 0 casos');
    expect(isDisabled(confirm())).toBeTrue();
  });

  it('names the columns it found in the sheet, and shows the first rows with the optional columns only when the sheet has them', async () => {
    await preview();
    expect(el.textContent).toContain('Empresa: Empresa');
    expect(el.textContent).toContain('Prioridad: no encontrada');
    expect(sampleHeaders()).toEqual(['Fecha', 'Empresa', 'Descripción', 'Estado', 'Responsable']);

    chooseFile('completa.xlsx');
    request().flush(
      result({
        columns: { ...result().columns, priority: 'Prioridad', module: 'Módulo', supportTypes: 'Tipo de soporte, Otro tipo de soporte' },
        sample: [row({ priority: 'HIGH', module: 'Ventas > Facturas', supportTypes: ['Capacitación', 'Falla del sistema'] })],
      }),
    );
    await show();
    expect(el.textContent).toContain('Tipo de soporte: Tipo de soporte, Otro tipo de soporte');
    expect(sampleHeaders()).toEqual(['Fecha', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Prioridad', 'Módulo', 'Tipos de soporte']);
    expect(sampleCells()).toEqual(['05/11/2026', 'Acme', 'No imprime', 'Pendiente', 'Ana', 'Alta', 'Ventas > Facturas', 'Capacitación, Falla del sistema']);
  });

  it('that the server refuses says why and leaves nothing to import', async () => {
    chooseFile('notas.txt');
    request().flush({ message: 'No se encontró la fila de encabezados. Se necesitan al menos las columnas "Empresa" y "Descripción".' }, { status: 400, statusText: 'Bad Request' });
    await show();

    expect(el.querySelector('.alert-error')?.textContent).toContain('No se encontró la fila de encabezados');
    // Said at once as it comes: it was an alert that came with its words, which a screen reader may not read.
    expect(el.querySelector('.alert-error')!.closest('[role=alert], [role=status], [aria-live]')).toBeNull();
    expect(said()).toEqual([el.querySelector('.alert-error')!.textContent!.trim()]);
    expect(TestBed.inject(Announcer).said()[0].politeness).toBe('assertive');
    expect(tile('Casos a importar')).toBe('');
    expect(isDisabled(confirm())).toBeTrue();
  });

  describe('of a sheet that names what the system does not have', () => {
    it('counts the rejected rows and lists them: the number each has in the sheet, and every reason', async () => {
      await preview(WITH_UNKNOWN);

      expect(tile('Filas rechazadas')).toBe('4');
      expect(tile('Casos a importar')).toBe('1');
      expect(section('Filas rechazadas')).toContain('Filas rechazadas (4)');
      // Each row with its number, then its reasons, one to a line.
      const rows = Array.from(el.querySelectorAll('section[aria-labelledby=import-rejected] tbody tr'), (item) => Array.from(item.querySelectorAll('td:first-child, td div'), (cell) => cell.textContent?.trim()));
      expect(rows).toEqual([
        ['3', 'La empresa «Bodega Sur» no existe'],
        ['5', 'La empresa «Ferretería El Tornillo» no existe', 'El módulo «Nómina» no existe'],
        ['6', 'El responsable «Zoe» no existe'],
        ['8', 'La prioridad «Urgente» no existe'],
      ]);
      // Every rejected row is on screen: nothing says some are left out.
      expect(section('Filas rechazadas')).not.toContain('Se muestran las primeras');
      // The rest of the sheet still comes in.
      expect(confirm().textContent?.trim()).toBe('Importar 1 caso');
      expect(isDisabled(confirm())).toBeFalse();
    });

    // What "Fila" counts was only in the title of the header.
    it('says what the number of a rejected row is with a "?" in its header, named "Fila" alone', async () => {
      await preview(WITH_UNKNOWN);
      const header = el.querySelector<HTMLElement>('section[aria-labelledby=import-rejected] thead th')!;
      const help = header.querySelector<HTMLButtonElement>('button')!;
      const text = el.querySelector<HTMLElement>(`#${header.getAttribute('aria-describedby')}`)!;

      expect(header.getAttribute('aria-label')).toBe('Fila');
      expect(help.getAttribute('aria-label')).toBe('Ayuda sobre Fila');
      expect(help.getAttribute('aria-describedby')).toBe(text.id);
      expect(text.textContent?.trim()).toBe('Número de la fila en la hoja');
      help.click();
      fixture.detectChanges();
      await fixture.whenStable();
      expect(text.hidden).toBeFalse();
      help.click();
      fixture.detectChanges();
    });

    // The server sends the first twenty with their reasons, and counts them all.
    it('says so when it lists only the first rejected rows of many', async () => {
      await preview({ ...WITH_UNKNOWN, rejected: 57 });

      expect(section('Filas rechazadas')).toContain('Filas rechazadas (57)');
      expect(section('Filas rechazadas')).toContain('Se muestran las primeras 4.');
    });

    // Drawn for real, with the stylesheet of the app (the test page loads styles.css). A sheet with
    // many rejected rows makes a preview taller than any screen, and its tables are wider than a phone.
    it('however long and wide, stays inside a screen as small as a phone: the preview scrolls, and the button that imports is in view', async () => {
      // A phone made out of the element of the dialog: what is fixed to the screen is fixed to an element with a transform.
      Object.assign(el.style, { display: 'block', transform: 'translate(0)', width: '360px', height: '640px' });
      const many = Array.from({ length: 20 }, (_, index) => ({ row: index + 2, reasons: [`La empresa «Empresa ${index + 1}» no existe`, 'El módulo «Nómina» no existe'] }));
      await preview({
        ...WITH_UNKNOWN,
        rejected: 20,
        rejectedSample: many,
        columns: { ...WITH_UNKNOWN.columns, priority: 'Prioridad', module: 'Módulo', supportTypes: 'Tipo de soporte' },
        sample: [row({ time: '14:35', priority: 'CRITICAL', module: 'Ventas > Facturas', supportTypes: ['Capacitación', 'Falla del sistema'] })],
      });

      const screen = el.getBoundingClientRect();
      const dialog = el.querySelector<HTMLElement>('[role=dialog]')!;
      const content = Array.from(dialog.children).find((part) => part.classList.contains('overlay-body')) as HTMLElement;
      expect(content.scrollHeight).toBeGreaterThan(content.clientHeight);
      for (const part of [dialog.getBoundingClientRect(), confirm().getBoundingClientRect()]) {
        expect(part.top).toBeGreaterThanOrEqual(screen.top);
        expect(part.bottom).toBeLessThanOrEqual(screen.bottom);
        expect(part.left).toBeGreaterThanOrEqual(screen.left);
        expect(part.right).toBeLessThanOrEqual(screen.right);
      }
    });

    // At 400 % (320 × 200) its header and its footer left the preview a strip under the box "Crear…".
    // There the whole dialog scrolls, and everything in it is reached in its turn.
    it('on a screen as short as a page zoomed to 400 %, scrolls whole, and the box "Crear…" and the button that imports are reached', async () => {
      resizeScreen(320, 200);
      await preview({ ...WITH_UNKNOWN, unknown: { ...WITH_UNKNOWN.unknown, companies: ['Bodega Sur', 'UnidadEducativaParticularJaguarDelValleDeLosChillos'.repeat(3)] } });

      const dialog = el.querySelector<HTMLElement>('[role=dialog]')!;
      expect(dialog.scrollHeight).toBeGreaterThan(dialog.clientHeight);
      // Names of the sheet that do not break by themselves wrap inside it.
      expect(dialog.scrollWidth).toBe(dialog.clientWidth);
      for (const target of [createBox()!.closest('label')!, confirm()]) {
        target.scrollIntoView();
        expect(target.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
        expect(target.getBoundingClientRect().bottom).toBeLessThanOrEqual(200);
      }
    });

    // A sheet can name a column with several headers. Its badge, kept on one line, was wider than a
    // phone, and the preview scrolled sideways.
    it('names the columns it found on more lines when it has to: on a phone the preview never scrolls sideways', async () => {
      resizeScreen(320, 568);
      await preview({ ...WITH_UNKNOWN, columns: { ...WITH_UNKNOWN.columns, supportTypes: 'Tipo de soporte, Otro tipo de soporte, Tipo de soporte del cliente' } });

      const content = el.querySelector<HTMLElement>('[role=dialog] .overlay-body')!;
      expect(content.scrollWidth).toBe(content.clientWidth);
    });

    it('lists the values that are in no catalog, each under its catalog', async () => {
      await preview(WITH_UNKNOWN);

      // A catalog the sheet asks nothing new of (the support types, here) is not named.
      expect(values(MISSING)).toEqual(['Empresas (2): Bodega Sur, Ferretería El Tornillo', 'Responsables (1): Zoe', 'Módulos (1): Nómina', 'Prioridades (1): Urgente']);
      // Nothing is added to the catalogs unless the person asks for it.
      expect(section('Valores de la hoja que no existen')).not.toContain(TO_ADD);
    });

    it('shows neither list for a sheet where everything exists', async () => {
      await preview();

      expect(section('Filas rechazadas')).toBe('');
      expect(section('Valores de la hoja que no existen')).toBe('');
      expect(createBox()).toBeNull();
    });

    describe('and offers to create the companies, responsibles and support types that do not exist', () => {
      it('with a box that starts unchecked', async () => {
        await preview(WITH_UNKNOWN);

        expect(createBox()!.checked).toBeFalse();
        expect(createBox()!.closest('label')?.textContent).toContain('Crear las empresas, responsables y tipos de soporte que no existen');
      });

      // A module, a priority or a status is never created from a sheet: the box would promise what it cannot do.
      it('but not when all that is missing is a module, a priority or a status', async () => {
        await preview(result({ rejected: 1, unknown: { ...result().unknown, modules: ['Nómina'], priorities: ['Urgente'], statuses: ['Cerrado'] } }));

        expect(values(MISSING)).toEqual(['Módulos (1): Nómina', 'Prioridades (1): Urgente', 'Estados (1): Cerrado']);
        expect(createBox()).toBeNull();
      });

      // An old sheet that says "Cerrado" or "Solucionado": its rows stay out, and nothing can create a status.
      it('and keeps a status the system does not have among what is missing, with the box checked too', async () => {
        const closed = { ...WITH_UNKNOWN.unknown, statuses: ['Cerrado', 'Solucionado'] };
        await preview({ ...WITH_UNKNOWN, unknown: closed });
        expect(values(MISSING)).toContain('Estados (2): Cerrado, Solucionado');
        expect(createBox()!.closest('label')?.textContent).toContain('Los módulos, las prioridades y los estados no se crean desde una hoja.');

        pressCreateBox();
        request().flush({ ...CREATING, unknown: closed });
        await show();
        expect(values(TO_ADD)).toEqual(['Empresas (1): Bodega Sur', 'Responsables (1): Zoe']);
        expect(values(MISSING)).toEqual(['Empresas (1): Ferretería El Tornillo', 'Módulos (1): Nómina', 'Prioridades (1): Urgente', 'Estados (2): Cerrado, Solucionado']);
      });

      it('checked, the preview is made again with them created: it says what will be added, and what is still missing', async () => {
        await preview(WITH_UNKNOWN);
        pressCreateBox();

        const asked = request();
        expect(asked.request.params.get('createMissing')).toBe('1');
        // Still a preview: nothing is created by checking the box.
        expect(asked.request.params.get('dryRun')).toBe('1');
        asked.flush(CREATING);
        await show();

        expect(createBox()!.checked).toBeTrue();
        expect(tile('Casos a importar')).toBe('3');
        expect(tile('Filas rechazadas')).toBe('2');
        expect(confirm().textContent?.trim()).toBe('Importar 3 casos');
        expect(values(TO_ADD)).toEqual(['Empresas (1): Bodega Sur', 'Responsables (1): Zoe']);
        // What is not created is still listed as missing: the company of a row that stays out, the module and the priority.
        expect(values(MISSING)).toEqual(['Empresas (1): Ferretería El Tornillo', 'Módulos (1): Nómina', 'Prioridades (1): Urgente']);
      });

      // Taken away meanwhile, the box would go with it, and the focus of whoever pressed it with the keyboard.
      it('checked, the preview and the box stay on screen while the new preview is on its way, with nothing to import yet', async () => {
        await preview(WITH_UNKNOWN);
        const box = createBox()!;
        pressCreateBox();

        expect(createBox()).toBe(box);
        expect(tile('Casos a importar')).toBe('1');
        expect(isDisabled(confirm())).toBeTrue();
        expect(confirm().textContent?.trim()).toBe('Procesando…');

        request().flush(CREATING);
        await show();
        expect(createBox()).toBe(box);
        expect(isDisabled(confirm())).toBeFalse();
      });

      it('unchecked again, the preview is made without them, and their rows go back to rejected', async () => {
        await preview(WITH_UNKNOWN);
        pressCreateBox();
        request().flush(CREATING);
        await show();

        pressCreateBox();
        const asked = request();
        expect(asked.request.params.has('createMissing')).toBeFalse();
        asked.flush(WITH_UNKNOWN);
        await show();
        expect(createBox()!.checked).toBeFalse();
        expect(tile('Filas rechazadas')).toBe('4');
      });

      // Checked and unchecked at once: the first answer may take longer than the second.
      it('shows the preview asked for last: the older one is cancelled, its answer never arrives', async () => {
        await preview(WITH_UNKNOWN);
        pressCreateBox();
        const creating = request();
        expect(creating.request.params.get('createMissing')).toBe('1');
        pressCreateBox();
        const plain = http.expectOne((sent) => sent.url === '/api/import' && !sent.params.has('createMissing'));
        expect(creating.cancelled).toBeTrue();

        plain.flush(WITH_UNKNOWN);
        await show();

        expect(createBox()!.checked).toBeFalse();
        expect(tile('Casos a importar')).toBe('1');
        expect(confirm().textContent?.trim()).toBe('Importar 1 caso');
      });

      it('is unchecked again for another file: what that one would add has to be seen first', async () => {
        await preview(WITH_UNKNOWN);
        pressCreateBox();
        request().flush(CREATING);
        await show();

        chooseFile('otra.xlsx');
        const asked = request();
        expect(asked.request.params.has('createMissing')).toBeFalse();
        asked.flush(WITH_UNKNOWN);
        await show();
        expect(createBox()!.checked).toBeFalse();
      });

      it('a preview with them created that the server refuses leaves no preview on screen: the one before was of other options', async () => {
        await preview(WITH_UNKNOWN);
        pressCreateBox();
        request().flush({ message: 'El archivo no se pudo leer' }, { status: 400, statusText: 'Bad Request' });
        await show();

        expect(el.querySelector('.alert-error')?.textContent).toBe('El archivo no se pudo leer');
        expect(tile('Casos a importar')).toBe('');
        expect(isDisabled(confirm())).toBeTrue();
      });
    });
  });

  describe('followed by the import', () => {
    it('stores the cases of the sheet with the options of the preview, says how many came in and tells the list', async () => {
      await preview(result({ toCreate: 12 }));
      confirm().click();
      fixture.detectChanges();
      expect(isDisabled(confirm())).toBeTrue();

      const sent = request('import');
      expect(sent.request.params.get('dateOrder')).toBe('mdy');
      expect(sent.request.params.has('createMissing')).toBeFalse();
      sent.flush(result({ dryRun: false, toCreate: 12 }));
      await show();

      expect(toasts()).toEqual(['12 casos importados']);
      expect(imported).toBe(1);
    });

    it('creates what the catalogs lack only when the box is checked', async () => {
      await preview(WITH_UNKNOWN);
      pressCreateBox();
      request().flush(CREATING);
      await show();

      confirm().click();
      fixture.detectChanges();
      const sent = request('import');
      expect(sent.request.params.get('createMissing')).toBe('1');
      sent.flush({ ...CREATING, dryRun: false });
      await show();
      // The dialog closes with the import: what stayed out and what the catalogs gained is said here.
      expect(toasts()).toEqual(['3 casos importados. 2 filas rechazadas. Se crearon 1 empresa y 1 responsable.']);
    });

    it('says how many rows were rejected, when the catalogs gained nothing', async () => {
      await preview(WITH_UNKNOWN);
      confirm().click();
      fixture.detectChanges();
      request('import').flush({ ...WITH_UNKNOWN, dryRun: false });
      await show();

      expect(toasts()).toEqual(['1 caso importado. 4 filas rechazadas.']);
    });

    it('says what the catalogs gained, each kind with its count, when no row was rejected', async () => {
      const everything = { companies: ['Bodega Sur', 'Zeta'], assignees: ['Zoe'], supportTypes: ['Capacitación', 'Visita', 'Otro'] };
      const unknown = { ...result().unknown, ...everything };
      await preview(result({ toCreate: 0, rejected: 6, unknown }));
      pressCreateBox();
      request().flush(result({ createMissing: true, toCreate: 6, unknown, created: everything }));
      await show();
      confirm().click();
      fixture.detectChanges();
      request('import').flush(result({ dryRun: false, createMissing: true, toCreate: 6, unknown, created: everything }));
      await show();

      expect(toasts()).toEqual(['6 casos importados. Se crearon 2 empresas, 1 responsable y 3 tipos de soporte.']);
    });

    it('says it in the singular for one row and one new entry', async () => {
      const one = { companies: [], assignees: [], supportTypes: ['Visita'] };
      const unknown = { ...result().unknown, supportTypes: ['Visita'], statuses: ['Cerrado'] };
      await preview(result({ toCreate: 0, rejected: 2, unknown }));
      pressCreateBox();
      request().flush(result({ createMissing: true, toCreate: 1, rejected: 1, unknown, created: one }));
      await show();
      confirm().click();
      fixture.detectChanges();
      request('import').flush(result({ dryRun: false, createMissing: true, toCreate: 1, rejected: 1, unknown, created: one }));
      await show();

      expect(toasts()).toEqual(['1 caso importado. 1 fila rechazada. Se creó 1 tipo de soporte.']);
    });

    it('that the server refuses says why, keeps the preview and can be sent again', async () => {
      await preview();
      confirm().click();
      fixture.detectChanges();
      request('import').flush({ message: 'El archivo no se pudo leer' }, { status: 400, statusText: 'Bad Request' });
      await show();

      expect(el.querySelector('.alert-error')?.textContent).toBe('El archivo no se pudo leer');
      expect(imported).toBe(0);
      expect(tile('Casos a importar')).toBe('3');
      expect(isDisabled(confirm())).toBeFalse();
    });
  });

  describe('and the order of the dates written as text', () => {
    const order = (): HTMLElement => ngSelect(el, 'import-order');

    it('which is chosen in a list that is not a native one, and starts on the month first', async () => {
      await show();

      expect(el.querySelector('select')).toBeNull();
      expect(el.querySelector('label[for=import-order]')?.textContent).toBe('Fechas escritas como texto');
      expect(selectedTexts(order())).toEqual(['mes/día/año (7/27/2023)']);
    });

    it('which, changed, makes the preview of the file again with the dates read the other way', async () => {
      await preview();
      chooseOption(order(), 'día/mes/año (27/7/2023)');
      await show();

      const asked = request();
      expect(asked.request.params.get('dateOrder')).toBe('dmy');
      asked.flush(result({ sample: [row({ date: '2026-05-11' })] }));
      await show();
      expect(selectedTexts(order())).toEqual(['día/mes/año (27/7/2023)']);
      expect(sampleCells()[0]).toBe('11/05/2026');
    });

    // Its list hangs from the body, over the dimmed area around the dialog: a click there is how the list is put away.
    it('whose open list a click outside the dialog closes, and the dialog stays with its preview', async () => {
      let closed = 0;
      fixture.componentInstance.closed.subscribe(() => closed++);
      await preview();
      openSelect(order());
      await show();
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

      el.querySelector<HTMLElement>('.modal-backdrop')!.click();
      await show();
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
      expect(closed).toBe(0);
      expect(tile('Casos a importar')).toBe('3');

      // With no list open, the same click is the way out it always was.
      el.querySelector<HTMLElement>('.modal-backdrop')!.click();
      expect(closed).toBe(1);
    });

    it('which, changed before a file is chosen, asks for nothing and is the order the file is then read with', async () => {
      await show();
      chooseOption(order(), 'día/mes/año (27/7/2023)');
      await show();
      http.expectNone('/api/import');

      chooseFile();
      const asked = request();
      expect(asked.request.params.get('dateOrder')).toBe('dmy');
      asked.flush(result());
      await show();
    });
  });

  // A browser says nothing when the file picked is the one the field already has. After the
  // rows the preview rejected are corrected in the sheet, that is the file a person picks.
  it('of a file replaced by another before it arrives is cancelled: the preview is the one of the other file', async () => {
    chooseFile('vieja.xlsx');
    const old = request();
    chooseFile('nueva.xlsx');
    const fresh = request();
    expect(old.cancelled).toBeTrue();
    expect(((fresh.request.body as FormData).get('file') as File).name).toBe('nueva.xlsx');

    fresh.flush(result({ toCreate: 4 }));
    await show();
    expect(tile('Casos a importar')).toBe('4');
    expect(confirm().textContent?.trim()).toBe('Importar 4 casos');
  });

  it('is cancelled when the dialog goes away before it arrives', () => {
    chooseFile();
    const asked = request();
    fixture.destroy();
    expect(asked.cancelled).toBeTrue();
  });

  it('is dropped with its file as the file picker opens, so the same file chosen again, corrected, gets a preview', async () => {
    await preview(WITH_UNKNOWN);
    // The press that opens the picker. Its default is held back: no picker opens in a test.
    fileField().addEventListener('click', (event) => event.preventDefault(), { once: true });
    fileField().dispatchEvent(new MouseEvent('click', { cancelable: true }));
    await show();

    expect(fileField().value).toBe('');
    expect(tile('Filas rechazadas')).toBe('');
    expect(isDisabled(confirm())).toBeTrue();

    chooseFile();
    request().flush(result());
    await show();
    expect(tile('Filas rechazadas')).toBe('0');
  });

  // The two tables scroll sideways inside boxes that a keyboard could not reach (WCAG 2.1.1), and
  // the browser made the long one a stop of the Tab key with no name, its ring mostly off screen.
  it('lets the keyboard scroll the tables of the preview: each box a stop of the Tab key, named, and no higher than part of the dialog', async () => {
    await preview(WITH_UNKNOWN);
    const regions = Array.from(el.querySelectorAll<HTMLElement>('[role=region]'));

    expect(regions.map((region) => region.getAttribute('aria-label'))).toEqual(['Filas rechazadas', 'Primeras filas que se importan']);
    for (const region of regions) {
      expect(region.tabIndex).withContext(region.getAttribute('aria-label') ?? '').toBe(0);
      expect(region.querySelector('table')).not.toBeNull();
      expect(getComputedStyle(region).maxHeight).toBe('320px');
      expect(getComputedStyle(region).overflowY).toBe('auto');
    }
  });

  // Disabled while it imported, it gave the focus away to nowhere.
  it('keeps the focus on the button that imports while it works', async () => {
    await preview();
    confirm().focus();
    confirm().click();
    fixture.detectChanges();

    expect(confirm().textContent?.trim()).toBe('Procesando…');
    expect(document.activeElement).toBe(confirm());
    request('import').flush({ ...result(), dryRun: false });
    await show();
  });
});
