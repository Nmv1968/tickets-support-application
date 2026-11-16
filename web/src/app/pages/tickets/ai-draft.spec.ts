import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { TestRequest } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { Company, TicketDraft } from '../../core/api';
import { Catalogs } from '../../core/catalogs';
import { clearSelect, closeSelect, openSelect, typeInSelect } from '../../testing/ng-select';
import { paste, screenOf, toasts } from '../../testing/screen';
import { AiDraftDialog } from './ai-draft';

const picture = new File(['png'], 'captura.png', { type: 'image/png' });

describe('AiDraftDialog, a paste', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AiDraftDialog>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  function open(): void {
    fixture = TestBed.createComponent(AiDraftDialog);
    el = fixture.nativeElement as HTMLElement;
    render();
    tick();
    render();
  }

  const images = (): number => el.querySelectorAll('img').length;
  const textBox = (): HTMLTextAreaElement => el.querySelector<HTMLTextAreaElement>('#ai-text')!;

  it('of a screenshot adds it to the evidence, also while the text box has the focus', fakeAsync(() => {
    open();
    expect(paste(document.body, [picture]).defaultPrevented).toBeTrue();
    expect(paste(textBox(), [picture]).defaultPrevented).toBeTrue();
    render();
    expect(images()).toBe(2);
  }));

  // A screenshot pasted on the list opens the dialog with it.
  it('opens with the images it is given, up to four', fakeAsync(() => {
    fixture = TestBed.createComponent(AiDraftDialog);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('initialImages', [picture, picture]);
    render();
    expect(images()).toBe(2);

    fixture = TestBed.createComponent(AiDraftDialog);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('initialImages', Array<File>(5).fill(picture));
    render();
    expect(images()).toBe(4);
    expect(toasts()).toEqual(['Máximo 4 imágenes por caso']);
    tick(6000);
  }));

  // The box asks for the client's message to be pasted in it. Copied from Excel or from a chat,
  // it can come with a picture of itself next to the text.
  it('of text into the text box is left to the browser, even when the clipboard also has a picture of it', fakeAsync(() => {
    open();
    expect(paste(textBox(), [picture], 'No puedo facturar desde ayer').defaultPrevented).toBeFalse();
    render();
    expect(images()).toBe(0);
  }));
});

// The second step: the case as it will be saved, for a person to review. What comes from a
// catalog is chosen from it; the AI gives the company as the text it read.
describe('AiDraftDialog, the case under review', () => {
  let http: HttpTestingController;
  let catalogs: Catalogs;
  let fixture: ComponentFixture<AiDraftDialog>;
  let el: HTMLElement;
  /** Times the dialog asked to be closed. */
  let closed: number;

  const TORNILLO: Company = { id: 3, name: 'Ferretería El Tornillo', active: true, tickets: 2 };
  const REFUSED = { status: 409, statusText: 'Conflict' };

  /** What the AI read in the evidence. */
  function draft(overrides: Partial<TicketDraft> = {}): TicketDraft {
    return {
      date: null,
      time: null,
      company: null,
      description: 'No imprime la factura',
      moduleId: null,
      priority: null,
      estimatedMinutes: null,
      note: null,
      provider: 'compatible',
      model: 'un-modelo',
      ...overrides,
    };
  }

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] });
    http = TestBed.inject(HttpTestingController);
    // One entry of each catalog is deactivated: it keeps its cases and takes no new ones.
    catalogs = TestBed.inject(Catalogs);
    catalogs.companies.set([TORNILLO, { id: 4, name: 'Bodega Sur', active: false, tickets: 1 }]);
    catalogs.assignees.set([
      { id: 5, name: 'Luis', active: true, tickets: 0 },
      { id: 6, name: 'Zoe', active: false, tickets: 2 },
    ]);
    catalogs.supportTypes.set([
      { id: 1, name: 'Capacitación', color: '#12b76a', active: true, tickets: 0 },
      { id: 2, name: 'Falla del sistema', color: '#b91c1c', active: true, tickets: 4 },
      { id: 3, name: 'Garantía', color: '#64748b', active: false, tickets: 1 },
    ]);
    catalogs.modules.set([
      { id: 1, name: 'Ventas', parentId: null, active: true, fullName: 'Ventas' },
      { id: 2, name: 'Facturas', parentId: 1, active: true, fullName: 'Ventas / Facturas' },
      { id: 3, name: 'Bodega vieja', parentId: null, active: false, fullName: 'Bodega vieja' },
    ]);
  });

  afterEach(() => http.verify());

  /**
   * A screen update as the browser runs it. ngModel does not write a changed value into its
   * control while Angular goes through the page but right after, before any other event.
   */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  /** Lets what was answered reach the screen. */
  function settle(): void {
    tick();
    render();
  }

  const screen = screenOf(() => el, render);
  const { button, click, select, chosen, offers, pick } = screen;
  /** What the person types in the field with this id. */
  const type = (id: string, text: string): void => screen.type(screen.find(`#${id}`), text);

  function open(): void {
    fixture = TestBed.createComponent(AiDraftDialog);
    el = fixture.nativeElement as HTMLElement;
    closed = 0;
    fixture.componentInstance.closed.subscribe(() => closed++);
    render();
  }

  /** The review step, reached without the AI: every field is the person's to fill in. */
  function byHand(): void {
    open();
    click(button('Llenar a mano'));
  }

  /** The review step, reached with what the AI read in a message of the client. */
  function analyzed(read: Partial<TicketDraft>): void {
    open();
    type('ai-text', 'No puedo imprimir la factura');
    click(button('Analizar con IA'));
    http.expectOne({ method: 'POST', url: '/api/ai/analyze' }).flush(draft(read));
    settle();
  }

  /** What is said under the company select about the company the AI read. Null when nothing is. */
  const hint = (): HTMLElement | null => el.querySelector<HTMLElement>('#ai-company-read');
  const caseSave = (): TestRequest => http.expectOne({ method: 'POST', url: '/api/tickets' });
  const companySave = (): TestRequest => http.expectOne({ method: 'POST', url: '/api/companies' });
  /** The body of a request as it travels: what was left undefined is not in it. */
  const sent = (request: TestRequest): Record<string, unknown> => JSON.parse(JSON.stringify(request.request.body)) as Record<string, unknown>;

  it('has no native list: what comes from a catalog is chosen in a select with its name, which offers what a new case takes', fakeAsync(() => {
    byHand();

    expect(el.querySelector('select, datalist')).toBeNull();
    for (const [id, label] of [
      ['ai-status', 'Estado'],
      ['ai-company', 'Empresa *'],
      ['ai-assignee', 'Responsable'],
      ['ai-priority', 'Prioridad'],
      ['ai-module', 'Módulo'],
      ['ai-types', 'Tipos de soporte'],
    ]) {
      expect(select(id)).withContext(id).toBeTruthy();
      expect(el.querySelector(`label[for=${id}]`)?.textContent?.trim()).toBe(label);
    }

    // The deactivated company, responsible, module and support type are not offered.
    expect(offers('ai-status')).toEqual(['Sin resolver', 'Pendiente', 'Resuelto']);
    expect(offers('ai-company')).toEqual(['Ferretería El Tornillo']);
    expect(offers('ai-assignee')).toEqual(['Luis']);
    expect(offers('ai-priority')).toEqual(['Baja', 'Media', 'Alta', 'Crítica']);
    expect(offers('ai-module')).toEqual(['Ventas', 'Ventas / Facturas']);
    expect(offers('ai-types')).toEqual(['Capacitación', 'Falla del sistema']);
  }));

  it('starts pending, with no company, and with nobody as responsible: registering a case makes nobody its responsible', fakeAsync(() => {
    byHand();

    expect(chosen('ai-status')).toEqual(['Pendiente']);
    expect(chosen('ai-company')).toEqual([]);
    expect(chosen('ai-assignee')).toEqual([]);
    expect(select('ai-assignee').textContent).toContain('Sin asignar');
    expect(chosen('ai-priority')).toEqual([]);
    expect(chosen('ai-module')).toEqual([]);
    expect(chosen('ai-types')).toEqual([]);
    expect(hint()).toBeNull();
  }));

  it('cannot be saved without a company and a description', fakeAsync(() => {
    byHand();
    expect(button('Guardar caso').disabled).toBeTrue();

    type('ai-description', 'No imprime');
    expect(button('Guardar caso').disabled).toBeTrue();

    pick('ai-company', 'Ferretería El Tornillo');
    expect(button('Guardar caso').disabled).toBeFalse();

    type('ai-description', '   ');
    expect(button('Guardar caso').disabled).toBeTrue();
  }));

  it('filled in by hand, is saved for the company chosen, with no responsible, priority, module or support type', fakeAsync(() => {
    byHand();
    pick('ai-company', 'Ferretería El Tornillo');
    type('ai-description', ' No imprime ');
    click(button('Guardar caso'));

    const save = caseSave();
    expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 3, description: 'No imprime', status: 'PENDING', assigneeId: null, priority: null, moduleId: null, aiGenerated: false }));
    // The company goes as the one of the catalog, not as a name, and no set of types is sent for a case without them.
    expect(Object.keys(sent(save))).not.toContain('company');
    expect(Object.keys(sent(save))).not.toContain('supportTypeIds');
    save.flush({ id: 8, code: 'SOP-00008' });
    settle();

    expect(toasts()).toEqual(['Caso SOP-00008 registrado']);
  }));

  it('is saved with what the person chose in each select', fakeAsync(() => {
    byHand();
    pick('ai-company', 'Ferretería El Tornillo');
    type('ai-description', 'No imprime');
    pick('ai-status', 'Resuelto');
    pick('ai-assignee', 'Luis');
    pick('ai-priority', 'Alta');
    pick('ai-module', 'Ventas / Facturas');
    pick('ai-types', 'Falla del sistema');
    pick('ai-types', 'Capacitación');
    closeSelect(select('ai-types'));
    render();

    // Each support type is a chip in the colour the team gave it.
    expect(chosen('ai-types')).toEqual(['Falla del sistema', 'Capacitación']);
    expect(Array.from(select('ai-types').querySelectorAll<HTMLElement>('app-type-chip'), (chip) => chip.style.backgroundColor)).toEqual(['rgb(185, 28, 28)', 'rgb(18, 183, 106)']);

    click(button('Guardar caso'));
    const save = caseSave();
    expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 3, status: 'RESOLVED', assigneeId: 5, priority: 'HIGH', moduleId: 2, supportTypeIds: [2, 1] }));
    save.flush({ id: 8, code: 'SOP-00008' });
    settle();
  }));

  it('shows the priority and the module the AI proposed in their selects, to keep, change or take off', fakeAsync(() => {
    analyzed({ company: 'Ferretería El Tornillo', priority: 'HIGH', moduleId: 2 });
    expect(chosen('ai-priority')).toEqual(['Alta']);
    expect(chosen('ai-module')).toEqual(['Ventas / Facturas']);

    clearSelect(select('ai-priority'));
    render();
    click(button('Guardar caso'));
    const save = caseSave();
    expect(sent(save)).toEqual(jasmine.objectContaining({ priority: null, moduleId: 2, description: 'No imprime la factura', aiGenerated: true }));
    save.flush({ id: 8, code: 'SOP-00008' });
    settle();
  }));

  describe('the company', () => {
    it('that is not in the catalog is created right there with "Crear empresa «X»", and chosen for the case', fakeAsync(() => {
      byHand();
      typeInSelect(select('ai-company'), 'Acme');
      render();
      pick('ai-company', 'Crear empresa «Acme»');

      const add = companySave();
      expect(add.request.body).toEqual({ name: 'Acme' });
      add.flush({ id: 9, name: 'Acme', active: true, tickets: 0 });
      settle();
      expect(toasts()).toEqual(['Empresa «Acme» creada']);
      expect(chosen('ai-company')).toEqual(['Acme']);
      // The case itself is not saved yet.
      http.expectNone({ method: 'POST', url: '/api/tickets' });

      type('ai-description', 'No imprime');
      click(button('Guardar caso'));
      const save = caseSave();
      expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 9 }));
      save.flush({ id: 8, code: 'SOP-00008' });
      settle();
    }));

    // The AI reads a name in a capture: its capitals, accents and spaces are whatever the capture had.
    it('the AI read is chosen when the catalog has it, however its name was written', fakeAsync(() => {
      analyzed({ company: '  FERRETERIA  el tornillo ' });

      expect(chosen('ai-company')).toEqual(['Ferretería El Tornillo']);
      expect(hint()).toBeNull();
      click(button('Guardar caso'));
      const save = caseSave();
      expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 3 }));
      save.flush({ id: 8, code: 'SOP-00008' });
      settle();
    }));

    it('the AI read that is not in the catalog is not chosen: the dialog says which one it read and offers to create it', fakeAsync(() => {
      analyzed({ company: 'Acme del Sur' });

      expect(chosen('ai-company')).toEqual([]);
      expect(hint()?.textContent).toContain('La IA leyó «Acme del Sur», que no está registrada.');
      // Nothing was created by reading it, and the case waits for its company.
      http.expectNone({ method: 'POST', url: '/api/companies' });
      expect(button('Guardar caso').disabled).toBeTrue();

      click(button('Crear empresa «Acme del Sur»'));
      const add = companySave();
      expect(add.request.body).toEqual({ name: 'Acme del Sur' });
      add.flush({ id: 9, name: 'Acme del Sur', active: true, tickets: 0 });
      settle();

      expect(toasts()).toEqual(['Empresa «Acme del Sur» creada']);
      expect(chosen('ai-company')).toEqual(['Acme del Sur']);
      expect(hint()).toBeNull();
      click(button('Guardar caso'));
      const save = caseSave();
      expect(sent(save)).toEqual(jasmine.objectContaining({ companyId: 9 }));
      save.flush({ id: 8, code: 'SOP-00008' });
      settle();
    }));

    it('the AI read and the server refuses to create: says why, chooses nothing and can be tried again', fakeAsync(() => {
      analyzed({ company: 'Acme del Sur' });
      click(button('Crear empresa «Acme del Sur»'));
      // While it is being created, a second press asks for nothing.
      expect(button('Crear empresa «Acme del Sur»').disabled).toBeTrue();
      companySave().flush({ message: 'Ya existe una empresa con ese nombre' }, REFUSED);
      settle();

      expect(toasts()).toEqual(['Ya existe una empresa con ese nombre']);
      expect(chosen('ai-company')).toEqual([]);
      expect(button('Crear empresa «Acme del Sur»').disabled).toBeFalse();
      expect(button('Guardar caso').disabled).toBeTrue();
    }));

    // "Acme" in the capture may be the client the team has as "Ferretería El Tornillo".
    it('the AI read gives way to the one the person chooses instead, and is offered again if they take it off', fakeAsync(() => {
      analyzed({ company: 'Acme del Sur' });
      pick('ai-company', 'Ferretería El Tornillo');
      expect(hint()).toBeNull();

      clearSelect(select('ai-company'));
      render();
      expect(hint()?.textContent).toContain('La IA leyó «Acme del Sur»');
      http.expectNone({ method: 'POST', url: '/api/companies' });
    }));

    // A deactivated company takes no new cases, and a second one with its name cannot be created.
    it('the AI read that is deactivated is not chosen, and the dialog says where to activate it instead of offering to create it', fakeAsync(() => {
      analyzed({ company: 'bodega sur' });

      expect(chosen('ai-company')).toEqual([]);
      expect(hint()?.textContent).toContain('La IA leyó «bodega sur», que está desactivada. Elige otra empresa, o actívala en Configuración > Empresas.');
      expect(hint()?.querySelector('button')).toBeNull();
    }));

    it('says nothing when the AI read no company: the person chooses it', fakeAsync(() => {
      analyzed({ company: null });

      expect(chosen('ai-company')).toEqual([]);
      expect(hint()).toBeNull();
    }));
  });

  // The dialog closes with Escape, which it hears on the document.
  it('Escape with a list of options open closes the list, and the dialog stays with what was filled in', fakeAsync(() => {
    byHand();
    typeInSelect(select('ai-company'), 'ferr');
    render();
    select('ai-company')
      .querySelector('input')!
      .dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    render();

    expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    expect(closed).toBe(0);
  }));

  // The lists hang from the body, over the dimmed area around the dialog: a click there is how a list is put away.
  it('a click outside the dialog with a list of options open closes the list, and the dialog stays with what was filled in', fakeAsync(() => {
    byHand();
    type('ai-description', 'No imprime la factura');
    openSelect(select('ai-priority'));
    render();
    expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

    click(el.querySelector<HTMLElement>('.modal-backdrop')!);
    expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    expect(closed).toBe(0);
    expect(el.querySelector<HTMLTextAreaElement>('#ai-description')!.value).toBe('No imprime la factura');

    // With no list open, the same click is the way out it always was.
    click(el.querySelector<HTMLElement>('.modal-backdrop')!);
    expect(closed).toBe(1);
  }));
});
