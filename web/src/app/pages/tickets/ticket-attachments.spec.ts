import type { HttpTestingController } from '@angular/common/http/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import type { Attachment } from '../../core/api';
import { Confirm } from '../../core/confirm';
import { httpTestBed } from '../../testing/http';
import { paste } from '../../testing/screen';
import { resizeScreen } from '../../testing/viewport';
import { TicketAttachments } from './ticket-attachments';

const picture = new File(['png'], 'captura.png', { type: 'image/png' });

// The block listens to pastes on the whole document, so that a screenshot can be pasted with the
// focus anywhere in the case panel. The fields of the panel are stood in for by one on the page.
describe('TicketAttachments, a paste', () => {
  let http: HttpTestingController;
  let field: HTMLTextAreaElement;

  beforeEach(() => {
    http = httpTestBed();

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

// Cut with an ellipsis in a third of a phone, three letters of a name were left, and the rest was only in its title.
describe('TicketAttachments, the name of a file', () => {
  const long: Attachment = {
    id: 5,
    filename: 'Informe de errores de facturación electrónica de la sucursal del norte, noviembre.pdf',
    mime: 'application/pdf',
    size: 4096,
    createdAt: '2026-11-06T09:00:00.000Z',
  };

  it('is written whole on a phone, on as many lines as it takes, with its size and its "×" under it', () => {
    httpTestBed();
    resizeScreen(375, 812);
    const fixture = TestBed.createComponent(TicketAttachments);
    fixture.componentRef.setInput('ticketId', 7);
    fixture.componentRef.setInput('attachments', [long]);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);

    const name = Array.from(el.querySelectorAll<HTMLElement>('span')).find((span) => span.textContent?.trim() === long.filename)!;
    const remove = el.querySelector<HTMLElement>(`button[aria-label="Eliminar ${long.filename}"]`)!;
    expect(getComputedStyle(name).textOverflow).not.toBe('ellipsis');
    expect(name.scrollWidth).toBeLessThanOrEqual(name.clientWidth);
    expect(name.offsetHeight).toBeGreaterThan(2 * parseFloat(getComputedStyle(name).lineHeight));
    expect(remove.getBoundingClientRect().top).toBeGreaterThanOrEqual(name.getBoundingClientRect().bottom - 4);
    el.remove();
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
    http = httpTestBed();
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

  // Its "×" was 11 × 16 px, right under the button of the picture (WCAG 2.5.8), in a panel used on phones.
  describe('is deleted with a "×"', () => {
    const el = (): HTMLElement => fixture.nativeElement as HTMLElement;
    const button = (): HTMLButtonElement => el().querySelector<HTMLButtonElement>('button[aria-label="Eliminar manual.pdf"]')!;
    /** Clear of the picture above it, which another press opens. */
    const clearOfPicture = (): boolean => button().getBoundingClientRect().top >= el().querySelector('button[title="manual.pdf"]')!.getBoundingClientRect().bottom;

    it('of 24 px a side on a laptop, which leaves the line of the file as high as before', () => {
      resizeScreen(1280, 800);
      expect(button().getBoundingClientRect().width).toBeGreaterThanOrEqual(24);
      expect(button().getBoundingClientRect().height).toBeGreaterThanOrEqual(24);
      // The line of a file is 24 px high: its padding, and the line of its name.
      expect(button().parentElement!.offsetHeight).toBeLessThanOrEqual(24);
      expect(clearOfPicture()).toBeTrue();
    });

    // Every button of an icon is a finger's size on a phone (.btn-icon): the line of the file grows for it.
    it('of 44 px a side on a phone', () => {
      resizeScreen(390, 844);
      expect(button().getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(button().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(clearOfPicture()).toBeTrue();
    });
  });

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

// The enlarged image was a button over the whole screen: the focus stayed on the thumbnail under it,
// and Tab went on to the hidden "Eliminar" buttons, which could be pressed unseen.
describe('TicketAttachments, an image enlarged', () => {
  let http: HttpTestingController;
  let fixture: ComponentFixture<TicketAttachments>;
  let el: HTMLElement;

  const shot: Attachment = { id: 4, filename: 'captura.png', mime: 'image/png', size: 2048, createdAt: '2026-11-06T09:00:00.000Z' };

  beforeEach(() => {
    http = httpTestBed();
  });

  afterEach(() => http.verify());

  function render(): void {
    fixture.detectChanges();
    tick();
    fixture.detectChanges();
  }

  function open(): HTMLButtonElement {
    fixture = TestBed.createComponent(TicketAttachments);
    el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('ticketId', 7);
    fixture.componentRef.setInput('attachments', [shot]);
    fixture.detectChanges();
    http.expectOne({ method: 'GET', url: '/api/attachments/4' }).flush(new Blob(['png'], { type: 'image/png' }));
    render();
    const thumbnail = el.querySelector<HTMLButtonElement>('button[title="captura.png"]')!;
    thumbnail.focus();
    thumbnail.click();
    render();
    return thumbnail;
  }

  const dialog = (): HTMLElement | null => el.querySelector('[role=dialog]');
  const close = (): HTMLButtonElement => dialog()!.querySelector<HTMLButtonElement>('button')!;

  it('is a dialog named by its file, with the focus on its "Cerrar" and kept in it', fakeAsync(() => {
    open();

    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    expect(dialog()!.getAttribute('aria-label')).toBe('Imagen: captura.png');
    expect(dialog()!.querySelector('img')!.alt).toBe('captura.png');
    expect(close().textContent?.trim()).toBe('Cerrar');
    expect(document.activeElement).toBe(close());
    // The ends of the trap that keeps Tab inside it.
    expect(dialog()!.previousElementSibling?.classList).toContain('cdk-focus-trap-anchor');
    expect(dialog()!.nextElementSibling?.classList).toContain('cdk-focus-trap-anchor');
  }));

  it('gives the focus back to its thumbnail however it is closed: "Cerrar", a press beside the image, Escape', fakeAsync(() => {
    let thumbnail = open();
    close().click();
    render();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(thumbnail);

    thumbnail = open();
    dialog()!.click();
    render();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(thumbnail);

    // Escape is heard by the panel, which asks the block first.
    thumbnail = open();
    expect(fixture.componentInstance.closeLightbox()).toBeTrue();
    render();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(thumbnail);
  }));

  it('stays open with a press on the image itself', fakeAsync(() => {
    open();
    dialog()!.querySelector('img')!.click();
    render();
    expect(dialog()).not.toBeNull();
    close().click();
    render();
  }));
});
