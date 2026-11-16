import type { HttpTestingController, TestRequest } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { Announcer } from '../../core/announcer';
import { Branding } from '../../core/branding';
import { Confirm } from '../../core/confirm';
import { toSmallPng } from '../../core/ui';
import { httpTestBed } from '../../testing/http';
import { nextTask, said } from '../../testing/screen';
import { BrandingTab } from './branding-tab';

/** Waits, a turn at a time, until `ready` holds: preparing the image is real work of the browser. */
async function until(ready: () => boolean): Promise<void> {
  for (let turn = 0; turn < 200 && !ready(); turn++) await new Promise((resolve) => setTimeout(resolve, 10));
}

/** An image file of the given size, drawn here so no test depends on a file on disk. */
async function picture(width: number, height: number, type = 'image/png'): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#0c7beb';
  context.fillRect(0, 0, width / 2, height);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((made) => resolve(made!), type));
  return new File([blob], 'logo-empresa.png', { type });
}

async function sizeOf(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  return { width: bitmap.width, height: bitmap.height };
}

describe('toSmallPng', () => {
  it('shrinks a large image to the longest side given, keeping its proportions', async () => {
    const small = await toSmallPng(await picture(1200, 600), 256);

    expect(small.type).toBe('image/png');
    expect(small.name).toBe('logo-empresa.png');
    expect(await sizeOf(small)).toEqual({ width: 256, height: 128 });
  });

  it('does not enlarge a small image', async () => {
    expect(await sizeOf(await toSmallPng(await picture(64, 48), 256))).toEqual({ width: 64, height: 48 });
  });

  it('keeps the transparent parts transparent', async () => {
    const small = await toSmallPng(await picture(400, 400), 100);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 100;
    const context = canvas.getContext('2d')!;
    context.drawImage(await createImageBitmap(small), 0, 0);

    // Left half painted, right half never painted.
    expect(context.getImageData(10, 50, 1, 1).data[3]).toBe(255);
    expect(context.getImageData(90, 50, 1, 1).data[3]).toBe(0);
  });

  // The server refuses SVG, which can carry scripts. Drawn here, only its picture is sent.
  it('turns an SVG into a plain PNG', async () => {
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><rect width="40" height="20" fill="red"/></svg>'], 'logo.svg', { type: 'image/svg+xml' });

    const png = await toSmallPng(svg, 256);

    expect(png.type).toBe('image/png');
    expect(png.name).toBe('logo.png');
    expect(new Uint8Array(await png.slice(0, 4).arrayBuffer())).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
  });

  it('says so, in Spanish, when the file is not an image', async () => {
    const notAnImage = new File(['hola'], 'notas.txt', { type: 'text/plain' });

    await expectAsync(toSmallPng(notAnImage, 256)).toBeRejectedWithError('El archivo no es una imagen que se pueda leer.');
  });
});

describe('BrandingTab, the company logo in Configuración', () => {
  let fixture: ComponentFixture<BrandingTab>;
  let el: HTMLElement;
  let http: HttpTestingController;
  let branding: Branding;
  let confirm: Confirm;

  const button =(text: string): HTMLButtonElement | undefined => Array.from(el.querySelectorAll('button')).find((item) => item.textContent?.includes(text));
  const picker = (): HTMLInputElement => el.querySelector<HTMLInputElement>('input[type=file]')!;
  /** What choosing a file in the browser's dialog does. */
  function choose(file: File): void {
    const files = new DataTransfer();
    files.items.add(file);
    picker().files = files.files;
    picker().dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }
  async function upload(file: File): Promise<TestRequest> {
    choose(file);
    let request: TestRequest | undefined;
    await until(() => (request = http.match({ method: 'PUT', url: '/api/branding/logo' })[0]) !== undefined);
    if (!request) throw new Error('the logo was never sent');
    return request;
  }

  beforeEach(() => {
    http = httpTestBed();
    branding = TestBed.inject(Branding);
    confirm = TestBed.inject(Confirm);
    fixture = TestBed.createComponent(BrandingTab);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  it('offers to upload an image, and nothing to remove, while there is no logo', () => {
    expect(button('Subir imagen')).toBeDefined();
    expect(button('Quitar logo')).toBeUndefined();
    expect(picker().accept).toBe('image/png,image/jpeg,image/webp,image/svg+xml');
    expect(el.querySelector('app-logo app-icon[data-icon=lifebuoy]')).not.toBeNull();
  });

  it('sends the chosen image as a small PNG and shows it at once', async () => {
    const request = await upload(await picture(900, 900));

    const sent = (request.request.body as FormData).get('file') as File;
    expect(sent.type).toBe('image/png');
    expect(await sizeOf(sent)).toEqual({ width: 256, height: 256 });

    request.flush({ logoVersion: 'v1' });
    await until(() => branding.logoUrl() !== null);
    fixture.detectChanges();

    expect(branding.logoUrl()).toBe('/api/branding/logo?v=v1');
    expect(el.querySelector('app-logo img')?.getAttribute('src')).toBe('/api/branding/logo?v=v1');
    expect(button('Cambiar imagen')).toBeDefined();
    expect(button('Quitar logo')).toBeDefined();
    // Choosing the same file again must count as a new choice.
    expect(picker().value).toBe('');
  });

  // The icon that turns was all that said it, and it stands still with less motion asked for.
  it('says in words what it is doing while the logo is sent, and while it is removed', async () => {
    branding.use('v1');
    fixture.detectChanges();
    const sent = await upload(await picture(100, 100));
    fixture.detectChanges();
    expect(button('Subiendo…')?.disabled).toBeTrue();
    expect(button('Quitar logo')?.disabled).toBeTrue();
    sent.flush({ logoVersion: 'v2' });
    await until(() => branding.logoUrl() === '/api/branding/logo?v=v2');
    await nextTask();
    fixture.detectChanges();
    expect(button('Subiendo…')).toBeUndefined();

    button('Quitar logo')!.click();
    confirm.answer(true);
    await nextTask();
    fixture.detectChanges();
    expect(button('Quitando…')?.disabled).toBeTrue();
    expect(button('Cambiar imagen')?.disabled).toBeTrue();
    expect(button('Cambiar imagen')?.querySelector('app-icon')?.getAttribute('data-icon')).toBe('upload');
    http.expectOne({ method: 'DELETE', url: '/api/branding/logo' }).flush(null);
    await until(() => branding.logoUrl() === null);
    fixture.detectChanges();
    expect(button('Quitando…')).toBeUndefined();
    expect(button('Subir imagen')?.disabled).toBeFalse();
  });

  it('shows why when the server refuses the image, and keeps the logo it had', async () => {
    branding.use('v1');
    fixture.detectChanges();

    const request = await upload(await picture(100, 100));
    request.flush({ message: 'El logo debe ser una imagen PNG, JPG o WebP.' }, { status: 400, statusText: 'Bad Request' });
    await until(() => el.querySelector('.alert-error') !== null);
    fixture.detectChanges();

    expect(el.querySelector('.alert-error')?.textContent).toContain('El logo debe ser una imagen PNG, JPG o WebP.');
    expect(branding.logoUrl()).toBe('/api/branding/logo?v=v1');
    // Said at once as it comes: it was an alert that came with its words, which a screen reader may not read.
    expect(el.querySelector('.alert-error')!.closest('[role=alert], [role=status], [aria-live]')).toBeNull();
    expect(said()).toEqual(['El logo debe ser una imagen PNG, JPG o WebP.']);
    expect(TestBed.inject(Announcer).said()[0].politeness).toBe('assertive');
  });

  it('sends nothing for a file that is not an image, and says why', async () => {
    choose(new File(['hola'], 'notas.txt', { type: 'text/plain' }));
    await until(() => el.querySelector('.alert-error') !== null);
    fixture.detectChanges();

    expect(el.querySelector('.alert-error')?.textContent).toContain('El archivo no es una imagen que se pueda leer.');
    expect(said()).toEqual(['El archivo no es una imagen que se pueda leer.']);
    http.expectNone('/api/branding/logo');
  });

  // The question is asked in the dialog of the app, as every other one: here it is answered without the dialog.
  it('removes the logo after asking, and goes back to the default icon', async () => {
    branding.use('v1');
    fixture.detectChanges();

    button('Quitar logo')!.click();
    expect(confirm.current()).toEqual(jasmine.objectContaining({ title: '¿Quitar el logo y volver al icono por defecto?', confirmLabel: 'Quitar', danger: true }));
    // Nothing is removed while the question is on screen.
    http.expectNone('/api/branding/logo');

    confirm.answer(true);
    // The answer reaches the tab a turn later.
    await nextTask();
    http.expectOne({ method: 'DELETE', url: '/api/branding/logo' }).flush(null);
    await until(() => branding.logoUrl() === null);
    fixture.detectChanges();

    expect(confirm.current()).toBeNull();
    expect(branding.logoUrl()).toBeNull();
    expect(el.querySelector('app-logo app-icon[data-icon=lifebuoy]')).not.toBeNull();
    expect(button('Quitar logo')).toBeUndefined();
  });

  it('keeps the logo when the person answers no', async () => {
    branding.use('v1');
    fixture.detectChanges();

    button('Quitar logo')!.click();
    confirm.answer(false);
    await nextTask();

    http.expectNone('/api/branding/logo');
    expect(branding.logoUrl()).toBe('/api/branding/logo?v=v1');
  });
});
