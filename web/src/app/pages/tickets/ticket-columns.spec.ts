import { COLUMNS, DEFAULT_COLUMNS, tableWidth } from './ticket-columns';

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

  for (const window of [1366, 1440]) {
    it(`fit a window ${window} px wide without scrolling sideways`, () => {
      expect(tableWidth(starting)).toBeLessThanOrEqual(room(window));
    });
  }

  // Tightened to fit, not squeezed: the two columns of free text keep room for some twenty letters a line.
  it('leave Descripción and Observación room to be read on the narrower of those windows', () => {
    const fixed = starting.reduce((width, column) => width + (column.width ?? 0), 0);
    const shared = starting.filter((column) => column.width === null).length;

    expect(shared).toBe(2);
    expect((room(1366) - fixed) / shared).toBeGreaterThanOrEqual(160);
  });
});
