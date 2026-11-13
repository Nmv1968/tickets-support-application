import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Assignee, User } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { Toast } from '../../core/toast';
import { answerCatalogs } from '../../testing/catalogs';
import { AssigneesTab } from './assignees-tab';

const REFUSED = { status: 409, statusText: 'Conflict' };

// The tab with the real Api and the real shared catalogs: the tests act on its controls and look
// at the requests that leave and at what the list shows.
describe('AssigneesTab, the responsibles in Configuración', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AssigneesTab>;
  let el: HTMLElement;

  const ana: Assignee = { id: 1, name: 'Ana', active: true, tickets: 3 };
  const jose: Assignee = { id: 2, name: 'José Pérez', active: true, tickets: 0 };
  const zoe: Assignee = { id: 3, name: 'Zoe', active: false, tickets: 1 };
  // A user with the name of a responsible: the two lists have nothing to do with each other.
  const userAna: User = { id: 1, username: 'ana', name: 'Ana', active: true, canLogin: true };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
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
  function catalogs(people: Assignee[]): void {
    answerCatalogs(http, { users: [userAna], assignees: people });
    settle();
  }

  function open(people: Assignee[] = [ana, jose, zoe]): void {
    fixture = TestBed.createComponent(AssigneesTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    catalogs(people);
  }

  const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.card.divide-y > div')];
  const nameOf = (row: HTMLElement): HTMLInputElement => row.querySelector('input')!;
  const button = (row: HTMLElement, text: string): HTMLButtonElement => [...row.querySelectorAll('button')].find((item) => item.textContent?.trim() === text)!;
  const trash = (row: HTMLElement): HTMLButtonElement => row.querySelector<HTMLButtonElement>('button[aria-label^="Eliminar a"]')!;
  const newName = (): HTMLInputElement => el.querySelector<HTMLInputElement>('#assignee-name')!;
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

  it('lists each responsible with the cases they have, and says who is inactive', fakeAsync(() => {
    open();

    expect(rows().map((row) => nameOf(row).value)).toEqual(['Ana', 'José Pérez', 'Zoe']);
    // What each row says after the name: cases, state and what can be done. Nothing about users:
    // a responsible is a name of this list, and no user "is" one.
    const said = (row: HTMLElement): string[] => [...row.querySelectorAll('span, button')].map((item) => item.textContent?.replace(/\s+/g, ' ').trim() ?? '').filter(Boolean);
    expect(rows().map(said)).toEqual([
      ['3 casos', 'Desactivar'],
      ['0 casos', 'Desactivar'],
      ['1 caso', 'Inactivo', 'Activar'],
    ]);
  }));

  // "Cliente" used to be an option of every case; now a team that wants it adds it here.
  it('explains what deactivating and deleting do, without a word about users or about "Cliente"', fakeAsync(() => {
    open();

    const help = el.querySelector('p.text-xs')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(help).toBe('Un responsable inactivo ya no aparece al registrar o reasignar casos, pero conserva los que tiene. Solo se puede eliminar a quien no tiene casos.');
  }));

  it('invites to add the first one when there is none', fakeAsync(() => {
    open([]);

    expect(el.textContent).toContain('No hay responsables. Agrega arriba a quienes atienden los casos.');
  }));

  describe('Agregar', () => {
    it('needs a name', fakeAsync(() => {
      open();

      expect(add().disabled).toBeTrue();
      type(newName(), '   ');
      expect(add().disabled).toBeTrue();
      type(newName(), 'Luis');
      expect(add().disabled).toBeFalse();
    }));

    it('sends the name alone, shows the new responsible and leaves the field ready for the next one', fakeAsync(() => {
      open();
      type(newName(), '  Luis Ñáñez ');
      click(add());

      const save = write('POST', '/api/assignees');
      expect(save.request.body).toEqual({ name: 'Luis Ñáñez' });
      const luis: Assignee = { id: 9, name: 'Luis Ñáñez', active: true, tickets: 0 };
      save.flush(luis);
      settle();
      catalogs([ana, jose, luis, zoe]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Ana', 'José Pérez', 'Luis Ñáñez', 'Zoe']);
      expect(newName().value).toBe('');
      expect(toasts()).toEqual(['Responsable agregado']);
      tick(3000);
    }));

    it('keeps the name typed when the server refuses it, and says why', fakeAsync(() => {
      open();
      type(newName(), 'ana');
      click(add());

      write('POST', '/api/assignees').flush({ message: 'Ya existe un responsable con ese nombre' }, REFUSED);
      settle();
      catalogs([ana, jose, zoe]);

      expect(newName().value).toBe('ana');
      expect(toasts()).toEqual(['Ya existe un responsable con ese nombre']);
      tick(6000);
    }));

    it('does not send the same name twice while the first one is on its way', fakeAsync(() => {
      open();
      type(newName(), 'Luis');
      click(add());

      expect(add().disabled).toBeTrue();
      newName().form!.dispatchEvent(new Event('submit'));
      render();

      // Exactly one POST: `expectOne` fails on two.
      write('POST', '/api/assignees').flush({ id: 9, name: 'Luis', active: true, tickets: 0 });
      settle();
      catalogs([ana, jose, zoe]);
      tick(3000);
    }));
  });

  describe('a name edited in the list', () => {
    it('is saved when the field is left', fakeAsync(() => {
      open();
      type(nameOf(rows()[1]), ' José P. ', 'change');

      const save = write('PATCH', '/api/assignees/2');
      expect(save.request.body).toEqual({ name: 'José P.' });
      save.flush({ ...jose, name: 'José P.' });
      settle();
      catalogs([ana, { ...jose, name: 'José P.' }, zoe]);

      expect(nameOf(rows()[1]).value).toBe('José P.');
      expect(toasts()).toEqual(['Nombre actualizado']);
      tick(3000);
    }));

    it('goes back to the name the responsible has when the server refuses it', fakeAsync(() => {
      open();
      type(nameOf(rows()[1]), 'Ana', 'change');

      write('PATCH', '/api/assignees/2').flush({ message: 'Ya existe un responsable con ese nombre' }, REFUSED);
      settle();
      catalogs([ana, jose, zoe]);

      expect(nameOf(rows()[1]).value).toBe('José Pérez');
      expect(toasts()).toEqual(['Ya existe un responsable con ese nombre']);
      tick(6000);
    }));

    it('left empty or unchanged sends nothing, and the name stays', fakeAsync(() => {
      open();

      type(nameOf(rows()[1]), '   ', 'change');
      settle();
      expect(nameOf(rows()[1]).value).toBe('José Pérez');

      type(nameOf(rows()[1]), ' José Pérez ', 'change');
      settle();
      expect(nameOf(rows()[1]).value).toBe('José Pérez');
    }));
  });

  describe('Desactivar and Activar', () => {
    it('take a responsible out of the lists for new cases and put them back', fakeAsync(() => {
      open();

      click(button(rows()[0], 'Desactivar'));
      const off = write('PATCH', '/api/assignees/1');
      expect(off.request.body).toEqual({ active: false });
      off.flush({ ...ana, active: false });
      settle();
      catalogs([jose, { ...ana, active: false }, zoe]);
      expect(toasts()).toEqual(['Responsable desactivado']);

      click(button(rows()[2], 'Activar'));
      const on = write('PATCH', '/api/assignees/3');
      expect(on.request.body).toEqual({ active: true });
      on.flush({ ...zoe, active: true });
      settle();
      catalogs([jose, zoe, { ...ana, active: false }]);
      expect(toasts()).toEqual(['Responsable desactivado', 'Responsable activado']);
      tick(3000);
    }));
  });

  describe('Eliminar', () => {
    // Their cases would be left without a responsible: the way out is to deactivate them.
    it('is not offered for someone with cases, and says what to do instead', fakeAsync(() => {
      open();

      expect(trash(rows()[0]).disabled).toBeTrue();
      expect(trash(rows()[0]).title).toBe('Tiene casos asignados: desactívalo o reasigna sus casos');
      expect(trash(rows()[2]).disabled).toBeTrue();
      expect(trash(rows()[1]).disabled).toBeFalse();
      expect(trash(rows()[1]).getAttribute('aria-label')).toBe('Eliminar a José Pérez');
    }));

    // The trash is next to "Desactivar", and what it does cannot be undone.
    it('asks first, naming the responsible, and sends nothing until the person says yes', fakeAsync(() => {
      open();
      click(trash(rows()[1]));

      expect(asked()).toEqual(jasmine.objectContaining({ title: '¿Eliminar al responsable «José Pérez»?', confirmLabel: 'Eliminar', danger: true }));
      http.expectNone({ method: 'DELETE', url: '/api/assignees/2' });
      answer(false);
    }));

    it('confirmed, removes a responsible without cases from the list', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      write('DELETE', '/api/assignees/2').flush(null);
      settle();
      catalogs([ana, zoe]);

      expect(rows().map((row) => nameOf(row).value)).toEqual(['Ana', 'Zoe']);
      expect(toasts()).toEqual(['Responsable eliminado']);
      tick(3000);
    }));

    // No DELETE leaves: `http.verify` fails on a request nobody answered.
    it('cancelled, deletes nobody and says nothing', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(false);

      expect(asked()).toBeNull();
      expect(rows().map((row) => nameOf(row).value)).toEqual(['Ana', 'José Pérez', 'Zoe']);
      expect(toasts()).toEqual([]);
    }));

    // A case was assigned to them from another screen after this list was read.
    it('refused by the server, shows its reason and the list as it is now', fakeAsync(() => {
      open();
      click(trash(rows()[1]));
      answer(true);

      const reason = 'José Pérez tiene 1 caso asignado. Desactívalo para que no aparezca en los casos nuevos, o reasigna sus casos antes de eliminarlo.';
      write('DELETE', '/api/assignees/2').flush({ message: reason }, REFUSED);
      settle();
      catalogs([ana, { ...jose, tickets: 1 }, zoe]);

      expect(toasts()).toEqual([reason]);
      expect(trash(rows()[1]).disabled).toBeTrue();
      tick(6000);
    }));
  });
});
