import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { buttonIn, said } from '../testing/screen';
import { DialogPending } from './dialog-pending';

@Component({
  imports: [DialogPending],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-dialog-pending [failed]="failed()" (closed)="closes.set(closes() + 1)" />`,
})
class Host {
  readonly failed = signal(false);
  readonly closes = signal(0);
}

describe('DialogPending', () => {
  function render(failed = false): { root: HTMLElement; host: Host; update: () => void } {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.failed.set(failed);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, host: fixture.componentInstance, update: () => fixture.detectChanges() };
  }

  // It was a status that came with its words: a screen reader may say nothing of one.
  it('says that the dialog is opening, through the Announcer, as it comes', () => {
    const { root } = render();
    const card = root.querySelector('.card');

    expect(card?.textContent?.trim()).toBe('Abriendo…');
    expect(card?.querySelector('app-icon')?.getAttribute('data-icon')).toBe('loading');
    expect(said()).toEqual(['Abriendo…']);
    expect(root.querySelector('[role=status], [role=alert], [aria-live]')).toBeNull();
    expect(root.querySelector('[role=alertdialog]')).toBeNull();
  });

  it('closes with Escape and with a press outside, like the dialog it stands for', () => {
    const { root, host } = render();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(host.closes()).toBe(1);

    root.querySelector<HTMLElement>('.modal-backdrop')!.click();
    expect(host.closes()).toBe(2);

    root.querySelector<HTMLElement>('.card')!.click();
    expect(host.closes()).toBe(2);
  });

  it('says that the dialog could not open, and closes with "Cerrar"', () => {
    const { root, host } = render(true);
    const dialog = root.querySelector('[role=alertdialog]')!;

    expect(root.textContent).not.toContain('Abriendo…');
    expect(said()).toEqual([]);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(root.querySelector(`#${dialog.getAttribute('aria-labelledby')}`)?.textContent?.trim()).toBe('No se pudo abrir');
    expect(root.querySelector(`#${dialog.getAttribute('aria-describedby')}`)?.textContent?.trim()).toBe(
      'Revisa la conexión y vuelve a cargar la página.',
    );

    buttonIn(dialog, 'Cerrar').click();
    expect(host.closes()).toBe(1);
  });

  it('turns from opening into failed', () => {
    const { root, host, update } = render();
    host.failed.set(true);
    update();

    // "Abriendo…" goes with what it said.
    expect(root.textContent).not.toContain('Abriendo…');
    expect(said()).toEqual([]);
    expect(root.querySelector('[role=alertdialog]')).not.toBeNull();
  });
});
