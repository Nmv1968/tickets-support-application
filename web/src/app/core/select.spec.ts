import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { chooseOption, clearSelect, closeSelect, ngSelect, openSelect, optionTexts, removeChosen, selectedTexts, typeInSelect } from '../testing/ng-select';
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
          const panel = document.querySelector<HTMLElement>('.ng-dropdown-panel')!;
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
