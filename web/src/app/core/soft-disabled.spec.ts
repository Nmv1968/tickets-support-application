import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { SoftDisabled } from './soft-disabled';

@Component({
  imports: [FormsModule, SoftDisabled],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button id="save" type="button" class="btn btn-primary" [appSoftDisabled]="busy()" (click)="pressed = pressed + 1" (refused)="refused = refused + 1">Guardar</button>
    <form (ngSubmit)="sent = sent + 1">
      <input id="field" name="field" />
      <button id="send" type="submit" class="btn btn-primary" [appSoftDisabled]="busy()">Registrar</button>
    </form>
    <button id="native" type="button" class="btn btn-primary" [disabled]="busy()">Nativo</button>
  `,
})
class Host {
  readonly busy = signal(false);
  pressed = 0;
  refused = 0;
  sent = 0;
}

describe('SoftDisabled', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  const find = (id: string): HTMLButtonElement => el.querySelector<HTMLButtonElement>(`#${id}`)!;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  function busy(on: boolean): void {
    fixture.componentInstance.busy.set(on);
    fixture.detectChanges();
  }

  // A focused button bound to [disabled] gave the focus away to nowhere the moment its action
  // started: the person was back at the top of the page, and nothing said so.
  it('keeps the focus on the button while it cannot be used, where `disabled` loses it', async () => {
    /** The browser puts the focus right after it draws the page again. */
    const drawn = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    find('save').focus();
    busy(true);
    await drawn();
    expect(document.activeElement).toBe(find('save'));

    busy(false);
    find('native').focus();
    expect(document.activeElement).toBe(find('native'));
    busy(true);
    await drawn();
    expect(document.activeElement).not.toBe(find('native'));
  });

  it('says it cannot be used, and is still in the order of the Tab key', () => {
    expect(find('save').hasAttribute('aria-disabled')).toBeFalse();
    busy(true);

    expect(find('save').getAttribute('aria-disabled')).toBe('true');
    expect(find('save').disabled).toBeFalse();
    expect(find('save').tabIndex).toBe(0);
  });

  it('does nothing when pressed meanwhile: not its click, not the submit of its form', () => {
    busy(true);
    find('save').click();
    find('send').click();
    fixture.detectChanges();
    expect(fixture.componentInstance.pressed).toBe(0);
    expect(fixture.componentInstance.sent).toBe(0);

    busy(false);
    find('save').click();
    find('send').click();
    expect(fixture.componentInstance.pressed).toBe(1);
    expect(fixture.componentInstance.sent).toBe(1);
  });

  // The trash of a catalog entry with cases did nothing when pressed: why was only in its title and its description.
  it('tells of each press it did nothing with, for a button that says why', () => {
    find('save').click();
    expect(fixture.componentInstance.refused).toBe(0);

    busy(true);
    find('save').click();
    find('save').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(fixture.componentInstance.refused).toBe(2);
    expect(fixture.componentInstance.pressed).toBe(1);
  });

  // The stylesheet of the app is on the test page.
  it('looks the same as a disabled button', () => {
    busy(true);
    const soft = getComputedStyle(find('save'));
    const native = getComputedStyle(find('native'));

    expect(soft.opacity).toBe('0.5');
    expect(soft.opacity).toBe(native.opacity);
    expect(soft.cursor).toBe(native.cursor);
  });
});
