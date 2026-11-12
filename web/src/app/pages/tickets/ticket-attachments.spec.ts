import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { TicketAttachments } from './ticket-attachments';

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

// The block listens to pastes on the whole document, so that a screenshot can be pasted with the
// focus anywhere in the case panel. The fields of the panel are stood in for by one on the page.
describe('TicketAttachments, a paste', () => {
  let http: HttpTestingController;
  let field: HTMLTextAreaElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);

    const fixture = TestBed.createComponent(TicketAttachments);
    fixture.componentRef.setInput('ticketId', 7);
    fixture.componentRef.setInput('attachments', []);
    fixture.detectChanges();

    field = document.body.appendChild(document.createElement('textarea'));
  });

  afterEach(() => {
    field.remove();
    http.verify();
  });

  const uploads = (): string[][] =>
    http.match({ method: 'POST', url: '/api/tickets/7/attachments' }).map((upload) => (upload.request.body as FormData).getAll('files').map((file) => (file as File).name));

  it('of a screenshot uploads it to the case, also while a field has the focus', () => {
    expect(paste(document.body, [picture]).defaultPrevented).toBeTrue();
    expect(paste(field, [picture]).defaultPrevented).toBeTrue();
    expect(uploads()).toEqual([['captura.png'], ['captura.png']]);
  });

  // A cell copied from Excel carries its text and a picture of the cell. Taken as a screenshot,
  // the text would not be pasted and the picture would be stored on the case.
  it('of text into a field is left to the browser, even when the clipboard also has a picture of it', () => {
    expect(paste(field, [picture], 'Ferretería El Tornillo').defaultPrevented).toBeFalse();
    expect(uploads()).toEqual([]);
  });
});
