import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { SystemModule } from '../../core/api';
import { answerCatalogs, isEveryModuleRead } from '../../testing/catalogs';
import { httpTestBed } from '../../testing/http';
import { chooseOption, clearSelect, closeSelect, ngSelect, optionTexts, selectedTexts } from '../../testing/ng-select';
import { toasts } from '../../testing/screen';
import { ModulesTab } from './modules-tab';

describe('ModulesTab, where a new module goes', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ModulesTab>;
  let el: HTMLElement;

  const sales: SystemModule = { id: 1, name: 'Ventas', parentId: null, active: true, fullName: 'Ventas' };
  const invoices: SystemModule = { id: 2, name: 'Facturas', parentId: 1, active: true, fullName: 'Ventas / Facturas' };
  const stock: SystemModule = { id: 3, name: 'Inventario', parentId: null, active: true, fullName: 'Inventario' };
  const old: SystemModule = { id: 4, name: 'Bodega vieja', parentId: null, active: false, fullName: 'Bodega vieja' };

  beforeEach(() => {
    http = httpTestBed();
  });

  // Also catches a write nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  const everyModule = [sales, invoices, stock, old];

  /** Answers the read of the list of the tab: every module, the inactive ones too. */
  function modulesRead(): void {
    http.expectOne(isEveryModuleRead).flush(everyModule);
    tick();
    render();
  }

  function open(): void {
    fixture = TestBed.createComponent(ModulesTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    modulesRead();
  }

  const parent = (): HTMLElement => ngSelect(el, 'module-parent');

  /** Adds a module with this name and gives back what was sent for it. */
  function add(name: string): unknown {
    const input = el.querySelector<HTMLInputElement>('#module-name')!;
    input.value = name;
    input.dispatchEvent(new Event('input'));
    render();
    el.querySelector<HTMLButtonElement>('form button[type="submit"]')!.click();
    render();

    const save = http.expectOne({ method: 'POST', url: '/api/modules' });
    save.flush({ id: 9 });
    tick();
    // The tab reads its list again, and so do the catalogs every screen shares. Both ask for
    // every module: the tab first, then the catalogs.
    const reads = http.match(isEveryModuleRead);
    expect(reads.length).toBe(2);
    reads[0].flush(everyModule);
    answerCatalogs(http, { modules: everyModule }, reads[1]);
    tick();
    render();
    return save.request.body;
  }

  // One level deep: a module goes inside a main one. The deactivated ones take no new modules.
  it('can go inside any active main module', fakeAsync(() => {
    open();

    expect(el.querySelector('label[for=module-parent]')!.textContent).toBe('Dentro de (opcional)');
    expect(optionTexts(parent())).toEqual(['Ventas', 'Inventario']);
    closeSelect(parent());
  }));

  it('is a main module unless one is chosen for it to go in', fakeAsync(() => {
    open();
    expect(selectedTexts(parent())).toEqual([]);
    expect(parent().textContent).toContain('Módulo principal');

    expect(add('Compras')).toEqual({ name: 'Compras', parentId: null });
  }));

  it('goes inside the module chosen, and the next one too until the choice is taken away', fakeAsync(() => {
    open();
    chooseOption(parent(), 'Ventas');
    render();

    expect(add('Notas de crédito')).toEqual({ name: 'Notas de crédito', parentId: 1 });
    expect(selectedTexts(parent())).toEqual(['Ventas']);
    expect(add('Cotizaciones')).toEqual({ name: 'Cotizaciones', parentId: 1 });

    clearSelect(parent());
    render();
    expect(add('Compras')).toEqual({ name: 'Compras', parentId: null });
  }));
});

describe('ModulesTab, a name edited in the list', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<ModulesTab>;
  let el: HTMLElement;

  const sales: SystemModule = { id: 1, name: 'Ventas', parentId: null, active: true, fullName: 'Ventas' };
  const invoices: SystemModule = { id: 2, name: 'Facturas', parentId: 1, active: true, fullName: 'Ventas / Facturas' };
  const credits: SystemModule = { id: 3, name: 'Notas de crédito', parentId: 1, active: true, fullName: 'Ventas / Notas de crédito' };
  const everyModule = [sales, invoices, credits];

  beforeEach(() => {
    http = httpTestBed();
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function modulesRead(): void {
    http.expectOne(isEveryModuleRead).flush(everyModule);
    tick();
    render();
  }

  function open(): void {
    fixture = TestBed.createComponent(ModulesTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    modulesRead();
  }

  const nameOf = (module: SystemModule): HTMLInputElement => el.querySelector<HTMLInputElement>(`input[aria-label="Nombre del módulo ${module.name}"]`)!;

  function leave(field: HTMLInputElement, typed: string): void {
    field.value = typed;
    field.dispatchEvent(new Event('change'));
    render();
  }

  it('is saved when the field is left', fakeAsync(() => {
    open();
    leave(nameOf(invoices), ' Facturas de venta ');

    const save = http.expectOne({ method: 'PATCH', url: '/api/modules/2' });
    expect(save.request.body).toEqual({ name: 'Facturas de venta' });
    save.flush(null);
    tick();
    const renamed = [sales, { ...invoices, name: 'Facturas de venta' }, credits];
    const reads = http.match(isEveryModuleRead);
    expect(reads.length).toBe(2);
    reads[0].flush(renamed);
    answerCatalogs(http, { modules: renamed }, reads[1]);
    tick();
    render();

    expect(el.querySelector<HTMLInputElement>('input[aria-label="Nombre del módulo Facturas de venta"]')!.value).toBe('Facturas de venta');
  }));

  // The list read again has the same name it had, so nothing redraws the field: it has to be put back.
  it('goes back to the name the module has when the server refuses it, and says why', fakeAsync(() => {
    open();
    const field = nameOf(invoices);
    leave(field, 'NOTAS DE CRÉDITO');

    http
      .expectOne({ method: 'PATCH', url: '/api/modules/2' })
      .flush({ message: 'Ya existe un módulo con ese nombre en Ventas' }, { status: 409, statusText: 'Conflict' });
    tick();
    modulesRead();

    expect(field.value).toBe('Facturas');
    expect(toasts()).toEqual(['Ya existe un módulo con ese nombre en Ventas']);
    tick(6000);
  }));

  it('left empty or unchanged sends nothing, and the name stays', fakeAsync(() => {
    open();
    const field = nameOf(invoices);

    leave(field, '   ');
    expect(field.value).toBe('Facturas');

    leave(field, ' Facturas ');
    expect(field.value).toBe('Facturas');
  }));
});
