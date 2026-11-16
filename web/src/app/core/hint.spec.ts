import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { textOf } from '../testing/text';
import { resizeScreen } from '../testing/viewport';
import { BackdropClick } from './backdrop-click';
import { Hint } from './hint';

/**
 * A label with its "?", its field pointing at the text, as the forms have them; and a header of a
 * table in a box that scrolls, as the case list has it. Escapes that reach the screen are counted:
 * the panel or the dialog around a "?" closes on one.
 */
@Component({
  imports: [Hint],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'escapes = escapes + 1' },
  template: `
    <!-- At the top of the screen, wherever the test page puts the component: what is measured is against the screen. -->
    <div class="fixed top-0 left-0 w-72 bg-surface p-4">
      <div class="label flex items-center gap-1">
        <label for="date">Fecha del caso</label>
        <app-hint textId="date-hint" about="Fecha del caso" text="Día en que el cliente reportó el problema" />
      </div>
      <input id="date" class="input" type="date" aria-describedby="date-hint" />
      <button type="button" id="elsewhere">Otro botón</button>
    </div>
    <div id="table-box" class="fixed top-40 left-0 h-24 w-48 overflow-auto bg-surface">
      <table class="w-96">
        <thead class="bg-primary-fill text-xs text-white">
          <tr>
            <th>Código</th>
            <th aria-label="Registro" aria-describedby="column-hint">Registro <app-hint textId="column-hint" about="Registro" [text]="columnHint()" /></th>
          </tr>
        </thead>
        <tbody>
          @for (row of rows; track row) {
            <tr class="h-8"><td>{{ row }}</td><td>2</td></tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
class Host {
  readonly columnHint = signal('Día en que se registró el ticket en este sistema. Automática');
  readonly rows = [1, 2, 3, 4, 5, 6];
  escapes = 0;
}

// The meaning of a label was only in its title: shown under a mouse that stays on it, never to a keyboard or a finger.
describe('Hint, the "?" beside a label', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  beforeEach(async () => {
    resizeScreen(360, 640);
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    // In the page: the text is placed against the screen.
    document.body.appendChild(el);
    await render();
  });

  afterEach(() => {
    el.remove();
    window.scrollTo(0, 0);
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (id = 'date-hint'): HTMLButtonElement => el.querySelector<HTMLElement>(`#${id}`)!.parentElement!.querySelector('button')!;
  const text = (id = 'date-hint'): HTMLElement => el.querySelector<HTMLElement>(`#${id}`)!;
  const shown = (id = 'date-hint'): boolean => !text(id).hidden && text(id).getBoundingClientRect().height > 0;

  function key(target: HTMLElement, name: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  it('is a button named for its label, that says it is collapsed and is described by its text', () => {
    expect(button().getAttribute('aria-label')).toBe('Ayuda sobre Fecha del caso');
    expect(button().getAttribute('aria-expanded')).toBe('false');
    expect(button().getAttribute('aria-describedby')).toBe('date-hint');
    expect(textOf(text())).toBe('Día en que el cliente reportó el problema');
    expect(shown()).toBeFalse();
  });

  it('is the description of the field too, without being part of the name of its label', () => {
    const field = el.querySelector<HTMLInputElement>('#date')!;

    expect(document.getElementById(field.getAttribute('aria-describedby')!)).toBe(text());
    expect(textOf(field.labels![0])).toBe('Fecha del caso');
  });

  it('shows its text when pressed, and hides it on the next press', async () => {
    button().click();
    await render();

    expect(shown()).toBeTrue();
    expect(button().getAttribute('aria-expanded')).toBe('true');

    button().click();
    await render();

    expect(shown()).toBeFalse();
    expect(button().getAttribute('aria-expanded')).toBe('false');
  });

  // Enter and Space press a native button: the click above. Escape is the key of its own.
  it('hides its text with Escape, which goes no further, and keeps the focus', async () => {
    button().focus();
    button().click();
    await render();

    const event = key(button(), 'Escape');
    await render();

    expect(shown()).toBeFalse();
    expect(event.defaultPrevented).toBeTrue();
    expect(fixture.componentInstance.escapes).toBe(0);
    expect(document.activeElement).toBe(button());
  });

  it('leaves Escape to the screen around it while its text is hidden', async () => {
    key(button(), 'Escape');
    await render();

    expect(fixture.componentInstance.escapes).toBe(1);
  });

  it('hides its text when something else is pressed, or the focus goes elsewhere', async () => {
    button().click();
    await render();
    el.querySelector('#elsewhere')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    await render();
    expect(shown()).toBeFalse();

    button().focus();
    button().click();
    await render();
    expect(shown()).toBeTrue();
    el.querySelector<HTMLElement>('#elsewhere')!.focus();
    await render();
    expect(shown()).toBeFalse();
  });

  // A browser takes the focus off the "?" on a press on text that cannot take it, unless the press
  // is cancelled: the "?" losing it hid the text the person was pressing on.
  it('keeps its text when the press is on the text itself, and the focus on its "?"', async () => {
    button().focus();
    button().click();
    await render();
    text().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    text().dispatchEvent(press);
    await render();

    expect(press.defaultPrevented).toBeTrue();
    expect(document.activeElement).toBe(button());
    expect(shown()).toBeTrue();
  });

  it('shows its text under the "?", inside the screen', async () => {
    button().click();
    await render();

    const anchor = button().getBoundingClientRect();
    const box = text().getBoundingClientRect();
    expect(box.top).toBeGreaterThanOrEqual(anchor.bottom);
    expect(box.left).toBeGreaterThanOrEqual(0);
    expect(box.right).toBeLessThanOrEqual(360);
    expect(getComputedStyle(text()).whiteSpace).toBe('normal');
  });

  // 24 px a side (WCAG 2.5.8), and the line of the label as high as its text.
  it('is a target of 24 px a side, in a line no higher than the label', () => {
    const box = button().getBoundingClientRect();
    const line = el.querySelector<HTMLElement>('.label')!;

    expect(box.width).toBeGreaterThanOrEqual(24);
    expect(box.height).toBeGreaterThanOrEqual(24);
    expect(line.offsetHeight).toBeLessThanOrEqual(parseFloat(getComputedStyle(line).lineHeight) + 0.5);
  });

  describe('in the header of a table that scrolls', () => {
    it('is not cut by the box of the table, and follows its "?" when the box scrolls', async () => {
      const box = el.querySelector<HTMLElement>('#table-box')!;
      box.scrollLeft = 40;
      button('column-hint').click();
      await render();

      const area = box.getBoundingClientRect();
      const shownBox = text('column-hint').getBoundingClientRect();
      // Wider than the box, and below its edge: whole all the same.
      expect(shownBox.width).toBeGreaterThan(80);
      expect(document.elementFromPoint(shownBox.left + 4, shownBox.bottom - 4)).toBe(text('column-hint'));
      expect(shownBox.bottom).toBeGreaterThan(area.top);

      // The box scrolled down: the "?" goes up with the header, and its text with it.
      const before = text('column-hint').getBoundingClientRect().top;
      const anchorBefore = button('column-hint').getBoundingClientRect().top;
      box.scrollTop = 20;
      box.dispatchEvent(new Event('scroll'));
      await render();
      const moved = anchorBefore - button('column-hint').getBoundingClientRect().top;
      expect(moved).toBeGreaterThan(10);
      expect(before - text('column-hint').getBoundingClientRect().top).toBeCloseTo(moved, 0);
    });

    it('reads in the ink of the app, not in the white of the header', async () => {
      button('column-hint').click();
      await render();

      expect(getComputedStyle(text('column-hint')).color).not.toBe('rgb(255, 255, 255)');
      expect(getComputedStyle(text('column-hint')).fontWeight).toBe('400');
    });
  });
});

/** A "?" in a dialog that a click on its backdrop closes, as the dialog of a case with AI and the import dialog are. */
@Component({
  imports: [Hint, BackdropClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="modal-backdrop" (appBackdropClick)="closed = closed + 1">
      <div class="card p-4" role="dialog" aria-modal="true" aria-label="Nuevo caso con IA">
        <app-hint textId="promise-hint" about="Promesa de entrega" text="Día en que se le promete al cliente tener el caso resuelto" />
        <button type="button" id="inside">Guardar</button>
      </div>
    </div>
  `,
})
class InDialog {
  closed = 0;
}

// A tap outside an open "?" that landed on the backdrop of its dialog closed the dialog too, with what the person had filled in it.
describe('Hint, in a dialog that its backdrop closes', () => {
  let fixture: ComponentFixture<InDialog>;
  let el: HTMLElement;

  beforeEach(async () => {
    fixture = TestBed.createComponent(InDialog);
    el = fixture.nativeElement as HTMLElement;
    await render();
  });

  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const backdrop = (): HTMLElement => el.querySelector<HTMLElement>('.modal-backdrop')!;
  const shown = (): boolean => !el.querySelector<HTMLElement>('#promise-hint')!.hidden;

  /** A press on `target` as a finger or a mouse makes it: the press, and the click it ends with. */
  function tap(target: HTMLElement): void {
    target.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  }

  it('only hides its text when the press is on the backdrop; the next press there closes the dialog', async () => {
    el.querySelector<HTMLButtonElement>('app-hint button')!.click();
    await render();
    expect(shown()).toBeTrue();

    tap(backdrop());
    await render();
    expect(shown()).toBeFalse();
    expect(fixture.componentInstance.closed).toBe(0);

    tap(backdrop());
    await render();
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('lets the click on a backdrop go on with its text hidden, and after a press elsewhere', async () => {
    tap(backdrop());
    expect(fixture.componentInstance.closed).toBe(1);

    el.querySelector<HTMLButtonElement>('app-hint button')!.click();
    await render();
    // A press on the backdrop that ends in no click there, and a click with no press (Enter on a button): the next click on the backdrop is the person's own.
    backdrop().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    el.querySelector<HTMLElement>('#inside')!.click();
    await render();
    tap(backdrop());
    expect(fixture.componentInstance.closed).toBe(2);
  });
});

describe('Hint, with its text between its tags', () => {
  @Component({
    imports: [Hint],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<app-hint textId="legend" about="Indicadores"><span class="block">Vencido: pasó su fecha límite.</span></app-hint>`,
  })
  class Legend {}

  it('shows what is between its tags as its text, the description of its "?"', () => {
    const fixture = TestBed.createComponent(Legend);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;

    expect(el.querySelector('button')!.getAttribute('aria-describedby')).toBe('legend');
    expect(textOf(el.querySelector<HTMLElement>('#legend')!)).toBe('Vencido: pasó su fecha límite.');
  });
});
