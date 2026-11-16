import { decodeCsv, parseCsv, toDateOnly, toStatus, toTimeOnly } from './sheet-reading';

describe('spreadsheet import parsing', () => {
  describe('toDateOnly', () => {
    it('reads month/day/year text, the format of the team sheet', () => {
      expect(toDateOnly('7/27/2023', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('1/2/2023', 'mdy')).toBe('2023-01-02');
    });

    it('reads day/month/year text when that order is chosen', () => {
      expect(toDateOnly('1/2/2023', 'dmy')).toBe('2023-02-01');
      expect(toDateOnly('27-07-2023', 'dmy')).toBe('2023-07-27');
    });

    it('treats a number above 12 as the day whatever order is chosen', () => {
      expect(toDateOnly('27/7/2023', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('7/27/2023', 'dmy')).toBe('2023-07-27');
    });

    it('reads date cells, ISO text, two-digit years and Excel serial numbers', () => {
      expect(toDateOnly(new Date(Date.UTC(2023, 6, 27)), 'mdy')).toBe('2023-07-27');
      expect(toDateOnly('2023-07-27', 'dmy')).toBe('2023-07-27');
      expect(toDateOnly('7/27/23', 'mdy')).toBe('2023-07-27');
      expect(toDateOnly(45134, 'mdy')).toBe('2023-07-27');
    });

    it('returns null for empty or impossible dates', () => {
      expect(toDateOnly('', 'mdy')).toBeNull();
      expect(toDateOnly(null, 'mdy')).toBeNull();
      expect(toDateOnly('pendiente', 'mdy')).toBeNull();
      expect(toDateOnly('2/30/2023', 'mdy')).toBeNull();
    });
  });

  describe('toStatus', () => {
    it('maps the labels used in the sheet, including typos', () => {
      expect(toStatus('Resuelto')).toBe('RESOLVED');
      expect(toStatus('RESUELTA')).toBe('RESOLVED');
      expect(toStatus('Sin resover')).toBe('UNRESOLVED');
      expect(toStatus('Sin resolver')).toBe('UNRESOLVED');
      expect(toStatus('Pendiente')).toBe('PENDING');
    });

    it('reads an empty cell as pending, and "Pendiente" however it is written', () => {
      expect(toStatus('')).toBe('PENDING');
      expect(toStatus('   ')).toBe('PENDING');
      expect(toStatus('PENDIENTE')).toBe('PENDING');
      expect(toStatus(' pendientes ')).toBe('PENDING');
    });

    // Taken for pending, the closed cases of an old sheet would come in as open ones.
    it('gives nothing for a word that is none of the three statuses', () => {
      for (const word of ['Cerrado', 'Solucionado', 'en revisión', 'Anulado', 'no resuelto', 'x']) expect(toStatus(word)).toBeNull();
    });
  });

  describe('decodeCsv', () => {
    const text = 'Fecha;Empresa;Módulo\n27/07/2023;Corporación Ñandú;Facturación';

    it('reads a file in UTF-8, with or without the mark Excel puts at its start', () => {
      expect(decodeCsv(Buffer.from(text, 'utf8'))).toBe(text);
      expect(parseCsv(decodeCsv(Buffer.from(`\ufeff${text}`, 'utf8')))[0]).toEqual(['Fecha', 'Empresa', 'Módulo']);
    });

    // What "CSV (delimitado por comas)" of Excel writes on Windows: one byte per letter.
    it('reads a file that is not UTF-8 as the Windows code page of Western Europe', () => {
      expect(decodeCsv(Buffer.from(text, 'latin1'))).toBe(text);
      // The bytes that code page has and Latin-1 does not: the euro sign, the long dash, the curly quotes.
      expect(decodeCsv(Buffer.from([0x80, 0x20, 0x96, 0x20, 0x93, 0xf1, 0x94]))).toBe('€ – “ñ”');
    });

    it('leaves plain text as it is', () => {
      expect(decodeCsv(Buffer.from('Fecha,Empresa\n7/27/2023,ACME', 'latin1'))).toBe('Fecha,Empresa\n7/27/2023,ACME');
      expect(decodeCsv(Buffer.alloc(0))).toBe('');
    });
  });

  describe('parseCsv', () => {
    it('handles quotes, embedded delimiters, line breaks and a BOM', () => {
      const csv = '﻿Fecha,Empresa,Descripción\r\n7/27/2023,"ACME, S.A.","Dijo ""no abre""\nsegunda línea"\r\n';
      expect(parseCsv(csv)).toEqual([
        ['Fecha', 'Empresa', 'Descripción'],
        ['7/27/2023', 'ACME, S.A.', 'Dijo "no abre"\nsegunda línea'],
      ]);
    });

    it('detects semicolons, the delimiter Excel uses in Spanish locales', () => {
      expect(parseCsv('Fecha;Empresa\n27/7/2023;ACME')).toEqual([
        ['Fecha', 'Empresa'],
        ['27/7/2023', 'ACME'],
      ]);
    });

    it('reads no more records than it is asked for, the last one without a line break included', () => {
      expect(parseCsv('a\nb\nc\nd', 2)).toEqual([['a'], ['b']]);
      expect(parseCsv('a\nb\nc', 3)).toEqual([['a'], ['b'], ['c']]);
      expect(parseCsv('a\nb\nc\nd', 3)).toEqual([['a'], ['b'], ['c']]);
      expect(parseCsv('a\nb\n', 3)).toEqual([['a'], ['b']]);
    });
  });
});

describe('toTimeOnly', () => {
  it('reads a time cell of Excel, which arrives as a date on its day zero', () => {
    expect(toTimeOnly(new Date('1899-12-30T14:35:00.000Z'))).toBe('14:35');
    expect(toTimeOnly(new Date('1899-12-30T00:00:00.000Z'))).toBe('00:00');
    // 14:35 as the sum of fractions gives it: a hair before the minute.
    expect(toTimeOnly(new Date('1899-12-30T14:34:59.999Z'))).toBe('14:35');
  });

  it('reads the part of a day gone by, alone or after the day of a date', () => {
    expect(toTimeOnly(0.5)).toBe('12:00');
    expect(toTimeOnly((14 * 60 + 35) / 1440)).toBe('14:35');
    expect(toTimeOnly(45000.25)).toBe('06:00');
    expect(toTimeOnly(0)).toBe('00:00');
  });

  it('reads a time written as text, on either clock', () => {
    expect(toTimeOnly('14:35')).toBe('14:35');
    expect(toTimeOnly(' 9:05 ')).toBe('09:05');
    expect(toTimeOnly('14:35:20')).toBe('14:35');
    expect(toTimeOnly('14h35')).toBe('14:35');
    expect(toTimeOnly('2:35 PM')).toBe('14:35');
    expect(toTimeOnly('2:35 p. m.')).toBe('14:35');
    expect(toTimeOnly('12:10 am')).toBe('00:10');
    expect(toTimeOnly('12:10 pm')).toBe('12:10');
  });

  it('gives nothing for an empty cell or for what is not a time of day', () => {
    for (const value of [null, undefined, '', '   ', 'por la tarde', '25:00', '14:60', '13:00 pm', '0:30 am', -0.5, new Date('x')]) {
      expect(toTimeOnly(value)).toBeNull();
    }
  });
});
