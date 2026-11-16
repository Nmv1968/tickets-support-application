import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { SupportType } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { answerCatalogs } from '../../testing/catalogs';
import { buttonIn, screenOf, toasts } from '../../testing/screen';
import { SupportTypesTab } from './support-types-tab';

const REFUSED = { status: 409, statusText: 'Conflict' };
const NOT_A_COLOR = 'El color debe ser un código hexadecimal como #1a2b3c';

// The tab with the real Api and the real shared catalogs: the tests act on its controls and look
// at the requests that leave and at what the list shows.
describe('SupportTypesTab, the support types in Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<SupportTypesTab>;
  let el: HTMLElement;

  const training: SupportType = { id: 1, name: 'Capacitación', color: '#12b76a', active: true, tickets: 3 };
  const failure: SupportType = { id: 2, name: 'Falla del sistema', color: '#b91c1c', active: true, tickets: 0 };
  const other: SupportType = { id: 3, name: 'Otro', color: '#64748b', active: false, tickets: 1 };

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
  function catalogs(supportTypes: SupportType[]): void {
    answerCatalogs(http, { supportTypes });
    settle();
  }

  function open(supportTypes: SupportType[] = [training, failure, other]): void {
    fixture = TestBed.createComponent(SupportTypesTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    catalogs(supportTypes);
  }

  const { click, type } = screenOf(() => el, render);
  const button = (row: HTMLElement, text: string): HTMLButtonElement => buttonIn(row, text);
  const form = (): HTMLFormElement => el.querySelector('form')!;
  const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.card.divide-y > div')];
  const nameOf = (row: HTMLElement): HTMLInputElement => row.querySelector<HTMLInputElement>('input[aria-label^="Nombre del tipo"]')!;
  /** The two controls of a colour, in the form or in a row: the picker of the browser and the field for its code. */
  const picker = (within: HTMLElement): HTMLInputElement => within.querySelector<HTMLInputElement>('input[type=color]')!;
  const hex = (within: HTMLElement): HTMLInputElement => within.querySelector<HTMLInputElement>('input[aria-label$="en hexadecimal"]')!;
  const chip = (within: HTMLElement): HTMLElement => within.querySelector<HTMLElement>('app-type-chip')!;
  const errorOf = (within: HTMLElement): string | null => within.querySelector('[role=alert]')?.textContent?.trim() ?? null;
  const trash = (row: HTMLElement): HTMLButtonElement => row.querySelector<HTMLButtonElement>('button[aria-label^="Eliminar "]')!;
  const newName = (): HTMLInputElement => el.querySelector<HTMLInputElement>('#type-name')!;
  const add = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
  const write = (method: string, url: string): TestRequest => http.expectOne({ method, url });

  /** Text typed in a field that is then left. */
  function leave(input: HTMLInputElement, value: string): void {
    type(input, value);
    input.dispatchEvent(new Event('change'));
    render();
  }

  /** A colour chosen in the picker of the browser, which is then closed. */
  function pick(input: HTMLInputElement, color: string): void {
    type(input, color);
    input.dispatchEvent(new Event('change'));
    render();
  }

  /** The question on screen, which the shell draws as a dialog. */
  const asked = (): unknown => TestBed.inject(Confirm).current();

  /** The person answers it. */
  function answer(confirmed: boolean): void {
    TestBed.inject(Confirm).answer(confirmed);
    render();
  }

  it('lists each type as it looks on a case, with the cases that carry it, and says which are inactive', fakeAsync(() => {
    open();

    expect(rows().map((row) => nameOf(row).value)).toEqual(['Capacitación', 'Falla del sistema', 'Otro']);
    expect(rows().map((row) => chip(row).textContent?.trim())).toEqual(['Capacitación', 'Falla del sistema', 'Otro']);
    expect(rows().map((row) => getComputedStyle(chip(row)).backgroundColor)).toEqual(['rgb(18, 183, 106)', 'rgb(185, 28, 28)', 'rgb(100, 116, 139)']);
    expect(rows().map((row) => hex(row).value)).toEqual(['#12b76a', '#b91c1c', '#64748b']);
    expect(rows().map((row) => picker(row).value)).toEqual(['#12b76a', '#b91c1c', '#64748b']);
    // What each row says after the chip, the name and the colour: cases, state and what can be done.
    const said = (row: HTMLElement): string[] =>
      [...row.querySelectorAll('span, button')]
        .filter((item) => !item.closest('app-type-chip'))
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '')
        .filter(Boolean);
    expect(rows().map(said)).toEqual([
      ['3 casos', 'Desactivar'],
      ['0 casos', 'Desactivar'],
      ['1 caso', 'Inactivo', 'Activar'],
    ]);
  }));

  it('invites to add the first one when there is none', fakeAsync(() => {
    open([]);

    expect(el.textContent).toContain('No hay tipos de soporte. Agrega arriba el primero.');
  }));

  describe('the colour of the type being added', () => {
    it('starts as the neutral grey, and shows how the type will look on a case', fakeAsync(() => {
      open();

      expect(picker(form()).value).toBe('#64748b');
      expect(hex(form()).value).toBe('#64748b');
      expect(getComputedStyle(chip(form())).backgroundColor).toBe('rgb(100, 116, 139)');

      type(newName(), 'Duda de uso');
      expect(chip(form()).textContent?.trim()).toBe('Duda de uso');
    }));

    it('chosen in the picker, is written in the field next to it', fakeAsync(() => {
      open();
      pick(picker(form()), '#f5a524');

      expect(hex(form()).value).toBe('#f5a524');
      expect(getComputedStyle(chip(form())).backgroundColor).toBe('rgb(245, 165, 36)');
    }));

    it('written as #rrggbb, is shown by the picker as soon as it is whole', fakeAsync(() => {
      open();
      type(hex(form()), '#1A2B');
      expect(picker(form()).value).toBe('#64748b');
      // Half written is not an error yet: every colour is something else until its last character.
      expect(errorOf(form())).toBeNull();

      type(hex(form()), '#1A2B3C');
      expect(picker(form()).value).toBe('#1a2b3c');
      // What the person wrote is not rewritten under their hands.
      expect(hex(form()).value).toBe('#1A2B3C');

      hex(form()).dispatchEvent(new Event('change'));
      render();
      expect(hex(form()).value).toBe('#1a2b3c');
      expect(errorOf(form())).toBeNull();
    }));

    it('left as something that is not a colour, says so and cannot be added until it is one', fakeAsync(() => {
      open();
      type(newName(), 'Duda de uso');
      expect(add().disabled).toBeFalse();

      for (const text of ['rojo', '#12', '#12345g', '1a2b3c', '']) {
        leave(hex(form()), text);
        expect(errorOf(form())).withContext(text).toBe(NOT_A_COLOR);
        expect(hex(form()).getAttribute('aria-invalid')).toBe('true');
        expect(hex(form()).getAttribute('aria-describedby')).toBe(form().querySelector('[role=alert]')!.id);
        expect(add().disabled).toBeTrue();
        // Enter in the name sends the form all the same: nothing leaves.
        form().dispatchEvent(new Event('submit'));
        render();
      }
      // The picker keeps the last colour that was one.
      expect(picker(form()).value).toBe('#64748b');

      type(hex(form()), '#0c7beb');
      expect(errorOf(form())).toBeNull();
      expect(hex(form()).hasAttribute('aria-invalid')).toBeFalse();
      expect(add().disabled).toBeFalse();
    }));

    it('picked after a wrong code, replaces it and takes the message away', fakeAsync(() => {
      open();
      leave(hex(form()), 'rojo');
      pick(picker(form()), '#e5484d');

      expect(hex(form()).value).toBe('#e5484d');
      expect(errorOf(form())).toBeNull();
    }));
  });

  describe('Agregar', () => {
    it('needs a name', fakeAsync(() => {
      open();

      expect(add().disabled).toBeTrue();
      type(newName(), '   ');
      expect(add().disabled).toBeTrue();
      type(newName(), 'Duda de uso');
      expect(add().disabled).toBeFalse();
      // The server stores up to 60 characters.
      expect(newName().maxLength).toBe(60);
    }));

    it('sends the name and the colour, shows the new type and leaves the name ready for the next one', fakeAsync(() => {
      open();
      type(newName(), '  Duda de uso ');
      leave(hex(form()), ' #0C7BEB ');
      click(add());

      const save = write('POST', '/api/support-types');
      expect(save.request.body).toEqual({ name: 'Duda de uso', color: '#0c7beb' });
      const doubt: SupportType = { id: 9, name: 'Duda de uso', color: '#0c7beb', active: true, tickets: 0 };
      save.flush(doubt);
      settle();
      catalogs([training, doubt, failure, other]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Capacitación', 'Duda de uso', 'Falla del sistema', 'Otro']);
      expect(newName().value).toBe('');
      expect(toasts()).toEqual(['Tipo de soporte agregado']);
      tick(3000);
    }));

    it('keeps the name typed when the server refuses it, and says why', fakeAsync(() => {
      open();
      type(newName(), 'capacitacion');
      click(add());

      write('POST', '/api/support-types').flush({ message: 'Ya existe un tipo de soporte con ese nombre' }, REFUSED);
      settle();
      catalogs([training, failure, other]);

      expect(newName().value).toBe('capacitacion');
      expect(toasts()).toEqual(['Ya existe un tipo de soporte con ese nombre']);
      tick(6000);
    }));

    it('does not send the same type twice while the first one is on its way', fakeAsync(() => {
      open();
      type(newName(), 'Duda de uso');
      click(add());

      expect(add().disabled).toBeTrue();
      form().dispatchEvent(new Event('submit'));
      render();

      // Exactly one POST: `expectOne` fails on two.
      write('POST', '/api/support-types').flush({ id: 9, name: 'Duda de uso', color: '#64748b', active: true, tickets: 0 });
      settle();
      catalogs([training, failure, other]);
      tick(3000);
    }));
  });

  describe('a name edited in the list', () => {
    it('is saved when the field is left', fakeAsync(() => {
      open();
      leave(nameOf(rows()[1]), ' Falla ');

      const save = write('PATCH', '/api/support-types/2');
      expect(save.request.body).toEqual({ name: 'Falla' });
      save.flush({ ...failure, name: 'Falla' });
      settle();
      catalogs([training, { ...failure, name: 'Falla' }, other]);

      expect(nameOf(rows()[1]).value).toBe('Falla');
      expect(chip(rows()[1]).textContent?.trim()).toBe('Falla');
      expect(toasts()).toEqual(['Nombre actualizado']);
      tick(3000);
    }));

    it('goes back to the name the type has when the server refuses it, or when it is left empty', fakeAsync(() => {
      open();
      leave(nameOf(rows()[1]), 'Capacitación');

      write('PATCH', '/api/support-types/2').flush({ message: 'Ya existe un tipo de soporte con ese nombre' }, REFUSED);
      settle();
      catalogs([training, failure, other]);
      expect(nameOf(rows()[1]).value).toBe('Falla del sistema');
      expect(toasts()).toEqual(['Ya existe un tipo de soporte con ese nombre']);

      leave(nameOf(rows()[1]), '   ');
      settle();
      expect(nameOf(rows()[1]).value).toBe('Falla del sistema');
      tick(6000);
    }));
  });

  describe('a colour changed in the list', () => {
    // The picker reports every colour the pointer goes over; only the one it is closed on is saved.
    it('is saved when the picker is closed, not while a colour is being looked for', fakeAsync(() => {
      open();
      type(picker(rows()[1]), '#aa0000');
      type(picker(rows()[1]), '#dd2200');
      http.expectNone({ method: 'PATCH', url: '/api/support-types/2' });

      pick(picker(rows()[1]), '#ff5500');
      const save = write('PATCH', '/api/support-types/2');
      expect(save.request.body).toEqual({ color: '#ff5500' });
      save.flush({ ...failure, color: '#ff5500' });
      settle();
      catalogs([training, { ...failure, color: '#ff5500' }, other]);

      expect(hex(rows()[1]).value).toBe('#ff5500');
      expect(getComputedStyle(chip(rows()[1])).backgroundColor).toBe('rgb(255, 85, 0)');
      expect(toasts()).toEqual(['Color actualizado']);
      tick(3000);
    }));

    it('is saved when its code is written and the field is left', fakeAsync(() => {
      open();
      leave(hex(rows()[0]), '#0C7BEB');

      const save = write('PATCH', '/api/support-types/1');
      expect(save.request.body).toEqual({ color: '#0c7beb' });
      save.flush({ ...training, color: '#0c7beb' });
      settle();
      catalogs([{ ...training, color: '#0c7beb' }, failure, other]);

      expect(picker(rows()[0]).value).toBe('#0c7beb');
      tick(3000);
    }));

    it('is not saved from a code that is not a colour, which the row says, nor when it is the colour the type has', fakeAsync(() => {
      open();
      leave(hex(rows()[0]), 'verde');
      expect(errorOf(rows()[0])).toBe(NOT_A_COLOR);
      // The other rows say nothing.
      expect(errorOf(rows()[1])).toBeNull();

      leave(hex(rows()[0]), '#12B76A');
      expect(errorOf(rows()[0])).toBeNull();
      expect(hex(rows()[0]).value).toBe('#12b76a');
      http.expectNone({ method: 'PATCH', url: '/api/support-types/1' });
    }));

    it('goes back to the colour the type has when the server refuses it', fakeAsync(() => {
      open();
      pick(picker(rows()[1]), '#ff5500');

      write('PATCH', '/api/support-types/2').flush({ message: 'El tipo de soporte no existe' }, { status: 404, statusText: 'Not Found' });
      settle();
      catalogs([training, failure, other]);

      expect(picker(rows()[1]).value).toBe('#b91c1c');
      expect(hex(rows()[1]).value).toBe('#b91c1c');
      expect(toasts()).toEqual(['El tipo de soporte no existe']);
      tick(6000);
    }));
  });

  describe('Desactivar and Activar', () => {
    it('take a type out of the lists for new cases and put it back', fakeAsync(() => {
      open();

      click(button(rows()[0], 'Desactivar'));
      const off = write('PATCH', '/api/support-types/1');
      expect(off.request.body).toEqual({ active: false });
      off.flush({ ...training, active: false });
      settle();
      catalogs([failure, { ...training, active: false }, other]);
      expect(toasts()).toEqual(['Tipo de soporte desactivado']);

      click(button(rows()[2], 'Activar'));
      const on = write('PATCH', '/api/support-types/3');
      expect(on.request.body).toEqual({ active: true });
      on.flush({ ...other, active: true });
      settle();
      catalogs([failure, other, { ...training, active: false }]);
      expect(toasts()).toEqual(['Tipo de soporte desactivado', 'Tipo de soporte activado']);
      tick(3000);
    }));
  });

  describe('Eliminar', () => {
    // The cases that carry it would lose it: the way out is to deactivate it.
    it('is not offered for a type that is on cases, and says what to do instead', fakeAsync(() => {
      open();

      expect(trash(rows()[0]).disabled).toBeTrue();
      expect(trash(rows()[0]).title).toBe('Está en casos: desactívalo o quítalo de esos casos');
      expect(trash(rows()[2]).disabled).toBeTrue();
      expect(trash(rows()[1]).disabled).toBeFalse();
      expect(trash(rows()[1]).getAttribute('aria-label')).toBe('Eliminar Falla del sistema');
    }));

    // The trash is next to "Desactivar", and what it does cannot be undone: the colour chosen goes with the type.
    it('asks first, naming the type, and sends nothing until the person says yes', fakeAsync(() => {
      open();
      click(trash(rows()[1]));

      expect(asked()).toEqual(jasmine.objectContaining({ title: '¿Eliminar el tipo de soporte «Falla del sistema»?', confirmLabel: 'Eliminar', danger: true }));
      http.expectNone({ method: 'DELETE', url: '/api/support-types/2' });
      answer(false);
    }));

    it('confirmed, removes a type that is on no case from the list', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      write('DELETE', '/api/support-types/2').flush(null);
      settle();
      catalogs([training, other]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Capacitación', 'Otro']);
      expect(toasts()).toEqual(['Tipo de soporte eliminado']);
      tick(3000);
    }));

    // No DELETE leaves: `http.verify` fails on a request nobody answered.
    it('cancelled, deletes nothing and says nothing', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(false);

      expect(asked()).toBeNull();
      expect(rows().map((row) => nameOf(row).value)).toEqual(['Capacitación', 'Falla del sistema', 'Otro']);
      expect(toasts()).toEqual([]);
    }));

    // A case took the type from another screen after this list was read.
    it('refused by the server, shows its reason and the list as it is now', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      const reason = 'Falla del sistema está en 1 caso. Desactívalo para que no se ofrezca en los casos nuevos, o quítalo de esos casos antes de eliminarlo.';
      write('DELETE', '/api/support-types/2').flush({ message: reason }, REFUSED);
      settle();
      catalogs([training, { ...failure, tickets: 1 }, other]);

      expect(toasts()).toEqual([reason]);
      expect(trash(rows()[1]).disabled).toBeTrue();
      tick(6000);
    }));
  });
});
