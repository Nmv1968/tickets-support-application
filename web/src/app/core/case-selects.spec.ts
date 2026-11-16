import type { HttpTestingController } from '@angular/common/http/testing';
import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FAILURE, MODULES, TRAINING } from '../testing/fixtures';
import { httpTestBed } from '../testing/http';
import { chooseOption, clearSelect, closeSelect, optionTexts, removeChosen, typeInSelect } from '../testing/ng-select';
import { screenOf, toasts } from '../testing/screen';
import type { Priority, TicketStatus } from './api';
import { AssigneeSelect, CompanySelect, ModuleSelect, PrioritySelect, StatusSelect, SupportTypeSelect } from './case-selects';
import { Catalogs, NOBODY } from './catalogs';

/** A form with each select as the screens use it: in the form of a case, and in a filter. */
@Component({
  imports: [CompanySelect, StatusSelect, PrioritySelect, AssigneeSelect, ModuleSelect, SupportTypeSelect],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label for="company">Empresa</label>
    <app-company-select #company inputId="company" placeholder="Elige o escribe una empresa" creatable required [items]="catalogs.activeCompanies()" [(value)]="companyId" />
    <label for="filter-company">Empresa</label>
    <app-company-select inputId="filter-company" placeholder="Todas" [items]="catalogs.companies()" [(value)]="filterCompanyId" />
    <label for="status">Estado</label>
    <app-status-select inputId="status" [(value)]="status" />
    <label for="filter-status">Estado</label>
    <app-status-select inputId="filter-status" placeholder="Todos" clearable [(value)]="filterStatus" />
    <label for="priority">Prioridad</label>
    <app-priority-select inputId="priority" [(value)]="priority" />
    <app-assignee-select ariaLabel="Filtrar por responsable" placeholder="Responsable: todos" [items]="catalogs.assigneeFilterOptions()" [(value)]="assignee" />
    <label for="module">Módulo</label>
    <app-module-select inputId="module" [items]="modules" [(value)]="moduleId" />
    <label for="types">Tipos de soporte</label>
    <app-support-type-select inputId="types" multiple [items]="types" [(value)]="typeIds" />
    <label for="type">Tipo de soporte</label>
    <app-support-type-select inputId="type" placeholder="Todos" [items]="types" [(value)]="typeId" />
  `,
})
class CaseForm {
  protected readonly catalogs = inject(Catalogs);
  protected readonly modules = MODULES;
  protected readonly types = [TRAINING, FAILURE];
  readonly companyId = signal<number | null>(null);
  readonly filterCompanyId = signal<number | null>(null);
  readonly status = signal<TicketStatus>('PENDING');
  readonly filterStatus = signal<TicketStatus | null>('RESOLVED');
  readonly priority = signal<Priority | null>(null);
  readonly assignee = signal<number | 'none' | null>(null);
  readonly moduleId = signal<number | null>(null);
  readonly typeIds = signal<number[]>([]);
  readonly typeId = signal<number | null>(null);
  readonly company = viewChild.required<CompanySelect<number | null>>('company');
}

describe('The selects of the fields of a case', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<CaseForm>;
  let form: CaseForm;
  let el: HTMLElement;

  beforeEach(() => {
    http = httpTestBed();
    const catalogs = TestBed.inject(Catalogs);
    catalogs.companies.set([
      { id: 1, name: 'Acme', active: true, tickets: 3 },
      { id: 6, name: 'Taller Viejo', active: false, tickets: 2 },
    ]);
    catalogs.assignees.set([{ id: 4, name: 'Ana', active: true, tickets: 1 }]);
    fixture = TestBed.createComponent(CaseForm);
    form = fixture.componentInstance;
    el = fixture.nativeElement as HTMLElement;
  });

  afterEach(() => http.verify());

  /** A screen update as the browser runs it: ngModel writes a changed value into its select right after. */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  const { select, chosen, offers, pick } = screenOf(() => el, render);
  const box = (name: string): HTMLInputElement => select(name).querySelector<HTMLInputElement>('input[role=combobox]')!;
  const placeholder = (name: string): string => select(name).querySelector('.ng-placeholder')?.textContent?.trim() ?? '';

  describe('the company', () => {
    it('offers what the screen gives it, and the one chosen is the value of the screen', fakeAsync(() => {
      render();

      expect(placeholder('company')).toBe('Elige o escribe una empresa');
      expect(offers('company')).toEqual(['Acme']);
      expect(offers('filter-company')).toEqual(['Acme', 'Taller Viejo']);
      pick('company', 'Acme');
      expect(form.companyId()).toBe(1);

      form.filterCompanyId.set(6);
      render();
      expect(chosen('filter-company')).toEqual(['Taller Viejo']);
    }));

    it('creatable, adds the name typed to the catalog with "Crear empresa «X»" and chooses it', fakeAsync(() => {
      render();
      typeInSelect(select('company'), 'Ferretería El Tornillo');
      render();
      expect(optionTexts(select('company'))).toEqual(['Crear empresa «Ferretería El Tornillo»']);

      chooseOption(select('company'), 'Crear empresa «Ferretería El Tornillo»');
      const save = http.expectOne({ method: 'POST', url: '/api/companies' });
      expect(save.request.body).toEqual({ name: 'Ferretería El Tornillo' });
      save.flush({ id: 9, name: 'Ferretería El Tornillo', active: true, tickets: 0 });
      tick();
      render();

      expect(form.companyId()).toBe(9);
      expect(chosen('company')).toEqual(['Ferretería El Tornillo']);
      expect(toasts()).toEqual(['Empresa «Ferretería El Tornillo» creada']);
      tick(3000);
    }));

    // A filter looks for a company among those that exist.
    it('not creatable, offers nothing for a name it does not have', fakeAsync(() => {
      render();
      typeInSelect(select('filter-company'), 'Ferretería');
      render();

      expect(optionTexts(select('filter-company'))).toEqual(['Sin resultados']);
      closeSelect(select('filter-company'));
      render();
    }));

    it('cuts a name to create where the catalog does, and says when the form needs it', fakeAsync(() => {
      render();

      expect(box('company').getAttribute('maxlength')).toBe('200');
      expect(box('company').getAttribute('aria-required')).toBe('true');
      expect(box('filter-company').hasAttribute('maxlength')).toBeFalse();
      expect(box('filter-company').hasAttribute('aria-required')).toBeFalse();
    }));

    it('takes the focus when the screen gives it', fakeAsync(() => {
      render();
      form.company().focus();

      expect(document.activeElement).toBe(box('company'));
    }));
  });

  describe('the status', () => {
    it('offers the three statuses in their order, and a case cannot be left without one', fakeAsync(() => {
      render();

      expect(chosen('status')).toEqual(['Pendiente']);
      expect(offers('status')).toEqual(['Sin resolver', 'Pendiente', 'Resuelto']);
      expect(() => clearSelect(select('status'))).toThrowError(/cannot be cleared/);
      pick('status', 'Resuelto');
      expect(form.status()).toBe('RESOLVED');
    }));

    it('in a filter, can be emptied: every status', fakeAsync(() => {
      render();
      clearSelect(select('filter-status'));
      render();

      expect(form.filterStatus()).toBeNull();
      expect(placeholder('filter-status')).toBe('Todos');
    }));
  });

  it('the priority offers the four from the lowest, and empty says the case has none', fakeAsync(() => {
    render();

    expect(placeholder('priority')).toBe('Sin prioridad');
    expect(offers('priority')).toEqual(['Baja', 'Media', 'Alta', 'Crítica']);
    pick('priority', 'Crítica');
    expect(form.priority()).toBe('CRITICAL');
  }));

  // On the board it has no label of its own.
  it('the responsible can be named without a label, and a filter offers the cases nobody has', fakeAsync(() => {
    render();

    expect(box('Filtrar por responsable').getAttribute('aria-label')).toBe('Filtrar por responsable');
    expect(placeholder('Filtrar por responsable')).toBe('Responsable: todos');
    expect(offers('Filtrar por responsable')).toEqual([NOBODY.name, 'Ana']);
    pick('Filtrar por responsable', 'Sin asignar');
    expect(form.assignee()).toBe('none');
  }));

  it('the module goes by its full name', fakeAsync(() => {
    render();

    expect(placeholder('module')).toBe('Sin módulo');
    expect(offers('module')).toEqual(['Ventas', 'Ventas / Facturas', 'Bodega vieja']);
    pick('module', 'Ventas / Facturas');
    expect(form.moduleId()).toBe(2);
  }));

  describe('the support types', () => {
    it('of a case are several, each a chip with its "×", and the list stays open after each choice', fakeAsync(() => {
      render();
      expect(placeholder('types')).toBe('Sin tipo de soporte');

      pick('types', 'Capacitación');
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();
      pick('types', 'Falla del sistema');
      closeSelect(select('types'));
      render();
      expect(form.typeIds()).toEqual([1, 2]);
      expect(chosen('types')).toEqual(['Capacitación', 'Falla del sistema']);

      removeChosen(select('types'), 'Capacitación');
      render();
      expect(form.typeIds()).toEqual([2]);
    }));

    it('of a filter is one, a chip with no "×"', fakeAsync(() => {
      render();
      pick('type', 'Falla del sistema');

      expect(form.typeId()).toBe(2);
      expect(select('type').querySelector('.ng-value app-type-chip')!.textContent?.trim()).toBe('Falla del sistema');
      expect(select('type').querySelector('.ng-value app-type-chip button')).toBeNull();
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    }));
  });

  // Each "×" was named "Quitar": four of them in the form of a case, and nothing said what each took away.
  it('names the "×" that empties each one by what it empties', fakeAsync(() => {
    form.companyId.set(1);
    form.priority.set('HIGH');
    form.assignee.set(4);
    form.moduleId.set(MODULES[0].id);
    form.typeIds.set([TRAINING.id]);
    form.typeId.set(FAILURE.id);
    render();
    const clear = (name: string): string | null => select(name).querySelector('.ng-clear-wrapper')?.getAttribute('title') ?? null;

    expect(clear('company')).toBe('Quitar empresa');
    expect(clear('filter-status')).toBe('Quitar estado');
    expect(clear('priority')).toBe('Quitar prioridad');
    expect(el.querySelector('app-assignee-select .ng-clear-wrapper')!.getAttribute('title')).toBe('Quitar responsable');
    expect(clear('module')).toBe('Quitar módulo');
    expect(clear('types')).toBe('Quitar todos los tipos de soporte');
    expect(clear('type')).toBe('Quitar tipo de soporte');
  }));
});
