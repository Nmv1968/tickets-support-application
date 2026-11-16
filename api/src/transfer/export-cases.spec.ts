import { notesText } from './export-cases';

describe('notesText', () => {
  it('gives a single observation as it is, and nothing without observations', () => {
    expect(notesText([])).toBe('');
    expect(notesText([{ text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 11, 23, 30) }])).toBe('Se llamó al cliente');
  });

  it('dates several observations with the day on the server clock', () => {
    // Just after midnight and late at night: the UTC day of one of them is not the 11th in any zone but UTC itself.
    const notes = [
      { text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 11, 0, 30) },
      { text: 'Se reinició el servicio', createdAt: new Date(2026, 10, 11, 23, 30) },
    ];
    expect(notesText(notes)).toBe('11/11/2026: Se llamó al cliente\n11/11/2026: Se reinició el servicio');
  });
});
