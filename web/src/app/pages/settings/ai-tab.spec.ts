import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import type { AiProviderConfig } from '../../core/api';
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
    expect(notice.querySelector('i.mdi-alert-outline[aria-hidden=true]')).not.toBeNull();

    write('#ai-key', 'sk-otra');
    expect(warning()).toBeNull();
  }));
});
