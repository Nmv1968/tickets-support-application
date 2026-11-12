import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AiDraftDialog } from './ai-draft';

const picture = new File(['png'], 'captura.png', { type: 'image/png' });

/** A paste as the browser reports it: on the element that has the focus, with what was copied. */
function paste(target: Element, files: File[], text?: string): ClipboardEvent {
  const data = new DataTransfer();
  for (const file of files) data.items.add(file);
  if (text !== undefined) data.setData('text/plain', text);
  const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

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
    // The companies the review step suggests.
    http.expectOne({ method: 'GET', url: '/api/tickets/companies' }).flush([]);
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

  // The box asks for the client's message to be pasted in it. Copied from Excel or from a chat,
  // it can come with a picture of itself next to the text.
  it('of text into the text box is left to the browser, even when the clipboard also has a picture of it', fakeAsync(() => {
    open();
    expect(paste(textBox(), [picture], 'No puedo facturar desde ayer').defaultPrevented).toBeFalse();
    render();
    expect(images()).toBe(0);
  }));
});
