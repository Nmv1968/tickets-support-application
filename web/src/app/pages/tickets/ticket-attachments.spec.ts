import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { Attachment } from '../../core/api';
import { Confirm } from '../../core/confirm';
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

// A file is deleted at once, like everything in the panel that is not a field of the case. It
// cannot be brought back, so the dialog of the app asks first.
describe('TicketAttachments, a file deleted', () => {
  let http: HttpTestingController;
  let confirm: Confirm;
  let fixture: ComponentFixture<TicketAttachments>;

  const manual: Attachment = { id: 3, filename: 'manual.pdf', mime: 'application/pdf', size: 2048, createdAt: '2026-11-06T09:00:00.000Z' };
  const remove = { method: 'DELETE', url: '/api/attachments/3' };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    confirm = TestBed.inject(Confirm);

    fixture = TestBed.createComponent(TicketAttachments);
    fixture.componentRef.setInput('ticketId', 7);
    fixture.componentRef.setInput('attachments', [manual]);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  /** Presses the "×" of the file and answers the question it asks. */
  function removeAndAnswer(confirmed: boolean): void {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Eliminar manual.pdf"]')!.click();
    expect(confirm.current()).toEqual(jasmine.objectContaining({ title: '¿Eliminar el adjunto "manual.pdf"?', confirmLabel: 'Eliminar', danger: true }));
    http.expectNone(remove);
    confirm.answer(confirmed);
    tick();
  }

  it('is deleted once the person confirms it, and the case is read again for every screen that shows it', fakeAsync(() => {
    removeAndAnswer(true);

    http.expectOne(remove).flush(null);
    tick();
    // The delete answers nothing: the case as it stands now is what the other screens are told.
    http.expectOne({ method: 'GET', url: '/api/tickets/7' }).flush({ id: 7, attachments: [] });
    tick();
  }));

  it('stays when the person cancels the question', fakeAsync(() => {
    removeAndAnswer(false);

    http.expectNone(remove);
  }));

  // The panel was given another case while the question was on screen: the file asked about is not there any more.
  it('stays when the question is answered after the block moved on to the files of another case', fakeAsync(() => {
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button[aria-label="Eliminar manual.pdf"]')!.click();
    fixture.componentRef.setInput('ticketId', 8);
    fixture.componentRef.setInput('attachments', []);
    fixture.detectChanges();
    confirm.answer(true);
    tick();

    http.expectNone(remove);
  }));
});
