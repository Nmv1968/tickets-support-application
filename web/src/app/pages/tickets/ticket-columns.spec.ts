import { TestBed } from '@angular/core/testing';
import { isDisabled } from '../../testing/screen';
import { COLUMNS, DEFAULT_COLUMNS, TicketColumnsMenu, tableWidth } from './ticket-columns';

// The table scrolls sideways when the columns on show need more room than it has. For someone
// who never chose their columns that must not happen on a laptop: the last column would be out
// of sight from the first day.
describe('the columns a person starts with', () => {
  /**
   * The room the table has in a window this wide, with the menu at its side: the window, less the
   * menu (224 px), the padding of the page (20 px a side), the border of the card (1 px a side)
   * and the scrollbar a long list gives the card (17 px where it is widest).
   */
  const room = (window: number): number => window - 224 - 2 * 20 - 2 * 1 - 17;
  const starting = COLUMNS.filter((column) => DEFAULT_COLUMNS.includes(column.id));

  it('are the ones the list always had, and the support types', () => {
    expect(starting.map((column) => column.label)).toEqual(['Código', 'Fecha del caso', 'Registro', 'Empresa', 'Descripción', 'Estado', 'Responsable', 'Tipos de soporte', 'Observación']);
  });

  // 1280: the most common laptop, where the last column was out of sight.
  for (const window of [1280, 1366, 1440]) {
    it(`fit a window ${window} px wide without scrolling sideways`, () => {
      expect(tableWidth(starting)).toBeLessThanOrEqual(room(window));
    });
  }

  // Tightened to fit, not squeezed: the two columns of free text keep room for some fifteen letters
  // a line on the narrowest of those windows, and some twenty on the next.
  it('leave Descripción and Observación room to be read on those windows', () => {
    const fixed = starting.reduce((width, column) => width + (column.width ?? 0), 0);
    const shared = starting.filter((column) => column.width === null).length;

    expect(shared).toBe(2);
    expect((room(1280) - fixed) / shared).toBeGreaterThanOrEqual(120);
    expect((room(1366) - fixed) / shared).toBeGreaterThanOrEqual(160);
  });
});

describe('TicketColumnsMenu', () => {
  function open(visible: readonly string[] = ['code', 'date']): { el: HTMLElement; render: () => void } {
    const fixture = TestBed.createComponent(TicketColumnsMenu);
    const el = fixture.nativeElement as HTMLElement;
    fixture.componentRef.setInput('visible', visible);
    const render = (): void => fixture.detectChanges();
    render();
    el.querySelector('button')!.click();
    render();
    return { el, render };
  }
  const reset = (el: HTMLElement): HTMLButtonElement => Array.from(el.querySelectorAll('button')).find((button) => button.textContent?.includes('Restablecer'))!;

  // Disabled once the columns were the initial ones again, it gave the focus away to nowhere.
  it('keeps the focus on "Restablecer" once the columns are the initial ones', () => {
    const { el, render } = open();
    reset(el).focus();
    reset(el).click();
    render();

    expect(isDisabled(reset(el))).toBeTrue();
    expect(document.activeElement).toBe(reset(el));
  });

  it('closes its list once the focus leaves it, as the export menu does, and not when it goes nowhere', () => {
    const { el, render } = open([...DEFAULT_COLUMNS]);
    const outside = document.body.appendChild(document.createElement('button'));
    const list = (): Element | null => el.querySelector('#ticket-columns');

    reset(el).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: null }));
    render();
    expect(list()).not.toBeNull();

    reset(el).dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: outside }));
    render();
    expect(list()).toBeNull();
    outside.remove();
  });
});
