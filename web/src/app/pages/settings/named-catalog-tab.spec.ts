import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { User } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { answerCatalogs } from '../../testing/catalogs';
import type { CatalogsAnswer } from '../../testing/catalogs';
import { httpTestBed } from '../../testing/http';
import { screenOf, toasts } from '../../testing/screen';
import { textOf } from '../../testing/text';
import { ASSIGNEES, COMPANIES, NamedCatalogTab } from './named-catalog-tab';
import type { NamedCatalog, NamedEntry } from './named-catalog-tab';

const REFUSED = { status: 409, statusText: 'Conflict' };

/**
 * One catalog of names as the tab shows it: what the server has and answers, what the person
 * types, and what the tab says, in its words. The same tests go through each one.
 */
interface Case {
  title: string;
  catalog: NamedCatalog;
  url: string;
  fieldId: string;
  /** The label of the field of a new name. Followed by the name, it names the field of each row. */
  nameLabel: string;
  maxLength: number;
  /** Three entries: the first with cases, the second without, the third inactive and with one. */
  entries: [NamedEntry, NamedEntry, NamedEntry];
  /** The read of the shared catalogs with these entries in their place. */
  answer: (entries: NamedEntry[]) => CatalogsAnswer;
  inactive: string;
  empty: string;
  help: string;
  /** A new name as typed, and as it is sent. */
  typed: string;
  sent: string;
  /** The name of the first entry written in other capitals, which the server refuses as taken. */
  taken: string;
  takenMessage: string;
  /** The second entry renamed, as typed and as sent. */
  renameTyped: string;
  renamed: string;
  toasts: { added: string; deactivated: string; activated: string; removed: string };
  inUse: string;
  /** The accessible name of the trash of the second entry, and the question it asks. */
  removeLabel: string;
  question: string;
  /** What the server says when it refuses to delete the second entry, which got a case meanwhile. */
  removeRefused: string;
}

// A user with the name of a responsible: the two lists have nothing to do with each other.
const userAna: User = { id: 1, username: 'ana', name: 'Ana', active: true, canLogin: true, role: 'AGENT' };

const CASES: Case[] = [
  {
    title: 'the client companies (Empresas)',
    catalog: COMPANIES,
    url: '/api/companies',
    fieldId: 'company-name',
    nameLabel: 'Nombre de la empresa',
    // The server stores up to 200 characters.
    maxLength: 200,
    entries: [
      { id: 1, name: 'Acme', active: true, tickets: 3 },
      { id: 2, name: 'Bodega Sur', active: true, tickets: 0 },
      { id: 3, name: 'Zeta', active: false, tickets: 1 },
    ],
    answer: (companies) => ({ companies }),
    inactive: 'Inactiva',
    empty: 'No hay empresas. Agrega arriba las que reportan casos.',
    help: 'Al cambiar el nombre de una empresa, sus casos pasan a mostrar el nuevo. Una empresa inactiva ya no aparece al registrar casos, pero conserva los que tiene. Solo se puede eliminar una empresa sin casos.',
    typed: '  Ferretería El Tornillo ',
    sent: 'Ferretería El Tornillo',
    taken: 'acme',
    takenMessage: 'Ya existe una empresa con ese nombre',
    // The cases of the company show the new name from then on: that is the server's doing.
    renameTyped: ' Bodega del Sur ',
    renamed: 'Bodega del Sur',
    toasts: { added: 'Empresa agregada', deactivated: 'Empresa desactivada', activated: 'Empresa activada', removed: 'Empresa eliminada' },
    // Its cases would be left without a company: the way out is to deactivate it.
    inUse: 'Tiene casos: desactívala o cambia la empresa de sus casos',
    removeLabel: 'Eliminar Bodega Sur',
    question: '¿Eliminar la empresa «Bodega Sur»?',
    removeRefused: 'Bodega Sur tiene 1 caso. Desactívala para que no aparezca en los casos nuevos, o cambia la empresa de sus casos antes de eliminarla.',
  },
  {
    title: 'the responsibles (Responsables)',
    catalog: ASSIGNEES,
    url: '/api/assignees',
    fieldId: 'assignee-name',
    nameLabel: 'Nombre del responsable',
    maxLength: 80,
    entries: [
      { id: 1, name: 'Ana', active: true, tickets: 3 },
      { id: 2, name: 'José Pérez', active: true, tickets: 0 },
      { id: 3, name: 'Zoe', active: false, tickets: 1 },
    ],
    answer: (assignees) => ({ users: [userAna], assignees }),
    inactive: 'Inactivo',
    empty: 'No hay responsables. Agrega arriba a quienes atienden los casos.',
    // Nothing about users, nor about "Cliente": that used to be an option of every case, and now
    // a team that wants it adds it here.
    help: 'Un responsable inactivo ya no aparece al registrar o reasignar casos, pero conserva los que tiene. Solo se puede eliminar a quien no tiene casos.',
    typed: '  Luis Ñáñez ',
    sent: 'Luis Ñáñez',
    taken: 'ana',
    takenMessage: 'Ya existe un responsable con ese nombre',
    renameTyped: ' José P. ',
    renamed: 'José P.',
    toasts: { added: 'Responsable agregado', deactivated: 'Responsable desactivado', activated: 'Responsable activado', removed: 'Responsable eliminado' },
    // Their cases would be left without a responsible: the way out is to deactivate them.
    inUse: 'Tiene casos asignados: desactívalo o reasigna sus casos',
    removeLabel: 'Eliminar a José Pérez',
    question: '¿Eliminar al responsable «José Pérez»?',
    removeRefused: 'José Pérez tiene 1 caso asignado. Desactívalo para que no aparezca en los casos nuevos, o reasigna sus casos antes de eliminarlo.',
  },
];

// The tab with the real Api and the real shared catalogs: the tests act on its controls and look
// at the requests that leave and at what the list shows.
for (const c of CASES) {
  describe(`NamedCatalogTab, ${c.title} in Configuración`, () => {
    let http: HttpTestingController;
    let fixture: ComponentFixture<NamedCatalogTab>;
    let el: HTMLElement;
    const [first, second, third] = c.entries;

    beforeEach(() => {
      http = httpTestBed(provideRouter([]));
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
    function catalogs(entries: NamedEntry[]): void {
      answerCatalogs(http, c.answer(entries));
      settle();
    }

    function open(entries: NamedEntry[] = c.entries): void {
      fixture = TestBed.createComponent(NamedCatalogTab);
      fixture.componentRef.setInput('catalog', c.catalog);
      el = fixture.nativeElement as HTMLElement;
      render();
      catalogs(entries);
    }

    const { click, type, button } = screenOf(() => el, render);
    const rows = (): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.card.divide-y > div')];
    const nameOf = (row: HTMLElement): HTMLInputElement => row.querySelector('input')!;
    const trash = (row: HTMLElement): HTMLButtonElement => row.querySelector<HTMLButtonElement>('button[aria-label^="Eliminar"]')!;
    const newName = (): HTMLInputElement => el.querySelector<HTMLInputElement>(`#${c.fieldId}`)!;
    const add = (): HTMLButtonElement => el.querySelector<HTMLButtonElement>('form button[type="submit"]')!;
    const write = (method: string, url: string): TestRequest => http.expectOne({ method, url });

    /** The question on screen, which the shell draws as a dialog. */
    const asked = (): unknown => TestBed.inject(Confirm).current();

    /** The person answers it. */
    function answer(confirmed: boolean): void {
      TestBed.inject(Confirm).answer(confirmed);
      render();
    }

    it('lists each entry with the cases it has, and says which are inactive', fakeAsync(() => {
      open();

      expect(rows().map((row) => nameOf(row).value)).toEqual(c.entries.map((entry) => entry.name));
      // What each row says after the name: cases, state and what can be done.
      const said = (row: HTMLElement): string[] => [...row.querySelectorAll('span, button')].map((item) => textOf(item)).filter(Boolean);
      expect(rows().map(said)).toEqual([
        ['3 casos', 'Desactivar'],
        ['0 casos', 'Desactivar'],
        ['1 caso', c.inactive, 'Activar'],
      ]);
      expect(el.querySelector(`label[for=${c.fieldId}]`)!.textContent!.trim()).toBe(c.nameLabel);
      expect(nameOf(rows()[0]).getAttribute('aria-label')).toBe(`${c.nameLabel} ${first.name}`);
    }));

    it('explains what renaming, deactivating and deleting do', fakeAsync(() => {
      open();

      const help = el.querySelector('p.text-xs')!.textContent!.replace(/\s+/g, ' ').trim();
      expect(help).toBe(c.help);
    }));

    it('invites to add the first one when there is none', fakeAsync(() => {
      open([]);

      expect(el.textContent).toContain(c.empty);
    }));

    describe('Agregar', () => {
      it('needs a name', fakeAsync(() => {
        open();

        expect(add().disabled).toBeTrue();
        type(newName(), '   ');
        expect(add().disabled).toBeTrue();
        type(newName(), c.sent);
        expect(add().disabled).toBeFalse();
      }));

      it('takes names as long as the server stores', fakeAsync(() => {
        open();

        expect(newName().maxLength).toBe(c.maxLength);
        expect(nameOf(rows()[0]).maxLength).toBe(c.maxLength);
      }));

      it('sends the name alone, shows the new entry and leaves the field ready for the next one', fakeAsync(() => {
        open();
        type(newName(), c.typed);
        click(add());

        const save = write('POST', c.url);
        expect(save.request.body).toEqual({ name: c.sent });
        const added: NamedEntry = { id: 9, name: c.sent, active: true, tickets: 0 };
        save.flush(added);
        settle();
        catalogs([first, second, added, third]);

        expect(rows().map((row) => nameOf(row).value)).toEqual([first.name, second.name, c.sent, third.name]);
        expect(newName().value).toBe('');
        expect(toasts()).toEqual([c.toasts.added]);
        tick(3000);
      }));

      it('keeps the name typed when the server refuses it, and says why', fakeAsync(() => {
        open();
        type(newName(), c.taken);
        click(add());

        write('POST', c.url).flush({ message: c.takenMessage }, REFUSED);
        settle();
        catalogs(c.entries);

        expect(newName().value).toBe(c.taken);
        expect(toasts()).toEqual([c.takenMessage]);
        tick(6000);
      }));

      it('does not send the same name twice while the first one is on its way', fakeAsync(() => {
        open();
        type(newName(), c.sent);
        click(add());

        expect(add().disabled).toBeTrue();
        newName().form!.dispatchEvent(new Event('submit'));
        render();

        // Exactly one POST: `expectOne` fails on two.
        write('POST', c.url).flush({ id: 9, name: c.sent, active: true, tickets: 0 });
        settle();
        catalogs(c.entries);
        tick(3000);
      }));
    });

    describe('a name edited in the list', () => {
      it('is saved when the field is left', fakeAsync(() => {
        open();
        type(nameOf(rows()[1]), c.renameTyped, 'change');

        const save = write('PATCH', `${c.url}/2`);
        expect(save.request.body).toEqual({ name: c.renamed });
        save.flush({ ...second, name: c.renamed });
        settle();
        catalogs([first, { ...second, name: c.renamed }, third]);

        expect(nameOf(rows()[1]).value).toBe(c.renamed);
        expect(toasts()).toEqual(['Nombre actualizado']);
        tick(3000);
      }));

      it('goes back to the name the entry has when the server refuses it', fakeAsync(() => {
        open();
        type(nameOf(rows()[1]), first.name, 'change');

        write('PATCH', `${c.url}/2`).flush({ message: c.takenMessage }, REFUSED);
        settle();
        catalogs(c.entries);

        expect(nameOf(rows()[1]).value).toBe(second.name);
        expect(toasts()).toEqual([c.takenMessage]);
        tick(6000);
      }));

      it('left empty or unchanged sends nothing, and the name stays', fakeAsync(() => {
        open();

        type(nameOf(rows()[1]), '   ', 'change');
        settle();
        expect(nameOf(rows()[1]).value).toBe(second.name);

        type(nameOf(rows()[1]), ` ${second.name} `, 'change');
        settle();
        expect(nameOf(rows()[1]).value).toBe(second.name);
      }));
    });

    describe('Desactivar and Activar', () => {
      it('take an entry out of the lists for new cases and put it back', fakeAsync(() => {
        open();

        click(button('Desactivar', rows()[0]));
        const off = write('PATCH', `${c.url}/1`);
        expect(off.request.body).toEqual({ active: false });
        off.flush({ ...first, active: false });
        settle();
        catalogs([second, { ...first, active: false }, third]);
        expect(toasts()).toEqual([c.toasts.deactivated]);

        click(button('Activar', rows()[2]));
        const on = write('PATCH', `${c.url}/3`);
        expect(on.request.body).toEqual({ active: true });
        on.flush({ ...third, active: true });
        settle();
        catalogs([second, third, { ...first, active: false }]);
        expect(toasts()).toEqual([c.toasts.deactivated, c.toasts.activated]);
        tick(3000);
      }));
    });

    describe('Eliminar', () => {
      it('is not offered for an entry with cases, and says what to do instead', fakeAsync(() => {
        open();

        expect(trash(rows()[0]).disabled).toBeTrue();
        expect(trash(rows()[0]).title).toBe(c.inUse);
        expect(trash(rows()[2]).disabled).toBeTrue();
        expect(trash(rows()[1]).disabled).toBeFalse();
        expect(trash(rows()[1]).getAttribute('aria-label')).toBe(c.removeLabel);
      }));

      // The trash is next to "Desactivar", and what it does cannot be undone.
      it('asks first, naming the entry, and sends nothing until the person says yes', fakeAsync(() => {
        open();
        click(trash(rows()[1]));

        expect(asked()).toEqual(jasmine.objectContaining({ title: c.question, confirmLabel: 'Eliminar', danger: true }));
        http.expectNone({ method: 'DELETE', url: `${c.url}/2` });
        answer(false);
      }));

      it('confirmed, removes an entry without cases from the list', fakeAsync(() => {
        open();
        click(trash(rows()[1]));
        answer(true);

        write('DELETE', `${c.url}/2`).flush(null);
        settle();
        catalogs([first, third]);

        expect(rows().map((row) => nameOf(row).value)).toEqual([first.name, third.name]);
        expect(toasts()).toEqual([c.toasts.removed]);
        tick(3000);
      }));

      // No DELETE leaves: `http.verify` fails on a request nobody answered.
      it('cancelled, deletes nothing and says nothing', fakeAsync(() => {
        open();
        click(trash(rows()[1]));
        answer(false);

        expect(asked()).toBeNull();
        expect(rows().map((row) => nameOf(row).value)).toEqual(c.entries.map((entry) => entry.name));
        expect(toasts()).toEqual([]);
      }));

      // It got a case from another screen after this list was read.
      it('refused by the server, shows its reason and the list as it is now', fakeAsync(() => {
        open();
        click(trash(rows()[1]));
        answer(true);

        write('DELETE', `${c.url}/2`).flush({ message: c.removeRefused }, REFUSED);
        settle();
        catalogs([first, { ...second, tickets: 1 }, third]);

        expect(toasts()).toEqual([c.removeRefused]);
        expect(trash(rows()[1]).disabled).toBeTrue();
        tick(6000);
      }));
    });
  });
}
