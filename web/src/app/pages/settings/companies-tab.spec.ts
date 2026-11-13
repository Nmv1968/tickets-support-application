import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { Company } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { Toast } from '../../core/toast';
import { answerCatalogs } from '../../testing/catalogs';
import { CompaniesTab } from './companies-tab';

const REFUSED = { status: 409, statusText: 'Conflict' };

// The tab with the real Api and the real shared catalogs: the tests act on its controls and look
// at the requests that leave and at what the list shows.
describe('CompaniesTab, the client companies in Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<CompaniesTab>;
  let el: HTMLElement;

  const acme: Company = { id: 1, name: 'Acme', active: true, tickets: 3 };
  const bodega: Company = { id: 2, name: 'Bodega Sur', active: true, tickets: 0 };
  const zeta: Company = { id: 3, name: 'Zeta', active: false, tickets: 1 };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  // Also catches a write nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  function settle(): void {
    tick();
    render();
  }

  /** Answers the read of the shared catalogs, which every arrival and every write ends with. */
  function catalogs(companies: Company[]): void {
    answerCatalogs(http, { companies });
    settle();
  }

  function open(companies: Company[] = [acme, bodega, zeta]): void {
    fixture = TestBed.createComponent(CompaniesTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    catalogs(companies);
  }

  const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.card.divide-y > div')];
  const nameOf = (row: HTMLElement): HTMLInputElement => row.querySelector('input')!;
  const button = (row: HTMLElement, text: string): HTMLButtonElement => [...row.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
  const trash = (row: HTMLElement): HTMLButtonElement => row.querySelector<HTMLButtonElement>('button[aria-label^="Eliminar "]')!;
  const newName = (): HTMLInputElement => el.querySelector<HTMLInputElement>('#company-name')!;
  const add = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  const toasts = (): string[] => TestBed.inject(Toast).items().map((item) => item.text);
  const write = (method: string, url: string): TestRequest => http.expectOne({ method, url });

  function type(input: HTMLInputElement, value: string, event = 'input'): void {
    input.value = value;
    input.dispatchEvent(new Event(event));
    render();
  }

  function click(target: HTMLElement): void {
    target.click();
    render();
  }

  /** The question on screen, which the shell draws as a dialog. */
  const asked = (): unknown => TestBed.inject(Confirm).current();

  /** The person answers it. */
  function answer(confirmed: boolean): void {
    TestBed.inject(Confirm).answer(confirmed);
    render();
  }

  it('lists each company with the cases it has, and says which are inactive', fakeAsync(() => {
    open();

    expect(rows().map((row) => nameOf(row).value)).toEqual(['Acme', 'Bodega Sur', 'Zeta']);
    // What each row says after the name: cases, state and what can be done.
    const said = (row: HTMLElement): string[] => [...row.querySelectorAll('span, button')].map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
    expect(rows().map(said)).toEqual([
      ['3 casos', 'Desactivar'],
      ['0 casos', 'Desactivar'],
      ['1 caso', 'Inactiva', 'Activar'],
    ]);
  }));

  it('invites to add the first one when there is none', fakeAsync(() => {
    open([]);

    expect(el.textContent).toContain('No hay empresas. Agrega arriba las que reportan casos.');
  }));

  describe('Agregar', () => {
    it('needs a name', fakeAsync(() => {
      open();

      expect(add().disabled).toBeTrue();
      type(newName(), '   ');
      expect(add().disabled).toBeTrue();
      type(newName(), 'Ferretería El Tornillo');
      expect(add().disabled).toBeFalse();
    }));

    // The server stores up to 200 characters.
    it('takes names as long as the server stores', fakeAsync(() => {
      open();

      expect(newName().maxLength).toBe(200);
      expect(nameOf(rows()[0]).maxLength).toBe(200);
    }));

    it('sends the name alone, shows the new company and leaves the field ready for the next one', fakeAsync(() => {
      open();
      type(newName(), '  Ferretería El Tornillo ');
      click(add());

      const save = write('POST', '/api/companies');
      expect(save.request.body).toEqual({ name: 'Ferretería El Tornillo' });
      const ferreteria: Company = { id: 9, name: 'Ferretería El Tornillo', active: true, tickets: 0 };
      save.flush(ferreteria);
      settle();
      catalogs([acme, bodega, ferreteria, zeta]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo', 'Zeta']);
      expect(newName().value).toBe('');
      expect(toasts()).toEqual(['Empresa agregada']);
      tick(3000);
    }));

    it('keeps the name typed when the server refuses it, and says why', fakeAsync(() => {
      open();
      type(newName(), 'acme');
      click(add());

      write('POST', '/api/companies').flush({ message: 'Ya existe una empresa con ese nombre' }, REFUSED);
      settle();
      catalogs([acme, bodega, zeta]);

      expect(newName().value).toBe('acme');
      expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
      tick(6000);
    }));

    it('does not send the same name twice while the first one is on its way', fakeAsync(() => {
      open();
      type(newName(), 'Ferretería El Tornillo');
      click(add());

      expect(add().disabled).toBeTrue();
      newName().form!.dispatchEvent(new Event('submit'));
      render();

      // Exactly one POST: `expectOne` fails on two.
      write('POST', '/api/companies').flush({ id: 9, name: 'Ferretería El Tornillo', active: true, tickets: 0 });
      settle();
      catalogs([acme, bodega, zeta]);
      tick(3000);
    }));
  });

  describe('a name edited in the list', () => {
    // The cases of the company show the new name from then on: that is the server's doing.
    it('is saved when the field is left', fakeAsync(() => {
      open();
      type(nameOf(rows()[1]), ' Bodega del Sur ', 'change');

      const save = write('PATCH', '/api/companies/2');
      expect(save.request.body).toEqual({ name: 'Bodega del Sur' });
      save.flush({ ...bodega, name: 'Bodega del Sur' });
      settle();
      catalogs([acme, { ...bodega, name: 'Bodega del Sur' }, zeta]);

      expect(nameOf(rows()[1]).value).toBe('Bodega del Sur');
      expect(toasts()).toEqual(['Nombre actualizado']);
      tick(3000);
    }));

    it('goes back to the name the company has when the server refuses it', fakeAsync(() => {
      open();
      type(nameOf(rows()[1]), 'Acme', 'change');

      write('PATCH', '/api/companies/2').flush({ message: 'Ya existe una empresa con ese nombre' }, REFUSED);
      settle();
      catalogs([acme, bodega, zeta]);

      expect(nameOf(rows()[1]).value).toBe('Bodega Sur');
      expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
      tick(6000);
    }));

    it('left empty or unchanged sends nothing, and the name stays', fakeAsync(() => {
      open();

      type(nameOf(rows()[1]), '   ', 'change');
      settle();
      expect(nameOf(rows()[1]).value).toBe('Bodega Sur');

      type(nameOf(rows()[1]), ' Bodega Sur ', 'change');
      settle();
      expect(nameOf(rows()[1]).value).toBe('Bodega Sur');
    }));
  });

  describe('Desactivar and Activar', () => {
    it('take a company out of the lists for new cases and put it back', fakeAsync(() => {
      open();

      click(button(rows()[0], 'Desactivar'));
      const off = write('PATCH', '/api/companies/1');
      expect(off.request.body).toEqual({ active: false });
      off.flush({ ...acme, active: false });
      settle();
      catalogs([bodega, { ...acme, active: false }, zeta]);
      expect(toasts()).toEqual(['Empresa desactivada']);

      click(button(rows()[2], 'Activar'));
      const on = write('PATCH', '/api/companies/3');
      expect(on.request.body).toEqual({ active: true });
      on.flush({ ...zeta, active: true });
      settle();
      catalogs([bodega, zeta, { ...acme, active: false }]);
      expect(toasts()).toEqual(['Empresa desactivada', 'Empresa activada']);
      tick(3000);
    }));
  });

  describe('Eliminar', () => {
    // Its cases would be left without a company: the way out is to deactivate it.
    it('is not offered for a company with cases, and says what to do instead', fakeAsync(() => {
      open();

      expect(trash(rows()[0]).disabled).toBeTrue();
      expect(trash(rows()[0]).title).toBe('Tiene casos: desactívala o cambia la empresa de sus casos');
      expect(trash(rows()[2]).disabled).toBeTrue();
      expect(trash(rows()[1]).disabled).toBeFalse();
      expect(trash(rows()[1]).getAttribute('aria-label')).toBe('Eliminar Bodega Sur');
    }));

    // The trash is next to "Desactivar", and what it does cannot be undone.
    it('asks first, naming the company, and sends nothing until the person says yes', fakeAsync(() => {
      open();
      click(trash(rows()[1]));

      expect(asked()).toEqual(jasmine.objectContaining({ title: '¿Eliminar la empresa «Bodega Sur»?', confirmLabel: 'Eliminar', danger: true }));
      http.expectNone({ method: 'DELETE', url: '/api/companies/2' });
      answer(false);
    }));

    it('confirmed, removes a company without cases from the list', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      write('DELETE', '/api/companies/2').flush(null);
      settle();
      catalogs([acme, zeta]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Acme', 'Zeta']);
      expect(toasts()).toEqual(['Empresa eliminada']);
      tick(3000);
    }));

    // No DELETE leaves: `http.verify` fails on a request nobody answered.
    it('cancelled, deletes nothing and says nothing', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(false);

      expect(asked()).toBeNull();
      expect(rows().map((row) => nameOf(row).value)).toEqual(['Acme', 'Bodega Sur', 'Zeta']);
      expect(toasts()).toEqual([]);
    }));

    // A case of the company was registered from another screen after this list was read.
    it('refused by the server, shows its reason and the list as it is now', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      const reason = 'Bodega Sur tiene 1 caso. Desactívala para que no aparezca en los casos nuevos, o cambia la empresa de sus casos antes de eliminarla.';
      write('DELETE', '/api/companies/2').flush({ message: reason }, REFUSED);
      settle();
      catalogs([acme, { ...bodega, tickets: 1 }, zeta]);

      expect(toasts()).toEqual([reason]);
      expect(trash(rows()[1]).disabled).toBeTrue();
      tick(6000);
    }));
  });
});
