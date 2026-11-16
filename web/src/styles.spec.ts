import { ChangeDetectionStrategy, Component } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { reduceMotion } from './app/testing/reduced-motion';
import { resizeScreen } from './app/testing/viewport';

/** A name of 200 letters and no space, as companies have been registered. */
const UNBROKEN = 'UnidadEducativaParticularJaguarDelValleDeLosChillosYSusAlrededores'.repeat(3);

/** What styles.css gives every screen: user text that breaks, the panels and dialogs on a short screen, the switches, the fields, the buttons of an icon, less motion. */
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- A column of the case list, and the one after it. -->
    <table id="table" class="w-72 table-fixed">
      <colgroup>
        <col class="w-34" />
        <col />
      </colgroup>
      <tbody>
        <tr>
          <td class="p-2 font-medium">{{ unbroken }}</td>
          <td class="p-2">Descripción</td>
        </tr>
      </tbody>
    </table>
    <!-- Two columns of the board, which share the width. -->
    <div id="columns" class="flex w-80 gap-3 overflow-x-auto">
      <section class="flex-1 p-2">{{ unbroken }}</section>
      <section class="flex-1 p-2">Corta</section>
    </div>

    <!-- A side panel: a header, a body that scrolls, a footer. -->
    <aside id="panel" class="overlay fixed inset-y-0 right-0 w-full max-w-xl">
      <header class="h-16 shrink-0">Caso</header>
      <div class="overlay-body p-4"><div class="h-[60rem]">Formulario</div></div>
      <footer class="h-16 shrink-0"><button type="button">Actualizar</button></footer>
    </aside>

    <label id="switch" class="flex items-center gap-2">
      <input type="checkbox" role="switch" class="sr-only" />
      <span class="toggle" aria-hidden="true"></span>
      Promesa de entrega
    </label>

    <!-- A file picker drawn as a button, a field, a placeholder of a select, a segmented control. -->
    <label id="picker" class="btn btn-soft">Adjuntar <input id="file" type="file" class="sr-only" /></label>
    <input id="field" class="input" placeholder="Buscar" />
    <input id="disabled-field" class="input" value="2" disabled />
    <div class="ng-select"><div class="ng-select-container"><div class="ng-value-container"><div id="placeholder" class="ng-placeholder">Todos</div></div></div></div>
    <button id="pressed" type="button" class="segment" aria-pressed="true">Todo</button>
    <button id="unpressed" type="button" class="segment" aria-pressed="false">Este mes</button>

    <!-- A field with a part that takes the focus of its own, as the button of the calendar of a date field does. -->
    <div id="composite" class="input"><button id="part" type="button">Calendario</button></div>

    <!-- Buttons that show only their icon: a bare one (the "×" of a notice) and one drawn as a button. -->
    <button id="icon-bare" type="button" class="btn-icon grid place-items-center" aria-label="Cerrar aviso"><span class="block size-3"></span></button>
    <button id="icon-button" type="button" class="btn btn-ghost btn-icon px-2" aria-label="Cerrar"><span class="block size-4"></span></button>

    <!--
      What changes place or colour: a box, the list of a select, a button. The list is placed in
      its style attribute: once an earlier spec has drawn a select, the library's own stylesheet
      (outside every layer, so above the classes) makes every .ng-dropdown-panel absolute, and
      where the list sits would depend on the order the specs run in.
    -->
    <div id="moving-mark"></div>
    <div id="moving" class="relative top-0">Caja</div>
    <div id="list-mark"></div>
    <div id="list" class="ng-dropdown-panel top-0" style="position: relative">Opciones</div>
    <button id="colored" type="button" class="btn btn-soft">Guardar</button>
  `,
})
class Host {
  readonly unbroken = UNBROKEN;
}

// Drawn for real, with the stylesheet of the app (the test page loads styles.css), on screens of the sizes the app is used on.
describe('styles.css', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;

  function create(): void {
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  }

  const find = (selector: string): HTMLElement => el.querySelector<HTMLElement>(selector)!;
  const rect = (selector: string): DOMRect => find(selector).getBoundingClientRect();

  // A company name with no spaces ran 743 px out of its column of the table, over four others.
  describe('a word longer than its box', () => {
    beforeEach(() => {
      resizeScreen(1280, 800);
      create();
    });

    it('breaks inside its cell of a table, off the cell that follows', () => {
      const [own, next] = Array.from(el.querySelectorAll<HTMLElement>('#table td'));

      expect(getComputedStyle(own).overflowWrap).toBe('anywhere');
      expect(own.scrollWidth).toBeLessThanOrEqual(own.clientWidth);
      expect(own.offsetWidth).toBe(136);
      expect(next.getBoundingClientRect().left).toBe(own.getBoundingClientRect().right);
    });

    // A flex item is as wide as its longest word unless the word may break: the board needed 4320 px.
    it('does not widen the column of a board it is in: the columns share the width', () => {
      const columns = find('#columns');
      const [long, short] = Array.from(columns.querySelectorAll('section'));

      expect(columns.scrollWidth).toBe(columns.clientWidth);
      expect(long.offsetWidth).toBe(short.offsetWidth);
    });
  });

  describe('a side panel or a dialog', () => {
    const footer = (): HTMLButtonElement => find('#panel footer button') as HTMLButtonElement;

    // On a laptop: the header and the footer stay in view, and the body scrolls between them.
    it('on a screen of usual height scrolls its body, with its footer always in view', () => {
      resizeScreen(1280, 800);
      create();
      const body = find('#panel .overlay-body');

      expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
      expect(find('#panel').scrollHeight).toBe(find('#panel').clientHeight);
      expect(footer().getBoundingClientRect().bottom).toBeLessThanOrEqual(800);
    });

    // At 400 % (320 × 200) the header and the footer left the body a strip of 32 px, under a field.
    it('on a short screen scrolls whole, and its footer is reached by scrolling to it', () => {
      resizeScreen(320, 200);
      create();
      const panel = find('#panel');

      expect(panel.scrollHeight).toBeGreaterThan(panel.clientHeight);
      expect(find('#panel .overlay-body').scrollHeight).toBe(find('#panel .overlay-body').clientHeight);
      expect(footer().getBoundingClientRect().top).toBeGreaterThan(200);

      footer().scrollIntoView();
      expect(footer().getBoundingClientRect().bottom).toBeLessThanOrEqual(200);
      expect(footer().getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    });

    // A phone on its side.
    it('is short on a phone held sideways too', () => {
      resizeScreen(740, 360);
      create();
      expect(find('#panel').scrollHeight).toBeGreaterThan(find('#panel').clientHeight);
    });
  });

  // The switch itself is 20 px high: the label around it is what is pressed (WCAG 2.5.8).
  it('makes the label of a switch at least 24 px high', () => {
    resizeScreen(390, 844);
    create();
    expect(rect('#switch').height).toBeGreaterThanOrEqual(24);
    expect(rect('#switch .toggle').height).toBe(20);
  });

  // Every colour of the app was measured against the surfaces it is drawn on, in both themes (WCAG
  // 1.4.3 and 1.4.11). The primary blue of a button was 4.2:1 with its white text, the red 3.9:1, the
  // amber 2.0:1 as text, a placeholder 3.1:1, the edge of a field 1.3:1.
  describe('the colours', () => {
    afterEach(() => document.documentElement.classList.remove('dark'));

    /** Relative luminance of `#rrggbb` or `rgb(r, g, b)`, as WCAG defines it. Written apart from the one of the type chips. */
    function luminance(color: string): number {
      const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color.trim());
      const rgb = /rgba?\((\d+), (\d+), (\d+)/.exec(color);
      const parts = hex ? hex.slice(1).map((part) => parseInt(part, 16)) : rgb!.slice(1).map(Number);
      const [r, g, b] = parts.map((part) => {
        const value = part / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    function contrast(one: string, other: string): number {
      const [dark, light] = [luminance(one), luminance(other)].sort((a, b) => a - b);
      return (light + 0.05) / (dark + 0.05);
    }
    const color = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const SURFACES = ['--app-page', '--app-surface', '--app-elevated'];

    for (const theme of ['light', 'dark']) {
      describe(`in the ${theme} theme`, () => {
        beforeEach(() => {
          document.documentElement.classList.toggle('dark', theme === 'dark');
          resizeScreen(1280, 800);
          create();
        });

        it('writes text in every colour of the app at 4.5:1 or more on the page, the surface and the elevated grey', () => {
          for (const text of ['--app-ink', '--app-muted', '--app-primary', '--app-success', '--app-warning', '--app-danger']) {
            for (const surface of SURFACES) expect(contrast(color(text), color(surface))).withContext(`${text} on ${surface}`).toBeGreaterThanOrEqual(4.5);
          }
        });

        it('writes white text at 4.5:1 or more on the fills (a primary button, the active menu entry, a badge), also under the pointer', () => {
          for (const fill of ['--app-primary-fill', '--app-primary-strong', '--app-danger-fill']) {
            expect(contrast(color(fill), '#ffffff')).withContext(fill).toBeGreaterThanOrEqual(4.5);
          }
        });

        it('draws the edge of a field, a select and a switch at 3:1 or more against what is around it', () => {
          for (const surface of SURFACES) expect(contrast(color('--app-control-line'), color(surface))).withContext(surface).toBeGreaterThanOrEqual(3);
          expect(getComputedStyle(find('#field')).borderTopColor).toBe(getComputedStyle(find('#switch .toggle')).backgroundColor);
          // The white knob of a switch against its track, off and on, and the track on against the card.
          expect(contrast(color('--app-control-line'), '#ffffff')).toBeGreaterThanOrEqual(3);
          expect(contrast(color('--app-primary-fill'), '#ffffff')).toBeGreaterThanOrEqual(3);
          expect(contrast(color('--app-primary-fill'), color('--app-surface'))).toBeGreaterThanOrEqual(3);
        });

        it('draws the charts at 3:1 or more against the card', () => {
          for (const chart of ['--chart-primary', '--chart-resolved', '--chart-pending', '--chart-unresolved', '--chart-neutral']) {
            expect(contrast(color(chart), color('--app-surface'))).withContext(chart).toBeGreaterThanOrEqual(3);
          }
        });

        // At 70 % of the muted colour they were 3.1:1 (light) and 3.7:1 (dark): an ng-select's placeholder is its value, "Todos".
        it('writes the placeholders in the muted colour, whole', () => {
          const muted = getComputedStyle(find('#placeholder')).color;
          expect(contrast(muted, color('--app-surface'))).toBeGreaterThanOrEqual(4.5);
          expect(getComputedStyle(find('#field'), '::placeholder').color).toBe(muted);
        });

        // A group of fields was dimmed to half instead (Configuración > Recordatorios): its label and its unit read at 2.1:1.
        it('draws a field that cannot be used as a select that cannot, its text readable', () => {
          const field = getComputedStyle(find('#disabled-field'));
          expect(contrast(field.backgroundColor, color('--app-elevated'))).toBeCloseTo(1, 5);
          expect(contrast(field.color, color('--app-muted'))).toBeCloseTo(1, 5);
          expect(contrast(field.color, field.backgroundColor)).toBeGreaterThanOrEqual(4.5);
          expect(field.cursor).toBe('not-allowed');
        });

        // Its background (1.1:1 from the others) and the colour of its text (2.4:1) told the selected option alone.
        it('marks the selected option of a segmented control with a line under it', () => {
          const pressed = getComputedStyle(find('#pressed'));
          expect(pressed.borderBottomWidth).toBe('2px');
          expect(pressed.borderBottomColor).not.toBe('rgba(0, 0, 0, 0)');
          expect(contrast(pressed.borderBottomColor, color('--app-surface'))).toBeGreaterThanOrEqual(3);
          expect(getComputedStyle(find('#unpressed')).borderBottomColor).toBe('rgba(0, 0, 0, 0)');
        });
      });
    }
  });

  // The focus was on a hidden input of 1 px, and its button showed nothing (WCAG 2.4.7). Placed against the panel,
  // the input made the focus scroll to where the button was not.
  describe('a file picker drawn as a button', () => {
    beforeEach(() => {
      resizeScreen(1280, 800);
      create();
    });

    it('shows the focus of its hidden input from the keyboard', () => {
      const before = getComputedStyle(find('#picker')).outlineStyle;
      find('#file').focus({ focusVisible: true } as FocusOptions);

      expect(find('#file').matches(':focus-visible')).toBeTrue();
      expect(before).toBe('none');
      expect(getComputedStyle(find('#picker')).outlineStyle).toBe('solid');
      expect(getComputedStyle(find('#picker')).outlineWidth).toBe('2px');
    });

    it('holds its hidden input, which is where it is', () => {
      expect(getComputedStyle(find('#picker')).position).toBe('relative');
      const picker = rect('#picker');
      const input = rect('#file');
      expect(input.top).toBeGreaterThanOrEqual(picker.top - 1);
      expect(input.bottom).toBeLessThanOrEqual(picker.bottom + 1);
    });
  });

  // A date or a time field takes the Tab key on the button of its calendar too, its last stop, where the
  // field is not `:focus`: only the thin ring of the browser showed there. A spec cannot reach that button,
  // so a part of a field that takes the focus of its own stands for it.
  it('draws the ring of a field with the focus while the focus is on a part of it', () => {
    resizeScreen(1280, 800);
    create();
    find('#field').focus();
    const ring = getComputedStyle(find('#field'));
    const [outline, border] = [`${ring.outlineStyle} ${ring.outlineWidth} ${ring.outlineColor}`, ring.borderTopColor];

    find('#part').focus();
    const field = getComputedStyle(find('#composite'));
    expect(find('#composite').matches(':focus')).toBeFalse();
    expect(`${field.outlineStyle} ${field.outlineWidth} ${field.outlineColor}`).toBe(outline);
    expect(outline).toMatch(/^solid 2px /);
    expect(field.borderTopColor).toBe(border);
  });

  // The 44 px of a phone were given button by button, and a new button with only its icon got none (WCAG 2.5.8).
  describe('a button that shows only its icon (.btn-icon)', () => {
    const SIDES = ['#icon-bare', '#icon-button'];

    for (const [width, least] of [
      [1280, 24],
      [768, 24],
      [767, 44],
      [390, 44],
      [320, 44],
    ]) {
      it(`is ${least} px a side or more on a screen ${width} px wide`, () => {
        resizeScreen(width, 800);
        create();
        for (const id of SIDES) {
          expect(rect(id).width).withContext(id).toBeGreaterThanOrEqual(least);
          expect(rect(id).height).withContext(id).toBeGreaterThanOrEqual(least);
        }
      });
    }

    // Away from a phone, where it is not pressed with a finger, it keeps the size its icon gives it.
    it('is no larger than 24 px from a tablet up when its icon is smaller', () => {
      resizeScreen(768, 800);
      create();
      expect(rect('#icon-bare').width).toBe(24);
      expect(rect('#icon-bare').height).toBe(24);
    });
  });

  // The rule for less motion gave every element a transition of 0.01 ms of all its properties, the first value of
  // `transition-property`: a change of place or of size took a frame, and the list of a select was still past the
  // right edge of a phone when the tap that opened it ended, which closed it.
  describe('with less motion asked for', () => {
    const animations = (selector: string): Animation[] => find(selector).getAnimations({ subtree: true });

    /** Moves the box, the list and the knob of the switch, and turns the button into another colour. */
    function change(): void {
      for (const id of ['#moving', '#list']) {
        void getComputedStyle(find(id)).top;
        find(id).classList.replace('top-0', 'top-10');
      }
      find('#colored').classList.replace('btn-soft', 'btn-primary');
      (find('#switch input') as HTMLInputElement).checked = true;
    }

    beforeEach(() => {
      resizeScreen(1280, 800);
      create();
    });

    it('moves nothing and fades nothing: what changes is drawn at once where and as it ends', () => {
      reduceMotion();
      // Measured from a mark just before each: what the page draws above them (the styles of the
      // components earlier specs drew stay on the page) may move them both, and that is not theirs.
      const from = (id: string): number => rect(id).top - rect(`${id}-mark`).top;
      const [box, list] = [from('#moving'), from('#list')];
      change();
      for (const id of ['#moving', '#list', '#colored', '#switch']) expect(animations(id)).withContext(id).toEqual([]);
      expect(from('#moving')).toBe(box + 40);
      expect(from('#list')).toBe(list + 40);
    });

    it('gives every element no transition at all, not a short one', () => {
      reduceMotion();
      for (const id of ['#moving', '#list', '#colored', '#switch .toggle']) {
        const style = getComputedStyle(find(id));
        expect(`${style.transitionProperty} ${style.transitionDuration}`).withContext(id).toBe('none 0s');
      }
      expect(getComputedStyle(find('#switch .toggle'), '::after').transitionProperty).toBe('none');
    });

    // What the test above looks at: without the wish, the button fades into its new colour and the knob slides.
    it('is a wish: without it, a button still fades into its colour', () => {
      change();
      expect(animations('#colored').length).toBeGreaterThan(0);
      expect(animations('#switch').length).toBeGreaterThan(0);
    });
  });
});
