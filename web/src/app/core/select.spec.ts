import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { chooseOption, clearSelect, closeSelect, ngSelect, openSelect, optionTexts, removeChosen, selectedTexts, typeInSelect } from '../testing/ng-select';
import { textOf } from '../testing/text';
import { resizeScreen } from '../testing/viewport';
import { BackdropClick } from './backdrop-click';
import { SELECT } from './select';
import { TypeChip } from './type-chip';

/** A form with the kinds of select the app has, next to a plain text field. */
@Component({
  imports: [FormsModule, ...SELECT, TypeChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:keydown.escape)': 'escapes = escapes + 1' },
  template: `
    <div class="w-80">
      <input class="input" aria-label="Descripción" />

      <label class="label" for="company">Empresa</label>
      <ng-select labelForId="company" placeholder="Elige una empresa" bindValue="id" bindLabel="name" [items]="companies" [(ngModel)]="company" />

      <ng-select ariaLabel="Tipos de soporte" bindValue="id" bindLabel="name" appendTo="body" [items]="types" [multiple]="true" [(ngModel)]="chosenTypes" />

      <ng-select ariaLabel="Unidad" bindValue="id" bindLabel="label" [items]="units" [clearable]="false" [searchable]="false" [(ngModel)]="unit" />

      <ng-select ariaLabel="Tipos en su color" bindLabel="name" [items]="types" [multiple]="true" [(ngModel)]="colored">
        <ng-template ng-label-tmp let-item="item" let-clear="clear">
          <app-type-chip [type]="item" removable (removed)="clear(item)" />
        </ng-template>
      </ng-select>
    </div>
  `,
})
class Host {
  readonly companies = [
    { id: 1, name: 'Acme' },
    { id: 2, name: 'Bodega Sur' },
    { id: 3, name: 'Ferretería El Tornillo' },
  ];
  readonly types = [
    { id: 1, name: 'Capacitación', color: '#12b76a' },
    { id: 2, name: 'Falla del sistema', color: '#b91c1c' },
  ];
  readonly units = [
    { id: 'hours', label: 'horas' },
    { id: 'days', label: 'días' },
  ];
  readonly company = signal<number | null>(null);
  readonly chosenTypes = signal<number[]>([]);
  readonly unit = signal('days');
  readonly colored = signal<{ id: number; name: string; color: string }[]>([]);
  /** Times the screen around the selects heard Escape. */
  escapes = 0;
}

// Drawn for real, with the stylesheet of the app (the test page loads styles.css).
describe('ng-select in the app', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let host: Host;

  beforeEach(fakeAsync(() => {
    document.documentElement.classList.remove('dark');
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement as HTMLElement;
    // In the page: the selects are measured, and a list hung from the body is placed against its select.
    document.body.appendChild(el);
    host = fixture.componentInstance;
    render();
  }));

  afterEach(() => {
    el.remove();
    document.documentElement.classList.remove('dark');
  });

  /** A screen update as the browser runs it: ngModel writes a value into its control right after. */
  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  const company = (): HTMLElement => ngSelect(el, 'company');
  const types = (): HTMLElement => ngSelect(el, 'Tipos de soporte');
  const unit = (): HTMLElement => ngSelect(el, 'Unidad');
  const colored = (): HTMLElement => ngSelect(el, 'Tipos en su color');

  describe('looks like the text fields of the app', () => {
    const box = (select: HTMLElement): HTMLElement => select.querySelector<HTMLElement>('.ng-select-container')!;
    const field = (): HTMLInputElement => el.querySelector<HTMLInputElement>('input.input')!;

    for (const theme of ['light', 'dark']) {
      it(`in the ${theme} theme: same height, border, corners, background and text`, fakeAsync(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        // With a value, and without the focus a person choosing it would leave on the select.
        host.company.set(1);
        render();

        const select = getComputedStyle(box(company()));
        const input = getComputedStyle(field());
        expect(box(company()).offsetHeight).toBe(field().offsetHeight);
        expect(box(unit()).offsetHeight).toBe(field().offsetHeight);
        for (const property of ['borderTopColor', 'borderTopWidth', 'borderTopLeftRadius', 'backgroundColor', 'color', 'fontSize'] as const) {
          expect(select[property]).withContext(property).toBe(input[property]);
        }
      }));

      it(`in the ${theme} theme: its list is drawn on the surface of the app, also when it hangs from the body`, fakeAsync(() => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const surface = getComputedStyle(field()).backgroundColor;

        for (const select of [company(), types()]) {
          openSelect(select);
          render();
          // What is drawn is the box of the options: the list around it is a transparent frame.
          const panel = document.querySelector<HTMLElement>('.ng-dropdown-panel .ng-dropdown-panel-items')!;
          expect(getComputedStyle(panel).backgroundColor).toBe(surface);
          expect(getComputedStyle(panel).borderTopColor).toBe(getComputedStyle(field()).borderTopColor);
          closeSelect(select);
          render();
        }
      }));
    }

    it('with the focus, has the border of a text field with the focus', fakeAsync(() => {
      field().focus();
      const focused = getComputedStyle(field()).borderTopColor;

      openSelect(company());
      render();
      expect(getComputedStyle(box(company())).borderTopColor).toBe(focused);
      closeSelect(company());
    }));

    // Above the dialogs (50) and below the toasts (100), wherever the list hangs from.
    it('opens its list over the dialogs of the app and under the toasts', fakeAsync(() => {
      openSelect(types());
      render();
      expect(getComputedStyle(document.querySelector('.ng-dropdown-panel')!).zIndex).toBe('60');
      closeSelect(types());
    }));
  });

  describe('speaks Spanish', () => {
    it('says "Sin resultados" when nothing matches what was typed', fakeAsync(() => {
      typeInSelect(company(), 'zzz');
      render();

      expect(optionTexts(company())).toEqual(['Sin resultados']);
      closeSelect(company());
    }));

    it('names its "×" as "Quitar"', fakeAsync(() => {
      chooseOption(company(), 'Acme');
      render();

      expect(company().querySelector('.ng-clear-wrapper')!.getAttribute('title')).toBe('Quitar');
    }));
  });

  // What specs do with a select, each as a person does it.
  describe('handled through the page, as the specs do', () => {
    it('is found by the id its label points at, or by its accessible name', fakeAsync(() => {
      expect(company().querySelector('input')!.id).toBe('company');
      expect(el.querySelector('label[for=company]')!.textContent).toBe('Empresa');
      expect(types().querySelector('input')!.getAttribute('aria-label')).toBe('Tipos de soporte');
      expect(() => ngSelect(el, 'Prioridad')).toThrowError('No ng-select named "Prioridad" on screen');
    }));

    it('shows nothing chosen, then the option chosen, which the form gets', fakeAsync(() => {
      expect(selectedTexts(company())).toEqual([]);
      expect(optionTexts(company())).toEqual(['Acme', 'Bodega Sur', 'Ferretería El Tornillo']);

      chooseOption(company(), 'Bodega Sur');
      render();
      expect(selectedTexts(company())).toEqual(['Bodega Sur']);
      expect(host.company()).toBe(2);
    }));

    it('shows the value the form already has', fakeAsync(() => {
      expect(selectedTexts(unit())).toEqual(['días']);

      host.company.set(3);
      render();
      expect(selectedTexts(company())).toEqual(['Ferretería El Tornillo']);
    }));

    it('narrows its options to what is typed, accents aside', fakeAsync(() => {
      typeInSelect(company(), 'ferreteria');
      render();
      expect(optionTexts(company())).toEqual(['Ferretería El Tornillo']);

      chooseOption(company(), 'Ferretería El Tornillo');
      render();
      expect(host.company()).toBe(3);
    }));

    it('is emptied with its "×", which leaves the form with no value', fakeAsync(() => {
      chooseOption(company(), 'Acme');
      render();
      clearSelect(company());
      render();

      expect(selectedTexts(company())).toEqual([]);
      expect(host.company()).toBeNull();
    }));

    it('says so when asked for an option it does not offer, or to clear what cannot be cleared', fakeAsync(() => {
      expect(() => chooseOption(company(), 'Zeta')).toThrowError('The select does not offer "Zeta". It offers: Acme, Bodega Sur, Ferretería El Tornillo');
      closeSelect(company());
      // "Unidad" always has a value.
      expect(() => clearSelect(unit())).toThrowError('The select has nothing to clear, or cannot be cleared');
    }));

    it('takes several values when it is multiple, each one a chip that can be taken out', fakeAsync(() => {
      chooseOption(types(), 'Falla del sistema');
      render();
      chooseOption(types(), 'Capacitación');
      render();
      expect(selectedTexts(types())).toEqual(['Falla del sistema', 'Capacitación']);
      expect(host.chosenTypes()).toEqual([2, 1]);

      removeChosen(types(), 'Falla del sistema');
      render();
      expect(selectedTexts(types())).toEqual(['Capacitación']);
      expect(host.chosenTypes()).toEqual([1]);
      closeSelect(types());
    }));

    // A support type is chosen as a chip of its own colour, which a template of the screen draws.
    it('reads and takes out the chips a template draws, each by its text', fakeAsync(() => {
      chooseOption(colored(), 'Falla del sistema');
      render();
      chooseOption(colored(), 'Capacitación');
      render();
      expect(selectedTexts(colored())).toEqual(['Falla del sistema', 'Capacitación']);

      // The chip brings its colour: the select does not put it inside a grey chip of its own.
      const chosen = colored().querySelector<HTMLElement>('.ng-value')!;
      expect(getComputedStyle(chosen).backgroundColor).toBe('rgba(0, 0, 0, 0)');
      expect(getComputedStyle(chosen.querySelector('app-type-chip')!).backgroundColor).toBe('rgb(185, 28, 28)');

      // The press on the "×" of a chip is to take it out: the list stays closed.
      chosen.querySelector('button')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      render();
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();

      removeChosen(colored(), 'Falla del sistema');
      render();
      expect(selectedTexts(colored())).toEqual(['Capacitación']);
      expect(host.colored().map((type) => type.name)).toEqual(['Capacitación']);
    }));
  });

  // The "×" of a chip is a button, and Tab stops on it. Enter and Space press a button.
  describe('with the keyboard on the "×" of a chosen chip', () => {
    const remove = (): HTMLButtonElement => colored().querySelector<HTMLButtonElement>('.ng-value button')!;

    /** The key goes down on the "×". The browser then presses the button, unless somebody took the key. */
    function press(key: string): void {
      const button = remove();
      button.focus();
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      button.dispatchEvent(event);
      if (!event.defaultPrevented) button.click();
      render();
    }

    beforeEach(fakeAsync(() => {
      chooseOption(colored(), 'Falla del sistema');
      render();
    }));

    for (const [key, name] of [
      ['Enter', 'Enter'],
      [' ', 'Space'],
    ]) {
      it(`${name} takes the chip out, and the list of the select stays closed`, fakeAsync(() => {
        press(key);

        expect(selectedTexts(colored())).toEqual([]);
        expect(host.colored()).toEqual([]);
        expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
      }));
    }

    // With its list open a select takes Enter for the option marked in the list, here the one the pointer is on.
    it('Enter takes that chip out with the list open, and leaves the option marked in the list alone', fakeAsync(() => {
      openSelect(colored());
      render();
      const other = [...document.querySelectorAll<HTMLElement>('.ng-dropdown-panel .ng-option')].find((option) => option.textContent?.trim() === 'Capacitación')!;
      other.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      render();
      expect(other.classList).toContain('ng-option-marked');
      press('Enter');

      expect(host.colored()).toEqual([]);
      closeSelect(colored());
    }));
  });

  // The box pointed at the frame around the list, which has no role: axe took the list of options,
  // which scrolls, for a box the keyboard could not reach (scrollable-region-focusable).
  it('ties the box the person types in to its open list of options, the listbox itself', fakeAsync(() => {
    openSelect(company());
    render();
    tick();
    const listbox = document.querySelector<HTMLElement>('.ng-dropdown-panel [role=listbox]')!;
    const box = company().querySelector<HTMLInputElement>('input[role=combobox]')!;

    expect(listbox.id).not.toBe('');
    expect(box.getAttribute('aria-controls')).toBe(listbox.id);
    expect(box.getAttribute('aria-activedescendant')?.startsWith(document.querySelector('.ng-dropdown-panel')!.id)).toBeTrue();
    closeSelect(company());
  }));

  // What the page scrolls takes the select with it, and a list hung from the body stays behind.
  it('closes its open list when the page scrolls', fakeAsync(() => {
    scrollThePage(() => {
      openSelect(types());
      render();
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

      window.scrollTo(0, 60);
      expect(window.scrollY).toBe(60);
      document.dispatchEvent(new Event('scroll'));
      render();
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    });
  }));

  // The panel and the dialogs of the app close with Escape, which they hear on the document.
  describe('Escape', () => {
    function press(select: HTMLElement): KeyboardEvent {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
      select.querySelector('input')!.dispatchEvent(event);
      render();
      return event;
    }

    it('closes the open list, and the screen around the select does not hear it', fakeAsync(() => {
      openSelect(company());
      render();
      expect(document.querySelector('.ng-dropdown-panel')).not.toBeNull();

      press(company());
      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
      expect(host.escapes).toBe(0);
    }));

    it('with the list closed, is for the screen around the select', fakeAsync(() => {
      press(company());
      expect(host.escapes).toBe(1);
    }));

    // The key is heard by a listener of its own, outside any template, and the app has no zone
    // to tell Angular of it: the list on screen closes because ng-select keeps it in a signal.
    it('closes the open list on screen by itself, with nobody checking the screen', fakeAsync(() => {
      openSelect(company());
      render();

      company().querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      tick();

      expect(document.querySelector('.ng-dropdown-panel')).toBeNull();
    }));
  });
});

/** A select in a dialog that scrolls and that a click on its backdrop closes, as the dialogs and the case panel of the app. */
@Component({
  imports: [FormsModule, ...SELECT, BackdropClick],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="backdrop()" (appBackdropClick)="closes = closes + 1">
      <div class="card w-80" role="dialog">
        <div id="form" class="h-40 overflow-auto">
          <div class="h-24"></div>
          <ng-select ariaLabel="Módulo" bindValue="id" bindLabel="name" appendTo="body" [items]="modules" [(ngModel)]="module" />
          <div class="h-96"></div>
        </div>
        <div id="notes" class="h-10 overflow-auto"><div class="h-40"></div></div>
        <button type="button" (click)="saves = saves + 1">Guardar</button>
      </div>
    </div>
  `,
})
class DialogHost {
  readonly backdrop = signal<'modal-backdrop' | 'panel-backdrop'>('modal-backdrop');
  /** More than its list shows at once: the list scrolls too. */
  readonly modules = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Módulo ${index + 1}` }));
  readonly module = signal<number | null>(null);
  /** Times a click on the backdrop asked to close the dialog. */
  closes = 0;
  saves = 0;
}

describe('ng-select in a dialog or a panel', () => {
  let fixture: ComponentFixture<DialogHost>;
  let el: HTMLElement;
  let host: DialogHost;

  beforeEach(fakeAsync(() => {
    fixture = TestBed.createComponent(DialogHost);
    el = fixture.nativeElement as HTMLElement;
    // In the page: the select is where the screen draws it, and scrolls with what it is in.
    document.body.appendChild(el);
    host = fixture.componentInstance;
    render();
  }));

  afterEach(() => el.remove());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  const select = (): HTMLElement => ngSelect(el, 'Módulo');
  const list = (): HTMLElement | null => document.querySelector<HTMLElement>('.ng-dropdown-panel');
  const backdrop = (): HTMLElement => el.firstElementChild as HTMLElement;

  function open(): void {
    openSelect(select());
    render();
    expect(list()).not.toBeNull();
  }

  function click(target: HTMLElement): void {
    target.click();
    render();
  }

  // With the native select the click that closed its list never reached the page.
  describe('with its list open', () => {
    for (const kind of ['modal-backdrop', 'panel-backdrop'] as const) {
      it(`a click on the backdrop (${kind}) only puts the list away; the next one is for the dialog`, fakeAsync(() => {
        host.backdrop.set(kind);
        render();
        open();

        click(backdrop());
        expect(list()).toBeNull();
        expect(host.closes).toBe(0);

        click(backdrop());
        expect(host.closes).toBe(1);
      }));
    }

    it('a click on a button of the dialog puts the list away and presses the button', fakeAsync(() => {
      open();

      click(el.querySelector('button')!);
      expect(list()).toBeNull();
      expect(host.saves).toBe(1);
      expect(host.closes).toBe(0);
    }));

  });

  it('with its list closed, leaves a click on the backdrop to the dialog', fakeAsync(() => {
    click(backdrop());
    expect(host.closes).toBe(1);
  }));

  // The list hangs from the body where the select was: it does not go with it.
  describe('scrolled with its list open', () => {
    /** What the browser tells once something has scrolled. */
    function scrolled(target: EventTarget): void {
      target.dispatchEvent(new Event('scroll'));
      render();
    }

    const form = (): HTMLElement => el.querySelector<HTMLElement>('#form')!;

    it('closes the list when the form it is in scrolls', fakeAsync(() => {
      open();

      form().scrollTop = 30;
      scrolled(form());
      expect(list()).toBeNull();
    }));

    // Every scroll of the page is heard outside Angular, and the app has no zone: closing the
    // list is what draws it closed, as in the app, where nobody checks the screen after a scroll.
    it('closes the list on screen by itself, with nobody checking the screen', fakeAsync(() => {
      open();

      form().scrollTop = 30;
      form().dispatchEvent(new Event('scroll'));
      tick();

      expect(list()).toBeNull();
    }));

    // A table wider than its window: the select in it goes sideways.
    it('closes the list when what it is in scrolls sideways', fakeAsync(() => {
      (form().firstElementChild as HTMLElement).style.width = '200%';
      open();

      form().scrollLeft = 30;
      expect(form().scrollLeft).toBe(30);
      scrolled(form());
      expect(list()).toBeNull();
    }));

    it('keeps the list while the list itself scrolls', fakeAsync(() => {
      open();

      const options = list()!.querySelector<HTMLElement>('.ng-dropdown-panel-items')!;
      options.scrollTop = 80;
      expect(options.scrollTop).toBe(80);
      scrolled(options);
      expect(list()).not.toBeNull();
      closeSelect(select());
    }));

    it('keeps the list while something next to the select scrolls', fakeAsync(() => {
      open();

      const notes = el.querySelector<HTMLElement>('#notes')!;
      notes.scrollTop = 30;
      scrolled(notes);
      expect(list()).not.toBeNull();
      closeSelect(select());
    }));

    // A dialog that is centred moves its fields when it grows, and a list that opens makes the
    // page longer for a moment. Neither is a scroll, whatever is told to have scrolled meanwhile.
    it('keeps the list when the select moved without anything it is in having scrolled', fakeAsync(() => {
      open();
      const before = select().getBoundingClientRect().top;
      (form().firstElementChild as HTMLElement).style.height = '40px';
      expect(select().getBoundingClientRect().top).not.toBe(before);

      scrolled(list()!.querySelector<HTMLElement>('.ng-dropdown-panel-items')!);
      scrolled(el.querySelector<HTMLElement>('#notes')!);
      scrolled(form());
      scrolled(document);
      expect(list()).not.toBeNull();
      closeSelect(select());
    }));

    // Pressed on its arrow, the select opens first and takes the focus after: the browser then
    // scrolls the form to bring the whole of it into view, and tells of that scroll a moment later.
    it('keeps the list for the scroll that brought a select half out of view into it', fakeAsync(() => {
      (form().firstElementChild as HTMLElement).style.height = '140px';
      select().querySelector('.ng-arrow-wrapper')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
      render();
      expect(list()).not.toBeNull();
      expect(form().scrollTop).toBeGreaterThan(0);

      scrolled(form());
      expect(list()).not.toBeNull();
      closeSelect(select());
    }));

    // The press that opens a select half out of view scrolls it in, and the browser tells of that scroll after the list is open.
    it('keeps the list for a scroll that was over when it opened', fakeAsync(() => {
      form().scrollTop = 30;
      open();

      scrolled(form());
      expect(list()).not.toBeNull();

      form().scrollTop = 60;
      scrolled(form());
      expect(list()).toBeNull();
    }));
  });
});

/** Two companies of one group, and one registered with no spaces: names as the catalogs of the team have them. */
const LONG_COMPANIES = [
  { id: 1, name: 'Agroindustrial Santa Lucía del Valle de los Chillos Compañía Limitada' },
  { id: 2, name: 'Agroindustrial Santa Lucía del Valle de Tumbaco Sociedad Anónima' },
  { id: 3, name: 'CorporaciónÑanduríQuíntupleZafiroDeLaSierraYLaAmazoníaCíaLtda'.repeat(3) },
];

/** Narrow selects with long options at the edges of a phone, as the filters and the forms of the app put them. */
@Component({
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // At the top of the screen, as a form at the top of a page: the test page has the report of the tests above anything else.
  template: `
    <div class="fixed inset-x-0 top-0">
    <div class="flex justify-between">
      <ng-select class="w-24" ariaLabel="Unidad" bindValue="id" bindLabel="label" appendTo="body" [items]="units" [clearable]="false" [searchable]="false" [(ngModel)]="unit" />
      <ng-select class="w-32" ariaLabel="Empresa" placeholder="Elige o escribe una empresa" bindValue="id" bindLabel="name" appendTo="body" [items]="companies" [(ngModel)]="company" />
    </div>
    <div class="h-14"></div>
    <ng-select class="w-40" ariaLabel="Módulo" bindValue="id" bindLabel="name" appendTo="body" [items]="modules" [(ngModel)]="module" />
    </div>
  `,
})
class LongNamesHost {
  readonly companies = LONG_COMPANIES;
  readonly units = [
    { id: 'hours', label: 'horas' },
    { id: 'days', label: 'días' },
  ];
  readonly modules = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Módulo ${index + 1}` }));
  readonly unit = signal('days');
  readonly company = signal<number | null>(null);
  readonly module = signal<number | null>(null);
}

// On a phone a select is some 130 px wide. Its list was as wide, cut every name with an ellipsis
// ("Agroindustrial …" twice), went past the top of a short screen, and cut the chosen value too.
describe('ng-select with long names on a small screen', () => {
  let fixture: ComponentFixture<LongNamesHost>;
  let el: HTMLElement;

  function create(): void {
    fixture = TestBed.createComponent(LongNamesHost);
    el = fixture.nativeElement as HTMLElement;
    // In the page: the lists hang from the body, placed against their select.
    document.body.appendChild(el);
    render();
  }

  afterEach(() => el.remove());

  function render(): void {
    fixture.detectChanges();
    flushMicrotasks();
    fixture.detectChanges();
  }

  const select = (name: string): HTMLElement => ngSelect(el, name);
  const list = (): HTMLElement => document.querySelector<HTMLElement>('.ng-dropdown-panel')!;
  const options = (): HTMLElement[] => [...list().querySelectorAll<HTMLElement>('.ng-option')];

  function open(name: string): DOMRect {
    openSelect(select(name));
    render();
    return list().getBoundingClientRect();
  }

  describe('on a phone', () => {
    beforeEach(fakeAsync(() => {
      resizeScreen(320, 568);
      create();
    }));

    it('writes every option whole, on as many lines as it takes', fakeAsync(() => {
      open('Empresa');

      expect(options().map((option) => textOf(option))).toEqual(LONG_COMPANIES.map((company) => company.name));
      for (const option of options()) {
        expect(getComputedStyle(option).whiteSpace).toBe('normal');
        expect(option.scrollWidth).withContext(textOf(option)).toBeLessThanOrEqual(option.clientWidth);
        // More than one line of text: the whole name, not its first letters.
        expect(option.offsetHeight).withContext(textOf(option)).toBeGreaterThan(40);
      }
      closeSelect(select('Empresa'));
    }));

    it('widens its list past a narrow select for long names, and keeps it inside the screen', fakeAsync(() => {
      const width = select('Empresa').offsetWidth;
      const shown = open('Empresa');

      expect(shown.width).toBeGreaterThan(width + 100);
      expect(shown.left).toBeGreaterThanOrEqual(0);
      // The 0.75rem the list leaves to the edge of the screen.
      expect(shown.right).toBeLessThanOrEqual(320 - 12 + 0.5);
      closeSelect(select('Empresa'));
    }));

    it('keeps the list of short options as wide as its select, under it', fakeAsync(() => {
      const box = select('Unidad').getBoundingClientRect();
      const shown = open('Unidad');

      expect(shown.width).toBeCloseTo(box.width, 0);
      expect(shown.left).toBeCloseTo(box.left, 0);
      closeSelect(select('Unidad'));
    }));

    // Cut on its third line, the end of a name was only in the list of options: two companies of a group looked the same.
    it('writes the value chosen whole, on as many lines as it takes, in a select that grows to hold them', fakeAsync(() => {
      const height = select('Empresa').offsetHeight;
      chooseOption(select('Empresa'), LONG_COMPANIES[0].name);
      render();

      const value = select('Empresa').querySelector<HTMLElement>('.ng-value')!;
      const lineHeight = parseFloat(getComputedStyle(value).lineHeight);
      expect(selectedTexts(select('Empresa'))).toEqual([LONG_COMPANIES[0].name]);
      expect(getComputedStyle(value).whiteSpace).toBe('normal');
      expect(getComputedStyle(value).webkitLineClamp).toBe('none');
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth);
      expect(value.scrollHeight).toBeLessThanOrEqual(value.clientHeight);
      // More than the three lines it was cut at.
      expect(value.clientHeight).toBeGreaterThan(3 * lineHeight);
      expect(select('Empresa').offsetHeight).toBeGreaterThan(height + 3 * lineHeight);
    }));

    it('cuts a placeholder longer than the select with an ellipsis, on its one line', fakeAsync(() => {
      const placeholder = select('Empresa').querySelector<HTMLElement>('.ng-placeholder')!;

      expect(getComputedStyle(placeholder).textOverflow).toBe('ellipsis');
      expect(placeholder.scrollWidth).toBeGreaterThan(placeholder.clientWidth);
      expect(placeholder.offsetHeight).toBeLessThanOrEqual(20);
    }));
  });

  // A page zoomed to 400 % on a laptop: 320 × 200. The library's list, 240 px high, went past the top.
  it('opens its list where it fits on a short screen, above or below its select', fakeAsync(() => {
    resizeScreen(320, 200);
    create();

    for (const name of ['Módulo', 'Unidad']) {
      const shown = open(name);
      expect(shown.top).withContext(name).toBeGreaterThanOrEqual(0);
      expect(shown.bottom).withContext(name).toBeLessThanOrEqual(200);
      // Some options in view all the same.
      expect(list().querySelector<HTMLElement>('.ng-dropdown-panel-items')!.clientHeight).withContext(name).toBeGreaterThan(60);
      closeSelect(select(name));
      render();
    }
  }));

  // A phone on its side, a select of three lines in the middle of it: neither below nor above
  // was there room for the list the library opens, which went past the top of the screen.
  it('makes the list as high as the side of a tall select it opens on allows, on a short screen', fakeAsync(() => {
    resizeScreen(740, 360);
    create();
    chooseOption(select('Empresa'), LONG_COMPANIES[2].name);
    render();
    // The selects some way down the screen.
    (el.firstElementChild as HTMLElement).style.top = '140px';
    const box = select('Empresa').getBoundingClientRect();
    expect(box.height).toBeGreaterThan(70);

    const shown = open('Empresa');
    expect(shown.top).toBeGreaterThanOrEqual(0);
    expect(shown.bottom).toBeLessThanOrEqual(box.top);
    expect(list().querySelector<HTMLElement>('.ng-dropdown-panel-items')!.clientHeight).toBeGreaterThan(80);
    closeSelect(select('Empresa'));
  }));
});

/** Modules of a long name each: a few of them chosen make a select of several lines. */
const MANY_MODULES = Array.from({ length: 20 }, (_, index) => ({ id: index + 1, name: `Facturación electrónica ${index + 1}` }));

/**
 * A select of several values, high on a short screen: its list hangs from the body, or from the
 * select itself (Configuración has both). `top` places it on the screen, `chosen` makes it higher.
 */
@Component({
  imports: [FormsModule, ...SELECT],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="fixed inset-x-0" [style.top.px]="top()">
      @if (appended()) {
        <ng-select class="w-72" ariaLabel="Módulos" bindValue="id" bindLabel="name" appendTo="body" [items]="modules" [multiple]="true" [closeOnSelect]="false" [(ngModel)]="chosen" />
      } @else {
        <ng-select class="w-72" ariaLabel="Módulos" bindValue="id" bindLabel="name" [items]="modules" [multiple]="true" [closeOnSelect]="false" [(ngModel)]="chosen" />
      }
    </div>
  `,
})
class TallSelectHost {
  readonly modules = MANY_MODULES;
  readonly top = signal(0);
  readonly appended = signal(true);
  readonly chosen = signal<number[]>([]);
}

// A page zoomed to 400 % (320 × 200), the support types of a case chosen: a select some 130 px high.
// ng-select opened its list above it, where it did not fit either, and its top went off the screen.
describe('ng-select of several lines on a short screen', () => {
  let fixture: ComponentFixture<TallSelectHost>;
  let el: HTMLElement;
  let host: TallSelectHost;

  beforeEach(() => {
    resizeScreen(320, 200);
    fixture = TestBed.createComponent(TallSelectHost);
    el = fixture.nativeElement as HTMLElement;
    document.body.appendChild(el);
    host = fixture.componentInstance;
  });

  afterEach(() => el.remove());

  /**
   * The screen drawn again, as the browser does it: past the next frames too, in which the browser
   * tells SelectDefaults of a select or a list that changed size, and SelectDefaults places it.
   */
  async function render(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // A frame for the browser to tell of the new sizes, and the next for the list to be placed again.
    for (let frame = 0; frame < 2; frame++) await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve)));
    fixture.detectChanges();
  }

  const select = (): HTMLElement => ngSelect(el, 'Módulos');
  const list = (): HTMLElement => document.querySelector<HTMLElement>('.ng-dropdown-panel')!;
  const options = (): HTMLElement => list().querySelector<HTMLElement>('.ng-dropdown-panel-items')!;
  const side = (): string => (list().classList.contains('ng-select-top') ? 'top' : list().classList.contains('ng-select-bottom') ? 'bottom' : 'none');

  /** The select, `chosen` values in it, at `top` px from the top of the screen. */
  async function place(chosen: number, top: number, appended = true): Promise<DOMRect> {
    host.appended.set(appended);
    host.chosen.set(MANY_MODULES.slice(0, chosen).map((module) => module.id));
    host.top.set(top);
    await render();
    return select().getBoundingClientRect();
  }

  async function open(): Promise<void> {
    openSelect(select());
    await render();
  }

  async function close(): Promise<void> {
    closeSelect(select());
    await render();
  }

  /** The list is whole on the screen. */
  function expectOnScreen(): void {
    const shown = list().getBoundingClientRect();
    expect(shown.top).toBeGreaterThanOrEqual(-0.5);
    expect(shown.bottom).toBeLessThanOrEqual(200.5);
  }

  for (const appended of [true, false]) {
    const where = appended ? 'hung from the body' : 'inside its select';

    it(`${where}: opens the list on the side with more room when it fits on neither, as high as that side allows`, async () => {
      const box = await place(5, 8, appended);
      const below = 200 - box.bottom;
      // Too low for the list of twenty below, and less room above than below.
      expect(box.height).toBeGreaterThan(90);
      expect(below).toBeGreaterThan(box.top);
      expect(below).toBeLessThan(150);

      await open();

      expect(side()).toBe('bottom');
      expect(select().classList).toContain('ng-select-bottom');
      expectOnScreen();
      expect(list().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom - 0.5);
      // As high as that side allows, the 12 px to the edge of the screen aside.
      expect(list().getBoundingClientRect().bottom).toBeGreaterThan(200 - 12 - 2);
      // Its options scroll inside it.
      expect(options().scrollHeight).toBeGreaterThan(options().clientHeight);
      await close();
    });

    it(`${where}: keeps the list on that side, inside the screen, when an option chosen makes the select higher`, async () => {
      const before = await place(5, 8, appended);
      await open();
      expect(side()).toBe('bottom');

      // Options chosen with the list open (it stays open for the next one), until the select has another line.
      for (const module of MANY_MODULES.slice(10, 13)) {
        [...list().querySelectorAll<HTMLElement>('.ng-option')].find((item) => textOf(item) === module.name)!.click();
        await render();
      }

      expect(select().getBoundingClientRect().height).toBeGreaterThan(before.height);
      expect(side()).toBe('bottom');
      expect(select().classList).toContain('ng-select-bottom');
      expectOnScreen();
      await close();
    });

    it(`${where}: moves the list over its select when not even one option fits on either side`, async () => {
      const box = await place(9, 8, appended);
      // A select almost as high as the screen.
      expect(200 - box.bottom).toBeLessThan(40);
      expect(box.top).toBeLessThan(40);

      await open();

      expectOnScreen();
      const first = options().querySelector<HTMLElement>('.ng-option')!;
      // One option whole at the least: the list is no lower than that.
      expect(options().clientHeight).toBeGreaterThanOrEqual(first.offsetHeight);
      await close();
    });
  }

  // A select of one line on the same screen: its list fits beside it.
  it('opens the list of a select of one line below it, where there is room', async () => {
    const box = await place(0, 8);
    expect(box.height).toBeLessThan(45);

    await open();

    expect(side()).toBe('bottom');
    expectOnScreen();
    expect(list().getBoundingClientRect().top).toBeGreaterThanOrEqual(box.bottom - 0.5);
    await close();
  });
});

/** Makes the test page taller than its window for what `act` does, and leaves it as it was. */
function scrollThePage(act: () => void): void {
  const tall = document.createElement('div');
  tall.style.height = '300vh';
  document.body.appendChild(tall);
  try {
    act();
  } finally {
    window.scrollTo(0, 0);
    tall.remove();
  }
}
