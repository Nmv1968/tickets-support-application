import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Toast } from '../../core/toast';
import { ImportDialog } from './import-dialog';

/** Lets the promise chains that follow an answered request run. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

// The template is how a person gets the format the import reads without guessing it.
describe('ImportDialog, the template to fill in', () => {
  let fixture: ComponentFixture<ImportDialog>;
  let http: HttpTestingController;
  let saved: { name: string; href: string }[];

  const button = (): HTMLButtonElement => {
    const buttons = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button'));
    return buttons.find((item) => item.textContent?.includes('Descargar plantilla')) as HTMLButtonElement;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    http = TestBed.inject(HttpTestingController);
    // A click on a link with `download` saves a file: here it is only recorded.
    saved = [];
    spyOn(HTMLAnchorElement.prototype, 'click').and.callFake(function (this: HTMLAnchorElement) {
      saved.push({ name: this.download, href: this.href });
    });
    fixture = TestBed.createComponent(ImportDialog);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('downloads the spreadsheet from the server and saves it under its name', async () => {
    button().click();
    fixture.detectChanges();
    expect(button().disabled).toBeTrue();

    const request = http.expectOne({ method: 'GET', url: '/api/import/template' });
    expect(request.request.responseType).toBe('blob');
    request.flush(new Blob(['xlsx']));
    await settle();
    fixture.detectChanges();

    expect(saved.length).toBe(1);
    expect(saved[0].name).toBe('plantilla-casos-soporte.xlsx');
    expect(saved[0].href).toMatch(/^blob:/);
    expect(button().disabled).toBeFalse();
  });

  it('says why when the download fails, saves nothing and can be tried again', async () => {
    const toast = spyOn(TestBed.inject(Toast), 'error');

    button().click();
    http
      .expectOne('/api/import/template')
      .flush(new Blob([JSON.stringify({ message: 'No se pudo generar la plantilla' })], { type: 'application/json' }), {
        status: 500,
        statusText: 'Server Error',
      });
    // The error body arrives as a file and is read back before the message is shown: that takes more than one turn.
    for (let turn = 0; turn < 50 && !toast.calls.count(); turn++) await settle();
    fixture.detectChanges();

    expect(saved).toEqual([]);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(button().disabled).toBeFalse();
  });

  it('does not touch the file chosen for the import', async () => {
    button().click();
    http.expectOne('/api/import/template').flush(new Blob(['xlsx']));
    await settle();
    fixture.detectChanges();

    // No preview was asked for and the import button still waits for a file.
    const importButton = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('button')).find((item) => item.textContent?.includes('Importar'));
    expect(importButton?.disabled).toBeTrue();
  });
});
