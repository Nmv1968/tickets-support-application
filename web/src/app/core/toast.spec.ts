import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { FormsModule } from '@angular/forms';
import { ngSelect } from '../testing/ng-select';
import { resizeScreen } from '../testing/viewport';
import { Announcements } from './announcer';
import { Hint } from './hint';
import { SELECT } from './select';
import { TOAST_MS, Toast, Toasts } from './toast';

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

    // An error is read, and maybe acted on: it stays much longer than the 6 s it had.
    tick(14_000);
    expect(el.textContent).toContain('No se pudo guardar el caso');
    tick(3000);
    expect(el.textContent).not.toContain('No se pudo guardar el caso');
  }));

  // An error went away after its 6 s even with the pointer on it, while it was being read (WCAG 2.2.1).
  describe('stay while they are held', () => {
    /** The toasts on screen, a toast of each kind, and the element of each. */
    function show(): { el: HTMLElement; item: (text: string) => HTMLElement | undefined } {
      const fixture = TestBed.createComponent(Toasts);
      const el = fixture.nativeElement as HTMLElement;
      const toast = TestBed.inject(Toast);
      tick();
      toast.ok('Caso actualizado');
      toast.error('No se pudo guardar el caso');
      tick();
      fixture.detectChanges();
      const item = (text: string): HTMLElement | undefined => Array.from(el.querySelectorAll<HTMLElement>('.card')).find((card) => card.textContent?.includes(text));
      return { el, item };
    }

    it('with the pointer on them, and go on with the time they had left once it leaves', fakeAsync(() => {
      const { el, item } = show();
      tick(1000);
      item('Caso actualizado')!.dispatchEvent(new MouseEvent('mouseenter'));

      tick(60_000);
      expect(el.textContent).toContain('Caso actualizado');

      item('Caso actualizado')!.dispatchEvent(new MouseEvent('mouseleave'));
      tick(1900);
      expect(el.textContent).toContain('Caso actualizado');
      tick(100);
      expect(el.textContent).not.toContain('Caso actualizado');
      tick(TOAST_MS.error);
    }));

    it('with the focus in them, also while the pointer comes and goes', fakeAsync(() => {
      const { el, item } = show();
      const error = item('No se pudo guardar el caso')!;
      error.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      error.dispatchEvent(new MouseEvent('mouseenter'));
      error.dispatchEvent(new MouseEvent('mouseleave'));

      tick(60_000);
      expect(el.textContent).toContain('No se pudo guardar el caso');

      error.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
      tick(TOAST_MS.error);
      expect(el.textContent).not.toContain('No se pudo guardar el caso');
    }));

    // The toast was a button whose name was its message: nothing said that pressing it closed it.
    it('until their "Cerrar aviso" is pressed', fakeAsync(() => {
      const { el, item } = show();
      const error = item('No se pudo guardar el caso')!;
      expect(error.tagName).not.toBe('BUTTON');
      const close = error.querySelector('button')!;
      expect(close.getAttribute('aria-label')).toBe('Cerrar aviso');

      close.click();
      tick();
      expect(el.textContent).not.toContain('No se pudo guardar el caso');
      expect(el.textContent).toContain('Caso actualizado');
      tick(TOAST_MS.ok);
    }));
  });

  // The toasts were a live region that also held their "Cerrar aviso": each was read as "Caso actualizado, Cerrar aviso".
  describe('to a screen reader', () => {
    /** The toasts, the regions of the Announcer that say them, and what each region holds. */
    function show(): { toasts: HTMLElement; said: (politeness: 'polite' | 'assertive') => string[] } {
      const toasts = TestBed.createComponent(Toasts);
      const announcements = TestBed.createComponent(Announcements);
      const regions = announcements.nativeElement as HTMLElement;
      tick();
      const said = (politeness: 'polite' | 'assertive'): string[] => {
        announcements.detectChanges();
        const region = regions.querySelector(`[aria-live=${politeness}]`)!;
        return Array.from(region.children, (child) => child.textContent!.trim());
      };
      return { toasts: toasts.nativeElement as HTMLElement, said };
    }

    it('say each message once, without its button, an error at once and anything else when the screen reader is done', fakeAsync(() => {
      const { toasts, said } = show();
      const toast = TestBed.inject(Toast);
      expect(said('polite')).toEqual([]);
      expect(said('assertive')).toEqual([]);

      toast.ok('Caso actualizado');
      toast.error('No se pudo guardar el caso');
      tick();
      expect(said('polite')).toEqual(['Caso actualizado']);
      expect(said('assertive')).toEqual(['No se pudo guardar el caso']);
      // The toasts on screen are not read as they come: they are not a live region.
      expect(toasts.querySelector('[aria-live]')).toBeNull();
      expect(toasts.textContent).toContain('Caso actualizado');

      // The same message again is said again.
      toast.ok('Caso actualizado');
      tick();
      expect(said('polite')).toEqual(['Caso actualizado', 'Caso actualizado']);
      tick(TOAST_MS.error);
    }));

    it('take a message out of its region when its toast goes', fakeAsync(() => {
      const { said } = show();
      const toast = TestBed.inject(Toast);
      toast.ok('Caso actualizado');
      toast.error('No se pudo guardar el caso');
      tick(TOAST_MS.ok);
      expect(said('polite')).toEqual([]);
      expect(said('assertive')).toEqual(['No se pudo guardar el caso']);

      toast.dismiss(toast.items()[0].id);
      expect(said('assertive')).toEqual([]);
    }));
  });

  // Inside a dialog its focus trap kept "Cerrar aviso" out of reach, and an error stays 20 s over what is under it.
  describe('Escape', () => {
    /** A dialog under the toasts that closes with Escape, as the case panel does. */
    @Component({
      imports: [Toasts],
      changeDetection: ChangeDetectionStrategy.OnPush,
      host: { '(document:keydown.escape)': 'closed = closed + 1' },
      template: `
        <div role="dialog" aria-label="Detalle del caso"><input id="field" /></div>
        <div class="ng-select ng-select-opened"><input id="open-select" /></div>
        <app-toasts />
      `,
    })
    class Dialog {
      closed = 0;
    }

    function show(): { dialog: Dialog; press: (on: string) => void; shown: () => string[] } {
      const fixture = TestBed.createComponent(Dialog);
      const el = fixture.nativeElement as HTMLElement;
      tick();
      const press = (on: string): void => {
        el.querySelector(`#${on}`)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        tick();
      };
      const shown = (): string[] =>
        TestBed.inject(Toast)
          .items()
          .map((item) => item.text);
      return { dialog: fixture.componentInstance, press, shown };
    }

    it('takes the newest error away first, and stops there; the next one closes the dialog', fakeAsync(() => {
      const { dialog, press, shown } = show();
      const toast = TestBed.inject(Toast);
      toast.error('No se pudo guardar el caso');
      toast.ok('Caso actualizado');
      toast.error('No se pudo agregar la observación');
      toast.ok('Observación agregada');
      tick();

      press('field');
      expect(shown()).toEqual(['No se pudo guardar el caso', 'Caso actualizado', 'Observación agregada']);
      expect(dialog.closed).toBe(0);
      press('field');
      expect(shown()).toEqual(['Caso actualizado', 'Observación agregada']);
      expect(dialog.closed).toBe(0);

      // A toast of what was done never takes the key: it goes by itself in a moment.
      press('field');
      expect(shown()).toEqual(['Caso actualizado', 'Observación agregada']);
      expect(dialog.closed).toBe(1);
      tick(TOAST_MS.ok);
    }));

    it('leaves an open list of options to close first', fakeAsync(() => {
      const { dialog, press, shown } = show();
      TestBed.inject(Toast).error('No se pudo guardar el caso');
      tick();

      press('open-select');
      expect(shown()).toEqual(['No se pudo guardar el caso']);
      expect(dialog.closed).toBe(1);
      tick(TOAST_MS.error);
    }));
  });

  // Escape took the error away before the text of a "?" or an open menu, which stayed open over it: the innermost open thing closes first.
  describe('Escape, with a disclosure open', () => {
    /**
     * A dialog with a "?" (which takes Escape while its text is shown), a list that Escape closes,
     * taking the key, as "Columnas" does, and a panel shown in place, as "Filtros" is, which does not
     * close with Escape, with a select in it. The Escapes that reach the document are counted: the
     * dialog closes on one.
     */
    @Component({
      imports: [Toasts, Hint, FormsModule, ...SELECT],
      changeDetection: ChangeDetectionStrategy.OnPush,
      host: { '(document:keydown.escape)': 'onEscape($event)' },
      template: `
        <div role="dialog" aria-label="Detalle del caso">
          <app-hint textId="date-hint" about="Fecha del caso" text="Día en que el cliente reportó el problema" />
          <button type="button" id="columns" aria-controls="columns-list" [attr.aria-expanded]="columnsOpen()" (click)="columnsOpen.set(true)">Columnas</button>
          @if (columnsOpen()) {
            <div id="columns-list"><input type="checkbox" id="column" /></div>
          }
          <button type="button" id="filters" aria-controls="filters-panel" aria-expanded="true">Filtros</button>
          <div id="filters-panel">
            <input id="filter" />
            <ng-select labelForId="filter-status" [items]="statuses" [(ngModel)]="status" />
          </div>
        </div>
        <app-toasts />
      `,
    })
    class Dialog {
      readonly columnsOpen = signal(false);
      readonly statuses = ['Pendiente', 'Resuelto'];
      status: string | null = null;
      escapes = 0;
      onEscape(event: Event): void {
        this.escapes++;
        if (!this.columnsOpen()) return;
        // As "Columnas" and "Exportar" do: the key that closed it goes no further.
        event.stopPropagation();
        event.preventDefault();
        this.columnsOpen.set(false);
      }
    }

    function show(): { fixture: ComponentFixture<Dialog>; el: HTMLElement; press: (on: string) => void; shown: () => string[] } {
      const fixture = TestBed.createComponent(Dialog);
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      TestBed.inject(Toast).error('No se pudo guardar el caso');
      tick();
      fixture.detectChanges();
      const press = (on: string): void => {
        el.querySelector(on)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        tick();
        fixture.detectChanges();
      };
      const shown = (): string[] =>
        TestBed.inject(Toast)
          .items()
          .map((item) => item.text);
      return { fixture, el, press, shown };
    }

    it('leaves the text of a "?" to close first; the next one takes the error, and the one after closes the dialog', fakeAsync(() => {
      const { fixture, el, press, shown } = show();
      const hint = el.querySelector<HTMLButtonElement>('app-hint button')!;
      hint.click();
      tick();
      fixture.detectChanges();
      expect(hint.getAttribute('aria-expanded')).toBe('true');

      press('app-hint button');
      expect(hint.getAttribute('aria-expanded')).toBe('false');
      expect(shown()).toEqual(['No se pudo guardar el caso']);
      expect(fixture.componentInstance.escapes).toBe(0);

      press('app-hint button');
      expect(shown()).toEqual([]);
      expect(fixture.componentInstance.escapes).toBe(0);

      press('app-hint button');
      expect(fixture.componentInstance.escapes).toBe(1);
    }));

    it('leaves an open list that Escape closes to close first, on its button and inside it', fakeAsync(() => {
      const { fixture, el, press, shown } = show();
      el.querySelector<HTMLButtonElement>('#columns')!.click();
      tick();
      fixture.detectChanges();

      press('#column');
      expect(fixture.componentInstance.columnsOpen()).toBeFalse();
      expect(shown()).toEqual(['No se pudo guardar el caso']);

      el.querySelector<HTMLButtonElement>('#columns')!.click();
      tick();
      fixture.detectChanges();
      press('#columns');
      expect(fixture.componentInstance.columnsOpen()).toBeFalse();
      expect(shown()).toEqual(['No se pudo guardar el caso']);

      press('#columns');
      expect(shown()).toEqual([]);
    }));

    it('takes the error inside what an open disclosure shows in place, which Escape does not close', fakeAsync(() => {
      const { press, shown } = show();

      press('#filter');
      expect(shown()).toEqual([]);
      TestBed.inject(Toast).error('No se pudo leer la lista');
      tick();
      press('#filters');
      expect(shown()).toEqual([]);
    }));

    // ng-select cancels every Escape, with its list closed too: from a select in "Filtros" or "Nuevo caso" Escape did nothing at all.
    it('takes the error from a select with its list closed inside what an open disclosure shows in place', fakeAsync(() => {
      const { el, press, shown } = show();
      expect(el.querySelector('ng-select')!.classList).not.toContain('ng-select-opened');

      press('#filter-status');
      expect(shown()).toEqual([]);
      expect(ngSelect(el, 'filter-status').classList).not.toContain('ng-select-opened');
    }));
  });

  // The focus was on the "Cerrar aviso" of a toast that went, Escape or a press on it: it went to nowhere, and the next Tab started from the top.
  describe('the focus on the "Cerrar aviso" of a toast that goes', () => {
    @Component({
      imports: [Toasts],
      changeDetection: ChangeDetectionStrategy.OnPush,
      template: `
        <main id="contenido" tabindex="-1"><input id="field" aria-label="Descripción" /></main>
        <app-toasts />
      `,
    })
    class Page {}

    function show(...messages: [kind: 'ok' | 'error', text: string][]): { el: HTMLElement; close: (text: string) => HTMLButtonElement; field: HTMLInputElement } {
      const fixture = TestBed.createComponent(Page);
      const el = fixture.nativeElement as HTMLElement;
      fixture.detectChanges();
      const field = el.querySelector<HTMLInputElement>('#field')!;
      field.focus();
      const toast = TestBed.inject(Toast);
      for (const [kind, text] of messages) {
        if (kind === 'ok') toast.ok(text);
        else toast.error(text);
      }
      tick();
      fixture.detectChanges();
      const close = (text: string): HTMLButtonElement =>
        Array.from(el.querySelectorAll<HTMLElement>('[data-toast]'))
          .find((item) => item.textContent?.includes(text))!
          .querySelector('button')!;
      return { el, close, field };
    }

    it('goes to the "Cerrar aviso" of the next toast, and from the last one back to where it was before', fakeAsync(() => {
      const { close, field } = show(['error', 'No se pudo guardar el caso'], ['error', 'No se pudo agregar la observación']);
      const second = close('No se pudo agregar la observación');
      close('No se pudo guardar el caso').focus();

      close('No se pudo guardar el caso').click();
      tick();
      expect(document.activeElement).toBe(second);

      second.click();
      tick();
      expect(document.activeElement).toBe(field);
    }));

    it('goes back to where it was before when Escape takes the error away', fakeAsync(() => {
      const { close, field } = show(['ok', 'Caso actualizado'], ['error', 'No se pudo guardar el caso']);
      const button = close('No se pudo guardar el caso');
      button.focus();

      button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      tick();
      expect(TestBed.inject(Toast).items().map((item) => item.text)).toEqual(['Caso actualizado']);
      expect(document.activeElement).toBe(field);
      tick(TOAST_MS.ok);
    }));

    it('goes to the content of the page when what had it before is gone', fakeAsync(() => {
      const { el, close, field } = show(['error', 'No se pudo guardar el caso']);
      close('No se pudo guardar el caso').focus();
      field.remove();

      close('No se pudo guardar el caso').click();
      tick();
      expect(document.activeElement).toBe(el.querySelector('#contenido'));
    }));

    // The content of the page is then behind the dialog, out of reach of the keyboard.
    it('goes into the dialog on top, not to the page behind it, when what had it before is gone', fakeAsync(() => {
      const { el, close, field } = show(['error', 'No se pudo guardar el caso']);
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');
      dialog.innerHTML = '<button type="button" disabled>Guardar</button><button type="button">Cancelar</button>';
      el.appendChild(dialog);
      close('No se pudo guardar el caso').focus();
      field.remove();

      close('No se pudo guardar el caso').click();
      tick();
      expect(document.activeElement?.textContent).toBe('Cancelar');
      dialog.remove();
    }));

    it('is left where it is when it is not on the toast that goes', fakeAsync(() => {
      const { close, field } = show(['error', 'No se pudo guardar el caso'], ['error', 'No se pudo agregar la observación']);
      const second = close('No se pudo agregar la observación');
      second.focus();

      close('No se pudo guardar el caso').click();
      tick();
      expect(document.activeElement).toBe(second);

      field.focus();
      second.click();
      tick();
      expect(document.activeElement).toBe(field);
    }));
  });

  it('show a check for what went well and an alert for an error, in their colours', fakeAsync(() => {
    const fixture = TestBed.createComponent(Toasts);
    const el = fixture.nativeElement as HTMLElement;
    const toast = TestBed.inject(Toast);
    tick();

    toast.ok('Caso actualizado');
    toast.error('No se pudo guardar el caso');
    tick();
    const [ok, error] = Array.from(el.querySelectorAll('.card > app-icon'));
    expect(ok.getAttribute('data-icon')).toBe('check-circle');
    expect(ok.classList).toContain('text-success');
    expect(error.getAttribute('data-icon')).toBe('alert-circle');
    expect(error.classList).toContain('text-danger');
    expect(error.closest('.card')!.classList).toContain('border-danger');
    tick(TOAST_MS.error);
  }));

  // Drawn for real, with the stylesheet of the app, on a screen of the size of each test.
  describe('on the screen', () => {
    /** Two toasts on screen, and the box they are in. */
    function show(): HTMLElement {
      const fixture = TestBed.createComponent(Toasts);
      const toast = TestBed.inject(Toast);
      tick();
      toast.ok('Administrador E2E registró el caso SOP-00254');
      toast.error('La fecha del caso no puede ser posterior a hoy. Revisa la fecha y vuelve a guardar el caso.');
      tick();
      return (fixture.nativeElement as HTMLElement).firstElementChild as HTMLElement;
    }

    // They came up over the tab bar of a phone (56 px), over the footer of the case panel and of
    // a dialog, and over the pager of the list: right on what the person was about to press.
    for (const [width, height] of [
      [375, 812],
      [1280, 800],
    ]) {
      it(`at ${width} × ${height} keep clear of the bars and footers at the bottom of the screen`, fakeAsync(() => {
        resizeScreen(width, height);
        const box = show().getBoundingClientRect();

        expect(box.bottom).toBeLessThanOrEqual(height - 80);
        expect(box.right).toBeLessThanOrEqual(width - 16);
        expect(box.left).toBeGreaterThanOrEqual(16);
        tick(TOAST_MS.error);
      }));
    }

    /** `count` toasts on screen, an error last: the box they are in, and the newest one. */
    function pile(count: number): { region: HTMLElement; newest: HTMLElement } {
      const fixture = TestBed.createComponent(Toasts);
      const toast = TestBed.inject(Toast);
      tick();
      for (let n = 1; n < count; n++) toast.ok(`Administrador E2E registró el caso SOP-${String(n).padStart(5, '0')}`);
      toast.error('No se pudo guardar el caso');
      tick();
      const region = (fixture.nativeElement as HTMLElement).firstElementChild as HTMLElement;
      return { region, newest: Array.from(region.querySelectorAll<HTMLElement>('.card')).at(-1)! };
    }

    /** Whether `inner` is whole inside what `outer` shows of it. */
    const within = (inner: HTMLElement, outer: HTMLElement): boolean => {
      const [a, b] = [inner.getBoundingClientRect(), outer.getBoundingClientRect()];
      return a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
    };

    // Thirty at once (a sheet imported elsewhere) went past the top of the screen, out of reach, over
    // the button that closes the panel; and in a strip that scrolls, the newest was under the others.
    for (const [width, height, count] of [
      [1280, 800, 30],
      [375, 812, 30],
      [320, 200, 3],
    ]) {
      it(`at ${width} × ${height} keep ${count} toasts inside the screen, and show the newest`, fakeAsync(() => {
        resizeScreen(width, height);
        const { region, newest } = pile(count);

        expect(region.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
        expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
        expect(within(newest, region)).withContext('the newest toast in view').toBeTrue();
        expect(newest.textContent).toContain('No se pudo guardar el caso');
        tick(TOAST_MS.error);
      }));
    }

    // At 400 % (320 × 200) two toasts took more than half the screen.
    it('on a short screen keep low, and never take more than half of it', fakeAsync(() => {
      resizeScreen(320, 200);
      const region = show();
      const box = region.getBoundingClientRect();

      // From the bottom of what the page shows, less a scrollbar the test page may have.
      expect(box.bottom).toBeGreaterThan(document.documentElement.clientHeight - 16);
      expect(box.height).toBeLessThanOrEqual(100);
      // What does not fit scrolls, inside the box of the toasts.
      expect(region.scrollHeight).toBeGreaterThan(region.clientHeight);
      tick(TOAST_MS.error);
    }));

    // A control that took the focus could sit entirely under them (WCAG 2.4.11): 1 Tab stop in 40 on a phone, 10 at 400 %.
    describe('never cover the control with the focus', () => {
      /** A list that scrolls, from the top of the screen to some room above its bottom, with the toasts over it. */
      @Component({
        imports: [Toasts],
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `
          <div id="list" class="fixed inset-x-0 top-0 overflow-auto" style="height: calc(100vh - 6rem)">
            @for (row of rows; track row) {
              <button type="button" class="block h-10 w-full">Fila {{ row }}</button>
            }
          </div>
          <app-toasts />
        `,
      })
      class List {
        readonly rows = Array.from({ length: 40 }, (_, index) => index + 1);
      }

      /** The list with two toasts on it, the box of the toasts, and the rows. */
      function show(): { list: HTMLElement; column: () => DOMRect; rows: HTMLButtonElement[] } {
        const fixture = TestBed.createComponent(List);
        const el = fixture.nativeElement as HTMLElement;
        const toast = TestBed.inject(Toast);
        tick();
        toast.ok('Administrador E2E registró el caso SOP-00254');
        toast.error('La fecha del caso no puede ser posterior a hoy. Revisa la fecha y vuelve a guardar el caso.');
        tick();
        fixture.detectChanges();
        const strip = el.querySelector('app-toasts')!.firstElementChild as HTMLElement;
        return { list: el.querySelector<HTMLElement>('#list')!, column: () => strip.getBoundingClientRect(), rows: Array.from(el.querySelectorAll('button')).filter((row) => !strip.contains(row)) };
      }

      /** Whether the toasts cover any of `row`, or the space just above them. */
      const covered = (row: HTMLElement, column: DOMRect): boolean => {
        const box = row.getBoundingClientRect();
        return box.right > column.left && box.left < column.right && box.top < column.bottom && box.bottom > column.top - 8;
      };

      for (const [width, height] of [
        [375, 812],
        [1280, 800],
      ]) {
        it(`at ${width} × ${height} scroll it up from under them`, fakeAsync(() => {
          resizeScreen(width, height);
          const { list, column, rows } = show();
          const row = rows.find((candidate) => covered(candidate, column()))!;
          expect(row).withContext('a row under the toasts').toBeDefined();

          row.focus();
          tick(16);
          expect(covered(row, column())).toBeFalse();
          expect(row.getBoundingClientRect().bottom).toBeLessThanOrEqual(column().top - 8 + 0.5);
          expect(list.scrollTop).toBeGreaterThan(0);
          // Not past the top of the list.
          expect(row.getBoundingClientRect().top).toBeGreaterThanOrEqual(list.getBoundingClientRect().top);
          tick(TOAST_MS.error);
        }));
      }

      it('at the end of the list give it room to scroll into, until the toasts go', fakeAsync(() => {
        resizeScreen(375, 812);
        const { list, column, rows } = show();
        list.scrollTop = list.scrollHeight;
        const last = rows.at(-1)!;
        expect(covered(last, column())).withContext('the last row under the toasts').toBeTrue();

        last.focus();
        tick(16);
        expect(covered(last, column())).toBeFalse();
        expect(list.style.paddingBottom).not.toBe('');

        tick(TOAST_MS.error);
        TestBed.tick();
        expect(TestBed.inject(Toast).items()).toEqual([]);
        expect(list.style.paddingBottom).toBe('');
      }));

      /** A page that the screen itself scrolls, as the list does on a short screen, with the toasts over its end. */
      @Component({
        imports: [Toasts],
        changeDetection: ChangeDetectionStrategy.OnPush,
        template: `
          @for (row of rows; track row) {
            <button type="button" class="block h-10 w-full">Fila {{ row }}</button>
          }
          <app-toasts />
        `,
      })
      class Page {
        readonly rows = Array.from({ length: 20 }, (_, index) => index + 1);
      }

      // At 400 % the body, as high as the screen, got the room at its end, above the end of what it
      // holds: the page was no longer, and the pager at the end of the list stayed under the toasts.
      it('at the end of a page that the screen scrolls give it room to scroll into, until the toasts go', fakeAsync(() => {
        resizeScreen(320, 200);
        const fixture = TestBed.createComponent(Page);
        const el = fixture.nativeElement as HTMLElement;
        const toast = TestBed.inject(Toast);
        tick();
        toast.ok('Administrador E2E registró el caso SOP-00254');
        toast.error('No se pudo guardar el caso');
        tick();
        fixture.detectChanges();
        const strip = el.querySelector('app-toasts')!.firstElementChild as HTMLElement;
        const page = document.scrollingElement!;
        const body = document.body;
        // What scrolls is the page, as in the app: not the body, which the stylesheet of Jasmine's
        // page in the browser (`ng test`) makes scroll.
        body.style.overflowY = 'visible';
        const last = Array.from(el.querySelectorAll('button')).filter((row) => !strip.contains(row)).at(-1)!;
        page.scrollTop = page.scrollHeight;
        const end = page.scrollTop;
        expect(end).withContext('the page scrolls').toBeGreaterThan(0);
        expect(covered(last, strip.getBoundingClientRect())).withContext('the last row under the toasts').toBeTrue();

        last.focus();
        tick(16);
        expect(covered(last, strip.getBoundingClientRect())).toBeFalse();
        expect(page.scrollTop).toBeGreaterThan(end);
        expect(body.style.paddingBottom).not.toBe('');

        tick(TOAST_MS.error);
        TestBed.tick();
        expect(toast.items()).toEqual([]);
        expect(body.style.paddingBottom).toBe('');
        expect(body.style.height).toBe('');
        page.scrollTop = 0;
        body.style.overflowY = '';
      }));

      // Scrolled from under the pointer, the list a press opened on a select closed at once.
      it('leave alone a control the pointer has just pressed, and a select with its list open', fakeAsync(() => {
        resizeScreen(375, 812);
        const { list, column, rows } = show();
        const [pressed, opened] = rows.filter((candidate) => covered(candidate, column()));
        pressed.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        pressed.focus();
        tick(16);
        expect(list.scrollTop).toBe(0);

        // The next focus is looked at again: the press was for that one.
        opened.classList.add('ng-select-opened');
        opened.focus();
        tick(16);
        expect(list.scrollTop).toBe(0);
        opened.classList.remove('ng-select-opened');
        pressed.focus();
        tick(16);
        expect(covered(pressed, column())).toBeFalse();
        tick(TOAST_MS.error);
      }));

      it('leave alone a control they do not cover', fakeAsync(() => {
        resizeScreen(1280, 800);
        const { list, rows } = show();
        rows[0].focus();
        tick(16);
        expect(list.scrollTop).toBe(0);
        tick(TOAST_MS.error);
      }));
    });
  });
});
