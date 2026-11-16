import { excelMoment } from './xlsx';

describe('excelMoment', () => {
  it('shifts a moment so that its UTC reading, which is what Excel shows, is the local time', () => {
    expect(excelMoment(new Date(2026, 10, 11, 23, 30))?.toISOString()).toBe('2026-11-11T23:30:00.000Z');
    expect(excelMoment(null)).toBeNull();
  });
});
