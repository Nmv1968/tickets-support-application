import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { answerCatalogs } from '../testing/catalogs';
import type { CatalogsAnswer } from '../testing/catalogs';
import { toasts } from '../testing/screen';
import type { Assignee, Company, SupportType, SystemModule } from './api';
import { Catalogs, companyCreator, findByName, offered } from './catalogs';
import { errorMessage } from './ui';

// Every screen offers the same users, responsibles, companies, support types and modules. They
// are read together, once, and again whenever one of them changes.
describe('Catalogs', () => {
  let http: HttpTestingController;
  let catalogs: Catalogs;

  const person = (id: number, name: string, active = true): Assignee => ({ id, name, active, tickets: 0 });
  const company = (id: number, name: string, active = true): Company => ({ id, name, active, tickets: 0 });
  const type = (id: number, name: string, active = true): SupportType => ({ id, name, color: '#64748b', active, tickets: 0 });
  const module = (id: number, name: string, active = true): SystemModule => ({ id, name, parentId: null, active, fullName: name });

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    catalogs = TestBed.inject(Catalogs);
  });

  // Also catches a read nobody expected: any request left unanswered fails the test.
  afterEach(() => http.verify());

  function load(answer: CatalogsAnswer): void {
    void catalogs.reload();
    answerCatalogs(http, answer);
    tick();
  }

  it('has nothing to offer until the catalogs arrive', () => {
    expect(catalogs.companies()).toEqual([]);
    expect(catalogs.activeCompanies()).toEqual([]);
    expect(catalogs.supportTypes()).toEqual([]);
    expect(catalogs.activeSupportTypes()).toEqual([]);
    expect(catalogs.modules()).toEqual([]);
    expect(catalogs.activeModules()).toEqual([]);
    expect(catalogs.aiReady()).toBeFalse();
  });

  it('reads the companies and the support types with the rest', fakeAsync(() => {
    load({
      users: [{ id: 1, username: 'ana', name: 'Ana Torres', active: true, canLogin: true, role: 'AGENT' }],
      assignees: [person(4, 'Ana')],
      companies: [company(1, 'Acme')],
      supportTypes: [type(2, 'Falla del sistema')],
      modules: [module(3, 'Ventas')],
    });

    expect(catalogs.users().map((item) => item.username)).toEqual(['ana']);
    expect(catalogs.assignees().map((item) => item.name)).toEqual(['Ana']);
    expect(catalogs.companies().map((item) => item.name)).toEqual(['Acme']);
    expect(catalogs.supportTypes().map((item) => item.name)).toEqual(['Falla del sistema']);
    expect(catalogs.modules().map((item) => item.fullName)).toEqual(['Ventas']);
  }));

  // A deactivated entry keeps its cases, so the filters and those cases still need it.
  it('offers the active ones for a new case, and keeps every one for the filters', fakeAsync(() => {
    load({
      assignees: [person(4, 'Ana'), person(5, 'Luis', false)],
      companies: [company(1, 'Acme'), company(2, 'Bodega Sur', false)],
      supportTypes: [type(1, 'Capacitación'), type(2, 'Falla del sistema', false)],
      modules: [module(1, 'Ventas'), module(2, 'Bodega vieja', false)],
    });

    expect(catalogs.activeAssignees().map((item) => item.name)).toEqual(['Ana']);
    expect(catalogs.assignees().map((item) => item.name)).toEqual(['Ana', 'Luis']);
    expect(catalogs.activeCompanies().map((item) => item.name)).toEqual(['Acme']);
    expect(catalogs.companies().map((item) => item.name)).toEqual(['Acme', 'Bodega Sur']);
    expect(catalogs.activeSupportTypes().map((item) => item.name)).toEqual(['Capacitación']);
    expect(catalogs.supportTypes().map((item) => item.name)).toEqual(['Capacitación', 'Falla del sistema']);
    expect(catalogs.activeModules().map((item) => item.fullName)).toEqual(['Ventas']);
    expect(catalogs.modules().map((item) => item.fullName)).toEqual(['Ventas', 'Bodega vieja']);
  }));

  // The list and the board filter the cases of a responsible, inactive or not, or the ones nobody has.
  it('offers a filter by responsible everyone of the catalog, after the cases nobody has', fakeAsync(() => {
    load({ assignees: [person(4, 'Ana'), person(5, 'Luis', false)] });

    expect(catalogs.assigneeFilterOptions().map((item) => [item.id, item.name])).toEqual([
      ['none', 'Sin asignar'],
      [4, 'Ana'],
      [5, 'Luis'],
    ]);
  }));

  // Left alone, the server lists only the active modules: the deactivated ones have to be asked for.
  it('asks for every module, the deactivated ones too', fakeAsync(() => {
    void catalogs.reload();

    const read = http.expectOne((request) => request.url === '/api/modules');
    expect(read.request.params.get('all')).toBe('1');
    read.flush([]);
    for (const url of ['users', 'assignees', 'companies', 'support-types']) http.expectOne(`/api/${url}`).flush([]);
    http.expectOne('/api/ai/status').flush({ ready: false });
    tick();
  }));

  it('is read once by the screens that only need it to be there, and again by the ones that change it', fakeAsync(() => {
    void catalogs.ensure();
    answerCatalogs(http, { companies: [company(1, 'Acme')] });
    tick();

    // Already there: nothing is asked for.
    void catalogs.ensure();
    tick();
    http.expectNone('/api/companies');

    load({ companies: [company(1, 'Acme'), company(2, 'Bodega Sur')] });
    expect(catalogs.companies().length).toBe(2);
  }));

  // "Crear empresa «X»" in a select: the company has to be among its options the moment it is chosen.
  describe('a company created from a select', () => {
    it('joins the list at once, in its place, without the catalogs being read again', fakeAsync(() => {
      load({ companies: [company(1, 'Acme'), company(3, 'Ferretería El Tornillo'), company(2, 'Bodega vieja', false)] });

      let created: Company | undefined;
      void catalogs.createCompany('Bodega Sur').then((result) => (created = result));
      const save = http.expectOne({ method: 'POST', url: '/api/companies' });
      expect(save.request.body).toEqual({ name: 'Bodega Sur' });
      save.flush(company(9, 'Bodega Sur'));
      tick();

      expect(created).toEqual(company(9, 'Bodega Sur'));
      // The active ones first, each group by name, as the server lists them.
      expect(catalogs.companies().map((item) => item.name)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo', 'Bodega vieja']);
      expect(catalogs.activeCompanies().map((item) => item.name)).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);
    }));

    it('that the server refuses leaves the list as it was, and the refusal to whoever asked', fakeAsync(() => {
      load({ companies: [company(1, 'Acme')] });

      let refusal: unknown;
      catalogs.createCompany('acme').catch((error: unknown) => (refusal = error));
      http.expectOne({ method: 'POST', url: '/api/companies' }).flush({ message: 'Ya existe una empresa con ese nombre' }, { status: 409, statusText: 'Conflict' });
      tick();

      expect(errorMessage(refusal)).toBe('Ya existe una empresa con ese nombre');
      expect(catalogs.companies().map((item) => item.name)).toEqual(['Acme']);
    }));

    // What every select of companies is given for its "Crear empresa «X»".
    describe('with "Crear empresa «X»"', () => {

      it('is created with the name typed, without the spaces around it, and the person is told', fakeAsync(() => {
        const create = TestBed.runInInjectionContext(companyCreator);

        let created: Company | undefined;
        void create('  Bodega Sur ').then((result) => (created = result));
        const save = http.expectOne({ method: 'POST', url: '/api/companies' });
        expect(save.request.body).toEqual({ name: 'Bodega Sur' });
        save.flush(company(9, 'Bodega Sur'));
        tick();

        // Given back to the select, which chooses it, and already among what it offers.
        expect(created).toEqual(company(9, 'Bodega Sur'));
        expect(catalogs.activeCompanies().map((item) => item.name)).toEqual(['Bodega Sur']);
        expect(toasts()).toEqual(['Empresa «Bodega Sur» creada']);
      }));

      // The select says nothing when its promise fails: the reason has to be said here.
      it('that the server refuses says why, and the select gets the refusal, so it chooses nothing', fakeAsync(() => {
        const create = TestBed.runInInjectionContext(companyCreator);

        let refusal: unknown;
        create('acme').catch((error: unknown) => (refusal = error));
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush({ message: 'Ya existe una empresa con ese nombre' }, { status: 409, statusText: 'Conflict' });
        tick();

        expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
        expect(errorMessage(refusal)).toBe('Ya existe una empresa con ese nombre');
      }));

      // A double click on the option, or Enter twice: the select asks again while the first is on its way.
      it('asked for again before the server answers, is sent once, said once and given to both', fakeAsync(() => {
        const create = TestBed.runInInjectionContext(companyCreator);

        const created: Company[] = [];
        void create('Bodega Sur').then((result) => created.push(result));
        // The same name for the server, however it is written.
        void create(' bodega  sur').then((result) => created.push(result));
        // Exactly one POST: `expectOne` fails on two.
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush(company(9, 'Bodega Sur'));
        tick();

        expect(created).toEqual([company(9, 'Bodega Sur'), company(9, 'Bodega Sur')]);
        expect(toasts()).toEqual(['Empresa «Bodega Sur» creada']);
      }));

      it('asked for again before the server refuses it, says why once and refuses both', fakeAsync(() => {
        const create = TestBed.runInInjectionContext(companyCreator);

        const refusals: string[] = [];
        create('acme').catch((error: unknown) => refusals.push(errorMessage(error)));
        create('acme').catch((error: unknown) => refusals.push(errorMessage(error)));
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush({ message: 'Ya existe una empresa con ese nombre' }, { status: 409, statusText: 'Conflict' });
        tick();

        expect(refusals).toEqual(['Ya existe una empresa con ese nombre', 'Ya existe una empresa con ese nombre']);
        expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
      }));

      it('can be asked for again once the server has answered, and for another name meanwhile', fakeAsync(() => {
        const create = TestBed.runInInjectionContext(companyCreator);

        create('Bodega Sur').catch(() => undefined);
        void create('Zeta');
        const [first, other] = http.match({ method: 'POST', url: '/api/companies' });
        expect([first.request.body, other.request.body]).toEqual([{ name: 'Bodega Sur' }, { name: 'Zeta' }]);
        first.flush({ message: 'No hay conexión con el servidor' }, { status: 503, statusText: 'Service Unavailable' });
        other.flush(company(8, 'Zeta'));
        tick();

        void create('Bodega Sur');
        http.expectOne({ method: 'POST', url: '/api/companies' }).flush(company(9, 'Bodega Sur'));
        tick();
        expect(catalogs.activeCompanies().map((item) => item.name)).toEqual(['Bodega Sur', 'Zeta']);
      }));
    });
  });

  // The configuration of the AI, with its key and its address, is only for an administrator to read.
  it('asks the server only whether the AI is ready, never for its configuration', fakeAsync(() => {
    load({ aiReady: false });
    expect(catalogs.aiReady()).toBeFalse();

    load({ aiReady: true });
    expect(catalogs.aiReady()).toBeTrue();
    http.expectNone('/api/ai/config');
  }));
});

// A name written by a person, or read by the AI, says which entry of a catalog is meant.
describe('findByName', () => {
  const companies = [
    { id: 1, name: 'Acme' },
    { id: 2, name: 'Corporación  Ñandú' },
  ];

  it('finds the entry whatever the capitals, the accents and the spaces of the name', () => {
    expect(findByName(companies, 'acme')?.id).toBe(1);
    expect(findByName(companies, '  ACME ')?.id).toBe(1);
    expect(findByName(companies, 'corporacion nandu')?.id).toBe(2);
  });

  // "Acme" is not "Acme del Sur": part of a name is another name.
  it('finds nothing for a name that is only part of one, or for no name at all', () => {
    expect(findByName(companies, 'Acm')).toBeUndefined();
    expect(findByName(companies, 'Acme del Sur')).toBeUndefined();
    expect(findByName(companies, '   ')).toBeUndefined();
  });
});

// The form of a case offers what a new case takes, and keeps what the case has.
describe('offered', () => {
  const catalog = [
    { id: 1, name: 'Acme', active: true },
    { id: 2, name: 'Bodega Sur', active: false },
    { id: 3, name: 'Zeta', active: true },
  ];

  it('is the active entries of the catalog, in its order', () => {
    expect(offered<{ id: number; name: string }>(catalog, []).map((entry) => entry.name)).toEqual(['Acme', 'Zeta']);
  });

  it('keeps in its place an inactive entry the case has', () => {
    expect(offered(catalog, [{ id: 2, name: 'Bodega Sur' }]).map((entry) => entry.name)).toEqual(['Acme', 'Bodega Sur', 'Zeta']);
  });

  // An entry created a moment ago elsewhere, before the catalog is read again.
  it('adds at the end, as the case names it, an entry the catalog does not have yet', () => {
    expect(offered(catalog, [{ id: 9, name: 'Ferretería' }]).map((entry) => entry.name)).toEqual(['Acme', 'Zeta', 'Ferretería']);
  });
});
