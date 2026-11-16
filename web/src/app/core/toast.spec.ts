import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Toast, Toasts } from './toast';

describe('Toasts', () => {
  // Their time is a timer, and the app has no zone to tell Angular when it fires: a toast leaves
  // the screen because the list of toasts is a signal.
  it('leave the screen by themselves when their time is up, with nobody checking the screen', fakeAsync(() => {
    const fixture = TestBed.createComponent(Toasts);
    const el = fixture.nativeElement as HTMLElement;
    const toast = TestBed.inject(Toast);
    tick();

    toast.ok('Caso actualizado');
    toast.error('No se pudo guardar el caso');
    tick();
    expect(el.textContent).toContain('Caso actualizado');
    expect(el.textContent).toContain('No se pudo guardar el caso');

    tick(3000);
    expect(el.textContent).not.toContain('Caso actualizado');
    expect(el.textContent).toContain('No se pudo guardar el caso');

    tick(3000);
    expect(el.textContent).not.toContain('No se pudo guardar el caso');
  }));

  it('say an error at once to a screen reader, and wait their turn for anything else', fakeAsync(() => {
    const fixture = TestBed.createComponent(Toasts);
    const el = fixture.nativeElement as HTMLElement;
    const toast = TestBed.inject(Toast);
    const region = (): string | null => el.querySelector('[aria-live]')!.getAttribute('aria-live');
    tick();
    expect(region()).toBe('polite');

    toast.ok('Caso actualizado');
    tick();
    expect(region()).toBe('polite');

    toast.error('No se pudo guardar el caso');
    tick();
    expect(region()).toBe('assertive');

    // The region reads what comes in: a toast that leaves is not read.
    toast.ok('Observación agregada');
    tick();
    expect(region()).toBe('polite');
    tick(6000);
  }));

  it('show a check for what went well and an alert for an error, in their colours', fakeAsync(() => {
    const fixture = TestBed.createComponent(Toasts);
    const el = fixture.nativeElement as HTMLElement;
    const toast = TestBed.inject(Toast);
    tick();

    toast.ok('Caso actualizado');
    toast.error('No se pudo guardar el caso');
    tick();
    const [ok, error] = Array.from(el.querySelectorAll('button app-icon'));
    expect(ok.getAttribute('data-icon')).toBe('check-circle');
    expect(ok.classList).toContain('text-success');
    expect(error.getAttribute('data-icon')).toBe('alert-circle');
    expect(error.classList).toContain('text-danger');
    expect(error.closest('button')!.classList).toContain('border-danger');
    tick(6000);
  }));
});
