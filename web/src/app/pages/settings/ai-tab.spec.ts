import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { AiProviderConfig } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { Toast } from '../../core/toast';
import { chooseOption, clearSelect, ngSelect, optionTexts, selectedTexts } from '../../testing/ng-select';
import { buttonIn } from '../../testing/screen';
import { AiTab } from './ai-tab';

/** A server chosen by its URL, with a key already stored for it. */
const COMPATIBLE: AiProviderConfig = {
  id: 'compatible',
  label: 'Compatible con OpenAI',
  needsBaseUrl: true,
  keyOptional: true,
  hasKey: true,
  keyHint: '…a1b2',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'un-modelo',
  active: true,
};

describe('AiTab, the server URL of a provider that has a stored key', () => {
  let fixture: ComponentFixture<AiTab>;
  let el: HTMLElement;

  beforeEach(() => {
    // The light theme, where the warning could not be read.
    document.documentElement.classList.remove('dark');
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  });

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
  }

  function open(): void {
    fixture = TestBed.createComponent(AiTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    TestBed.inject(HttpTestingController).expectOne({ method: 'GET', url: '/api/ai/config' }).flush([COMPATIBLE]);
    tick();
    render();
  }

  function write(selector: string, text: string): void {
    const input = el.querySelector<HTMLInputElement>(selector)!;
    input.value = text;
    input.dispatchEvent(new Event('input'));
    render();
  }

  const warning = (): HTMLElement | null => el.querySelector('p[role=status]');

  it('says nothing while the URL is the one the key was stored with', fakeAsync(() => {
    open();
    expect(warning()).toBeNull();

    // The server compares the two without the slashes at the end.
    write('#ai-url', ' https://openrouter.ai/api/v1/ ');
    expect(warning()).toBeNull();
  }));

  // The server deletes the stored key when another URL is saved without one. The only text that
  // says so was 11 px orange on white, about 2:1 of contrast.
  it('once changed, warns that the stored key has to be typed again, in text that can be read', fakeAsync(() => {
    open();
    write('#ai-url', 'https://api.groq.com/openai/v1');

    const notice = warning()!;
    expect(notice.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Cambiaste la URL del servidor. La API key guardada es de la URL anterior y no se envía a otra: escríbela de nuevo. Si guardas sin escribirla, la guardada se borra.',
    );
    // As the other notices: the text in the colour and size of the text around it, the warning
    // colour only in the background and in the icon.
    const style = getComputedStyle(notice);
    expect(style.color).toBe(getComputedStyle(el.querySelector('h2')!).color);
    expect(style.fontSize).toBe('12px');
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
    expect(notice.querySelector('app-icon[data-icon=alert-outline][aria-hidden=true]')).not.toBeNull();

    write('#ai-key', 'sk-otra');
    expect(warning()).toBeNull();
  }));
});

// The list comes from the provider, with the key typed or stored: it can be long, so it is a
// select with a search box.
describe('AiTab, the model of a provider', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<AiTab>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  function open(): void {
    fixture = TestBed.createComponent(AiTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([COMPATIBLE]);
    tick();
    render();
  }

  const button = (text: string): HTMLButtonElement => buttonIn(el, text);

  /** "Cargar modelos", answered with the models the key gives access to. */
  function loadModels(models: { id: string; name: string; vision: boolean | null }[]): void {
    button('Cargar modelos').click();
    render();
    http.expectOne({ method: 'POST', url: '/api/ai/models' }).flush(models);
    tick();
    render();
  }

  it('is written by hand until the models are loaded, and then chosen among them, each with what it reads', fakeAsync(() => {
    open();
    expect(el.querySelector<HTMLInputElement>('input#ai-model')!.value).toBe('un-modelo');

    loadModels([
      { id: 'vision-1', name: 'Visión 1', vision: true },
      { id: 'un-modelo', name: 'Un modelo', vision: false },
      { id: 'otro', name: 'Otro', vision: null },
    ]);
    const select = ngSelect(el, 'ai-model');
    expect(el.querySelector('label[for=ai-model]')!.textContent).toContain('Modelo');
    expect(selectedTexts(select)).toEqual(['Un modelo · solo texto']);
    expect(optionTexts(select)).toEqual(['Visión 1 · lee imágenes', 'Un modelo · solo texto', 'Otro']);

    chooseOption(select, 'Visión 1 · lee imágenes');
    render();
    button('Guardar y activar').click();
    render();

    const save = http.expectOne({ method: 'PUT', url: '/api/ai/config/compatible' });
    // No key typed: the stored one stays.
    expect(save.request.body).toEqual({ apiKey: undefined, baseUrl: 'https://openrouter.ai/api/v1', model: 'vision-1', active: true });
    save.flush(null);
    tick();
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([{ ...COMPATIBLE, model: 'vision-1' }]);
    tick(3000);
  }));

  // A model has to be chosen: the select cannot be left empty once it has one.
  it('has none chosen when the one saved is not among the models loaded, and cannot be saved until one is', fakeAsync(() => {
    open();
    loadModels([{ id: 'vision-1', name: 'Visión 1', vision: true }]);
    const select = ngSelect(el, 'ai-model');

    expect(selectedTexts(select)).toEqual([]);
    expect(select.textContent).toContain('Elige un modelo');
    expect(button('Guardar y activar').disabled).toBeTrue();

    chooseOption(select, 'Visión 1 · lee imágenes');
    render();
    expect(button('Guardar y activar').disabled).toBeFalse();
    expect(() => clearSelect(select)).toThrowError();
  }));
});

// The key never comes back to the browser: taken off, it has to be typed again.
describe('AiTab, "Quitar API key"', () => {
  let http: HttpTestingController;
  let confirm: Confirm;
  let fixture: ComponentFixture<AiTab>;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    confirm = TestBed.inject(Confirm);
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  /** The tab with a provider that has a key stored, and its "Quitar API key" pressed. */
  function press(): void {
    fixture = TestBed.createComponent(AiTab);
    el = fixture.nativeElement as HTMLElement;
    render();
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([COMPATIBLE]);
    tick();
    render();
    [...el.querySelectorAll('button')].find((item) => item.textContent?.trim() === 'Quitar API key')!.click();
    render();
  }

  // The question is asked in the dialog of the app, as every other one: here it is answered without the dialog.
  it('asks first, as a danger, and takes the key off the provider only once the person confirms', fakeAsync(() => {
    press();
    expect(confirm.current()).toEqual(jasmine.objectContaining({ title: '¿Quitar la API key guardada de este proveedor?', confirmLabel: 'Quitar', danger: true }));
    http.expectNone({ method: 'PUT', url: '/api/ai/config/compatible' });

    confirm.answer(true);
    tick();
    const save = http.expectOne({ method: 'PUT', url: '/api/ai/config/compatible' });
    // Without its key the provider cannot stay in use.
    expect(save.request.body).toEqual({ apiKey: '', active: false });
    save.flush(null);
    tick();
    http.expectOne({ method: 'GET', url: '/api/ai/config' }).flush([{ ...COMPATIBLE, hasKey: false, keyHint: null, active: false }]);
    tick();
    render();

    expect(TestBed.inject(Toast).items().map((item) => item.text)).toEqual(['API key eliminada']);
    expect([...el.querySelectorAll('button')].some((item) => item.textContent?.trim() === 'Quitar API key')).toBeFalse();
  }));

  it('leaves the key where it is when the person answers no', fakeAsync(() => {
    press();
    confirm.answer(false);
    tick();

    http.expectNone({ method: 'PUT', url: '/api/ai/config/compatible' });
  }));
});
