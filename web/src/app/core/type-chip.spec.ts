import { Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { TypeChip, readableOn } from './type-chip';

/** The chip inside something that listens for the press of the mouse and for the keys, as a select does. */
@Component({
  imports: [TypeChip],
  template: `
    <div (mousedown)="presses = presses + 1" (keydown)="keys.push($event.key)">
      <app-type-chip [type]="type()" [removable]="removable()" (removed)="removals = removals + 1" />
    </div>
  `,
})
class Host {
  readonly type = signal({ name: 'Falla del sistema', color: '#b91c1c' });
  readonly removable = signal(false);
  removals = 0;
  presses = 0;
  /** The keys that reached what the chip is in. */
  readonly keys: string[] = [];
}

/** The chip in places narrower than a long name: a column of the table, a select, a column of the board. */
@Component({
  imports: [TypeChip],
  template: `
    <div id="cell" class="w-28">
      <div class="flex flex-wrap gap-1">
        <app-type-chip [type]="long" />
        <app-type-chip [type]="short" />
      </div>
    </div>
    <!-- The column "Tipos de soporte" of the case list, with the one that follows it. -->
    <table id="table" class="w-64 table-fixed">
      <colgroup>
        <col class="w-32" />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <td class="p-2">
            <div class="flex flex-wrap gap-1"><app-type-chip [type]="long" /></div>
          </td>
          <td class="p-2">Se llamó al cliente</td>
        </tr>
      </tbody>
    </table>
    <div id="chosen" class="w-28"><app-type-chip [type]="long" removable /></div>
    <div id="columns" class="flex w-64">
      <section class="flex-1"><app-type-chip [type]="long" /></section>
      <section class="flex-1"></section>
    </div>
  `,
})
class NarrowHost {
  readonly long = { name: 'El usuario no sabía cómo usar la funcionalidad del sistema', color: '#1e3a8a' };
  readonly short = { name: 'Capacitación', color: '#12b76a' };
}

/** Relative luminance of an `rgb(r, g, b)` colour as the browser reports it. Written apart from the one the chip uses. */
function luminanceOf(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+/g)!.map((part) => {
    const value = Number(part) / 255;
    return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contrast between two colours, from 1 (the same) to 21 (black on white). */
function contrast(one: string, other: string): number {
  const [dark, light] = [luminanceOf(one), luminanceOf(other)].sort((a, b) => a - b);
  return (light + 0.05) / (dark + 0.05);
}

// The colour of a support type is whatever the team picks. The chip has to stay readable on all of them.
describe('TypeChip, a support type in its own colour', () => {
  let fixture: ComponentFixture<Host>;
  let chip: HTMLElement;

  beforeEach(() => {
    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    chip = (fixture.nativeElement as HTMLElement).querySelector('app-type-chip')!;
  });

  function show(color: string): CSSStyleDeclaration {
    fixture.componentInstance.type.set({ name: 'Falla del sistema', color });
    fixture.detectChanges();
    return getComputedStyle(chip);
  }

  it('writes the name of the type on its colour, and nothing else', () => {
    expect(chip.textContent?.trim()).toBe('Falla del sistema');
    expect(getComputedStyle(chip).backgroundColor).toBe('rgb(185, 28, 28)');
    expect(chip.querySelector('button')).toBeNull();
  });

  it('writes in white on a dark colour and in black on a light one', () => {
    expect(show('#1e3a8a').color).toBe('rgb(255, 255, 255)');
    expect(show('#000000').color).toBe('rgb(255, 255, 255)');
    expect(show('#fde68a').color).toBe('rgb(0, 0, 0)');
    expect(show('#ffffff').color).toBe('rgb(0, 0, 0)');
  });

  // 4.5 to 1 is what small text needs (WCAG AA). Every sixth of each channel: 343 colours, with
  // the greys, the pure colours and the ones in the middle, where neither black nor white is far.
  it('can be read on any colour', () => {
    const steps = ['00', '2a', '55', '80', 'aa', 'd5', 'ff'];
    const hard: string[] = [];
    for (const r of steps) {
      for (const g of steps) {
        for (const b of steps) {
          const style = show(`#${r}${g}${b}`);
          if (contrast(style.color, style.backgroundColor) < 4.5) hard.push(`#${r}${g}${b}`);
        }
      }
    }
    expect(hard).toEqual([]);
  });

  // The colours of the app itself sit right where the text colour switches.
  it('can be read on the colours of the app and on the grey new types start with', () => {
    for (const color of ['#0c7beb', '#12b76a', '#f5a524', '#e5484d', '#64748b']) {
      const style = show(color);
      expect(contrast(style.color, style.backgroundColor)).withContext(color).toBeGreaterThanOrEqual(4.5);
    }
  });

  // In a select of several types, each chosen one is a chip that can be taken out.
  describe('that can be removed', () => {
    let remove: HTMLButtonElement;

    beforeEach(() => {
      fixture.componentInstance.removable.set(true);
      fixture.detectChanges();
      remove = chip.querySelector('button')!;
    });

    it('has a "×" named after the type, in the text colour of the chip', () => {
      expect(remove.textContent).toBe('×');
      expect(remove.getAttribute('aria-label')).toBe('Quitar Falla del sistema');
      show('#1e3a8a');
      expect(getComputedStyle(remove).color).toBe('rgb(255, 255, 255)');
      show('#fde68a');
      expect(getComputedStyle(remove).color).toBe('rgb(0, 0, 0)');
    });

    it('asks to be taken out when its "×" is pressed', () => {
      remove.click();
      expect(fixture.componentInstance.removals).toBe(1);
    });

    // A select opens its list when it is pressed anywhere: not when the press was to take a chip out.
    it('keeps the press on its "×" from what the chip is in', () => {
      remove.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(fixture.componentInstance.presses).toBe(0);

      chip.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      expect(fixture.componentInstance.presses).toBe(1);
    });

    // Enter and Space press the "×", as they press any button. A select would take them first,
    // to open its list or to choose the option marked in it, and the chip would stay.
    it('keeps Enter and Space on its "×" from what the chip is in, and leaves them to the browser', () => {
      for (const key of ['Enter', ' ', 'Tab', 'Escape', 'ArrowDown']) {
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
        remove.dispatchEvent(event);
        expect(event.defaultPrevented).withContext(`"${key}"`).toBeFalse();
      }
      expect(fixture.componentInstance.keys).toEqual(['Tab', 'Escape', 'ArrowDown']);
    });
  });

  // A name can be 60 letters long, and a column of the table has room for some twenty.
  describe('where there is less room than its name takes', () => {
    let narrow: HTMLElement;

    beforeEach(() => {
      const narrowFixture = TestBed.createComponent(NarrowHost);
      narrow = narrowFixture.nativeElement as HTMLElement;
      // In the page: the chips are measured.
      document.body.appendChild(narrow);
      narrowFixture.detectChanges();
    });

    afterEach(() => narrow.remove());

    const chips = (within: string): HTMLElement[] => [...narrow.querySelectorAll<HTMLElement>(`#${within} app-type-chip`)];
    const right = (element: Element): number => element.getBoundingClientRect().right;
    const nameOf = (chip: HTMLElement): HTMLElement => chip.querySelector('span')!;
    const shortened = (chip: HTMLElement): boolean => nameOf(chip).scrollWidth > nameOf(chip).clientWidth;

    it('stays inside it: the name is shortened with an ellipsis, and the whole of it is the title', () => {
      const [long] = chips('cell');

      expect(right(long)).toBeLessThanOrEqual(right(narrow.querySelector('#cell')!));
      expect(shortened(long)).toBeTrue();
      expect(getComputedStyle(nameOf(long)).textOverflow).toBe('ellipsis');
      expect(long.title).toBe('El usuario no sabía cómo usar la funcionalidad del sistema');
    });

    // As seen in the case list: the chip of a long type was drawn over the next column.
    it('stays inside its column of a table, and off the column that follows', () => {
      const [long] = chips('table');
      const [own, next] = [...narrow.querySelectorAll<HTMLElement>('#table td')];

      expect(own.offsetWidth).toBe(128);
      expect(right(long)).toBeLessThanOrEqual(next.getBoundingClientRect().left - 8);
      expect(shortened(long)).toBeTrue();
    });

    it('is still only as wide as its name when the name fits', () => {
      const [, short] = chips('cell');

      expect(shortened(short)).toBeFalse();
      expect(short.offsetWidth).toBeLessThan(narrow.querySelector<HTMLElement>('#cell')!.offsetWidth);
      expect(short.title).toBe('Capacitación');
    });

    it('keeps its "×" in view next to the shortened name', () => {
      const [long] = chips('chosen');
      const remove = long.querySelector('button')!;

      expect(shortened(long)).toBeTrue();
      expect(remove.offsetWidth).toBeGreaterThan(0);
      expect(right(remove)).toBeLessThanOrEqual(right(narrow.querySelector('#chosen')!));
    });

    // The columns of the board share the screen: a long type on a card must not take from the others.
    it('does not widen what it is in to make room for its name', () => {
      const [first, second] = [...narrow.querySelectorAll<HTMLElement>('#columns section')];

      expect(first.offsetWidth).toBe(second.offsetWidth);
      expect(right(chips('columns')[0])).toBeLessThanOrEqual(right(first));
    });
  });

  it('takes a colour in capitals too', () => {
    expect(readableOn('#FDE68A')).toBe('#000000');
  });

  // The server only stores whole colours; anything else leaves the text as it was.
  it('does not guess a text colour for something that is not a colour', () => {
    expect(readableOn('rojo')).toBeNull();
    expect(readableOn('#abc')).toBeNull();
    expect(readableOn('')).toBeNull();
  });
});
