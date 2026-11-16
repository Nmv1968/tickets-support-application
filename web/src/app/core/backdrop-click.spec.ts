import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { BackdropClick } from './backdrop-click';

@Component({
  imports: [BackdropClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (appBackdropClick)="close()">
      <div role="dialog">
        <input type="checkbox" aria-label="Crear lo que falta" />
      </div>
    </div>
  `,
})
class Dialog {
  readonly closes = signal(0);

  close(): void {
    this.closes.update((count) => count + 1);
  }
}

describe('BackdropClick', () => {
  function render(): { root: HTMLElement; dialog: Dialog } {
    const fixture = TestBed.createComponent(Dialog);
    fixture.detectChanges();
    return { root: fixture.nativeElement as HTMLElement, dialog: fixture.componentInstance };
  }

  it('is a click on the backdrop itself', () => {
    const { root, dialog } = render();
    root.querySelector<HTMLElement>('.modal-backdrop')!.click();

    expect(dialog.closes()).toBe(1);
  });

  // A checkbox of the dialog still changes: the click is not cancelled on its way up.
  it('is not a click inside the dialog, which does what it does', () => {
    const { root, dialog } = render();
    const box = root.querySelector<HTMLInputElement>('input[type=checkbox]')!;
    box.click();

    expect(dialog.closes()).toBe(0);
    expect(box.checked).toBeTrue();
  });
});
