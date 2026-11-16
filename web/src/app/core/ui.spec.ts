import { HttpErrorResponse } from '@angular/common/http';
import { PRIORITY_OPTIONS, STATUS_OPTIONS, errorMessage, formatCaseDate, formatDay, formatHours, formatMinutes, formatMomentDay, imagesFrom, nameKey, pastedImages, promiseText, timeAgo, todayIso } from './ui';

/**
 * Sets "now" from local date parts, so every expectation holds in any time zone. The cases
 * next to midnight are the ones that matter: the team works at UTC-5, where the UTC day is
 * already tomorrow from 19:00 on, so code that takes the day from UTC is wrong every evening.
 */
function setNow(year: number, month: number, day: number, hour = 12, minute = 0): void {
  jasmine.clock().mockDate(new Date(year, month - 1, day, hour, minute));
}

/** A local date and time as the ISO timestamp the API would send for that moment. */
function timestamp(year: number, month: number, day: number, hour: number, minute = 0): string {
  return new Date(year, month - 1, day, hour, minute).toISOString();
}

describe('ui', () => {
  beforeEach(() => jasmine.clock().install());
  afterEach(() => jasmine.clock().uninstall());

  describe('todayIso', () => {
    it('pads the month and the day', () => {
      setNow(2026, 3, 5);
      expect(todayIso()).toBe('2026-03-05');
    });

    it('is the local day until the last minute of the evening', () => {
      setNow(2026, 1, 31, 23, 59);
      expect(todayIso()).toBe('2026-01-31');
    });

    it('changes at local midnight', () => {
      setNow(2026, 2, 1, 0, 0);
      expect(todayIso()).toBe('2026-02-01');
    });

    it('handles the last day of the year', () => {
      setNow(2026, 12, 31, 23, 59);
      expect(todayIso()).toBe('2026-12-31');
    });
  });

  describe('formatDay', () => {
    it('writes a calendar day as DD/MM/YYYY', () => {
      expect(formatDay('2026-11-01')).toBe('01/11/2026');
      expect(formatDay('2028-02-29')).toBe('29/02/2028');
    });

    it('keeps the day as written, without moving it to the local time zone', () => {
      expect(formatDay('2026-11-01T00:00:00.000Z')).toBe('01/11/2026');
      expect(formatDay('2026-11-01T23:30:00.000Z')).toBe('01/11/2026');
    });

    it('is empty without a value', () => {
      expect(formatDay(null)).toBe('');
      expect(formatDay(undefined)).toBe('');
      expect(formatDay('')).toBe('');
    });
  });

  describe('formatMomentDay', () => {
    it('writes the local day of a moment, on both sides of midnight', () => {
      expect(formatMomentDay(timestamp(2026, 1, 31, 23, 59))).toBe('31/01/2026');
      expect(formatMomentDay(timestamp(2026, 2, 1, 0, 0))).toBe('01/02/2026');
    });

    it('pads the day and the month', () => {
      expect(formatMomentDay(timestamp(2026, 3, 5, 12))).toBe('05/03/2026');
    });

    it('is empty without a value', () => {
      expect(formatMomentDay(null)).toBe('');
      expect(formatMomentDay(undefined)).toBe('');
      expect(formatMomentDay('')).toBe('');
    });
  });

  describe('formatMinutes', () => {
    it('writes less than an hour in minutes', () => {
      expect(formatMinutes(5)).toBe('5 min');
      expect(formatMinutes(59)).toBe('59 min');
    });

    it('writes whole hours without minutes', () => {
      expect(formatMinutes(60)).toBe('1 h');
      expect(formatMinutes(120)).toBe('2 h');
    });

    it('writes hours and minutes', () => {
      expect(formatMinutes(95)).toBe('1 h 35 min');
      expect(formatMinutes(61)).toBe('1 h 1 min');
    });

    it('keeps long times in hours, without days', () => {
      expect(formatMinutes(1505)).toBe('25 h 5 min');
    });

    it('is "0 min" for zero or no value', () => {
      expect(formatMinutes(0)).toBe('0 min');
      expect(formatMinutes(null)).toBe('0 min');
      expect(formatMinutes(undefined)).toBe('0 min');
    });
  });

  describe('formatHours', () => {
    it('writes hours in singular and plural', () => {
      expect(formatHours(1)).toBe('1 hora');
      expect(formatHours(5)).toBe('5 horas');
    });

    it('writes whole days as days', () => {
      expect(formatHours(24)).toBe('1 día');
      expect(formatHours(48)).toBe('2 días');
      expect(formatHours(72)).toBe('3 días');
    });

    it('keeps hours when they are not whole days', () => {
      expect(formatHours(23)).toBe('23 horas');
      expect(formatHours(36)).toBe('36 horas');
    });
  });

  describe('timeAgo', () => {
    const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

    beforeEach(() => setNow(2026, 11, 11, 15, 0));

    it('counts minutes during the first hour', () => {
      expect(timeAgo(minutesAgo(0))).toBe('hace 0 min');
      expect(timeAgo(minutesAgo(20))).toBe('hace 20 min');
      expect(timeAgo(minutesAgo(59))).toBe('hace 59 min');
    });

    it('counts hours up to two days', () => {
      expect(timeAgo(minutesAgo(60))).toBe('hace 1 h');
      expect(timeAgo(minutesAgo(5 * 60))).toBe('hace 5 h');
      expect(timeAgo(minutesAgo(47 * 60))).toBe('hace 47 h');
    });

    it('counts days from two days on', () => {
      expect(timeAgo(minutesAgo(48 * 60))).toBe('hace 2 días');
      expect(timeAgo(minutesAgo(3 * 24 * 60))).toBe('hace 3 días');
      expect(timeAgo(minutesAgo(30 * 24 * 60))).toBe('hace 30 días');
    });

    it('rounds to the nearest hour and day', () => {
      expect(timeAgo(minutesAgo(80))).toBe('hace 1 h');
      expect(timeAgo(minutesAgo(100))).toBe('hace 2 h');
      expect(timeAgo(minutesAgo(54 * 60))).toBe('hace 2 días');
      expect(timeAgo(minutesAgo(66 * 60))).toBe('hace 3 días');
    });

    // The timestamp is set by the server, whose clock can run ahead of the browser's.
    it('does not go negative for a moment in the future', () => {
      expect(timeAgo(minutesAgo(-3))).toBe('hace 0 min');
    });

    it('is empty without a value', () => {
      expect(timeAgo(null)).toBe('');
      expect(timeAgo(undefined)).toBe('');
      expect(timeAgo('')).toBe('');
    });
  });

  describe('promiseText', () => {
    it('names yesterday, today and tomorrow', () => {
      setNow(2026, 11, 11);
      expect(promiseText('2026-11-10')).toBe('venció ayer');
      expect(promiseText('2026-11-11')).toBe('vence hoy');
      expect(promiseText('2026-11-12')).toBe('vence mañana');
    });

    it('counts the days beyond that', () => {
      setNow(2026, 11, 11);
      expect(promiseText('2026-11-09')).toBe('venció hace 2 días');
      expect(promiseText('2026-11-01')).toBe('venció hace 10 días');
      expect(promiseText('2026-11-13')).toBe('vence en 2 días');
      expect(promiseText('2026-11-21')).toBe('vence en 10 días');
    });

    it('crosses the end of a month', () => {
      setNow(2026, 1, 31);
      expect(promiseText('2026-02-01')).toBe('vence mañana');
      expect(promiseText('2026-02-02')).toBe('vence en 2 días');

      setNow(2026, 3, 1);
      expect(promiseText('2026-02-28')).toBe('venció ayer');
      expect(promiseText('2026-02-27')).toBe('venció hace 2 días');
    });

    it('counts 29 February in a leap year', () => {
      setNow(2028, 3, 1);
      expect(promiseText('2028-02-29')).toBe('venció ayer');
      expect(promiseText('2028-02-28')).toBe('venció hace 2 días');
    });

    it('crosses the end of the year', () => {
      setNow(2026, 12, 31);
      expect(promiseText('2027-01-01')).toBe('vence mañana');

      setNow(2027, 1, 1);
      expect(promiseText('2026-12-31')).toBe('venció ayer');
    });

    it('counts local calendar days, whatever the hour', () => {
      setNow(2026, 11, 11, 23, 59);
      expect(promiseText('2026-11-11')).toBe('vence hoy');
      expect(promiseText('2026-11-12')).toBe('vence mañana');

      setNow(2026, 11, 11, 0, 0);
      expect(promiseText('2026-11-11')).toBe('vence hoy');
      expect(promiseText('2026-11-10')).toBe('venció ayer');
    });

    // Where clocks change in between, the days in the span are not all 24 hours long.
    it('counts whole days over a long span', () => {
      setNow(2026, 3, 1);
      expect(promiseText('2026-11-01')).toBe('vence en 245 días');
    });

    it('is empty without a promise', () => {
      expect(promiseText(null)).toBe('');
      expect(promiseText(undefined)).toBe('');
      expect(promiseText('')).toBe('');
    });
  });

  describe('errorMessage', () => {
    it('gives the message the API sent', () => {
      const error = new HttpErrorResponse({ status: 400, error: { message: 'La empresa es obligatoria' } });
      expect(errorMessage(error)).toBe('La empresa es obligatoria');
    });

    it('joins the list of messages of a validation error', () => {
      const error = new HttpErrorResponse({
        status: 400,
        error: { message: ['La empresa es obligatoria', 'La fecha no puede ser futura'] },
      });
      expect(errorMessage(error)).toBe('La empresa es obligatoria. La fecha no puede ser futura');
    });

    it('reports a lost connection for status 0', () => {
      const error = new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') });
      expect(errorMessage(error)).toBe('No hay conexión con el servidor');
    });

    // A proxy answering for a stopped API sends an HTML page, or nothing.
    it('falls back to the status when the body has no message', () => {
      // The API is restarting or down and the web server answers for it.
      for (const status of [502, 503, 504]) {
        expect(errorMessage(new HttpErrorResponse({ status, error: '<html>Bad Gateway</html>' }))).toBe('El servidor no está disponible. Intenta de nuevo en un momento.');
      }
      expect(errorMessage(new HttpErrorResponse({ status: 501, error: null }))).toBe('Error 501');
      expect(errorMessage(new HttpErrorResponse({ status: 500, error: null }))).toBe('Error 500');
      expect(errorMessage(new HttpErrorResponse({ status: 500, error: {} }))).toBe('Error 500');
    });

    // An agent on something only an administrator may do: the toast says it in Spanish.
    it('says in Spanish that something is not allowed', () => {
      const refused = new HttpErrorResponse({ status: 403, error: { statusCode: 403, error: 'Forbidden', message: 'Solo un administrador puede hacer esto.' } });
      expect(errorMessage(refused)).toBe('Solo un administrador puede hacer esto.');
      // Without a message of its own, from whatever answered.
      expect(errorMessage(new HttpErrorResponse({ status: 403, error: '<html>Forbidden</html>' }))).toBe('No tienes permiso para hacer esto. Pídeselo a un administrador.');
    });

    it('gives the message of any other Error', () => {
      expect(errorMessage(new Error('No se pudo leer la imagen'))).toBe('No se pudo leer la imagen');
    });

    it('has a generic message for a thrown value that is not an Error', () => {
      expect(errorMessage('boom')).toBe('Ocurrió un error inesperado');
      expect(errorMessage(null)).toBe('Ocurrió un error inesperado');
      expect(errorMessage(undefined)).toBe('Ocurrió un error inesperado');
    });
  });

  describe('pastedImages', () => {
    const picture = new File(['png'], 'celda.png', { type: 'image/png' });

    /** What a copy leaves on the clipboard: files and, when given, text. */
    function clipboard(files: File[], text?: string): DataTransfer {
      const data = new DataTransfer();
      for (const file of files) data.items.add(file);
      if (text !== undefined) data.setData('text/plain', text);
      return data;
    }

    /** Pastes into an element on the page and gives what a handler on the document would take from it. */
    function pasteInto(target: HTMLElement, data: DataTransfer | null, inside: HTMLElement = target): File[] {
      document.body.appendChild(target);
      let images: File[] | undefined;
      const handler = (event: ClipboardEvent): void => {
        images = pastedImages(event);
      };
      document.addEventListener('paste', handler);
      inside.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true }));
      document.removeEventListener('paste', handler);
      target.remove();
      if (!images) throw new Error('The paste did not reach the document');
      return images;
    }

    function editable(): HTMLElement {
      const element = document.createElement('div');
      element.contentEditable = 'true';
      return element;
    }

    // A cell copied from Excel: its text, and a picture of the cell next to it.
    it('gives no images when text is pasted into a field, so the browser pastes the text', () => {
      const cell = (): DataTransfer => clipboard([picture], 'Ferretería El Tornillo');
      expect(pasteInto(document.createElement('input'), cell())).toEqual([]);
      expect(pasteInto(document.createElement('textarea'), cell())).toEqual([]);
      expect(pasteInto(editable(), cell())).toEqual([]);
    });

    it('counts the elements inside an editable element as the field', () => {
      const field = editable();
      const bold = field.appendChild(document.createElement('b'));
      expect(pasteInto(field, clipboard([picture], 'texto'), bold)).toEqual([]);
    });

    it('gives the image of a screenshot pasted while a field has the focus', () => {
      expect(pasteInto(document.createElement('input'), clipboard([picture]))).toEqual([picture]);
      expect(pasteInto(document.createElement('textarea'), clipboard([picture]))).toEqual([picture]);
    });

    it('gives the images of a paste outside a field, with or without text', () => {
      expect(pasteInto(document.createElement('div'), clipboard([picture], 'texto'))).toEqual([picture]);
      expect(pasteInto(document.createElement('button'), clipboard([picture]))).toEqual([picture]);
    });

    it('gives only the files that are images', () => {
      const pdf = new File(['pdf'], 'factura.pdf', { type: 'application/pdf' });
      expect(pasteInto(document.createElement('div'), clipboard([pdf, picture]))).toEqual([picture]);
      expect(pasteInto(document.createElement('div'), clipboard([], 'solo texto'))).toEqual([]);
      expect(pasteInto(document.createElement('div'), null)).toEqual([]);
    });

    // A drop has no field to protect: every image dropped is taken, whatever else comes with it.
    it('leaves imagesFrom, used for drops, taking the images even next to text', () => {
      expect(imagesFrom(clipboard([picture], 'texto'))).toEqual([picture]);
    });
  });
});

describe('formatCaseDate', () => {
  it('writes the day of the case, and its time when it has one', () => {
    expect(formatCaseDate({ date: '2026-11-10', time: '14:35' })).toBe('10/11/2026 14:35');
    expect(formatCaseDate({ date: '2026-11-10', time: null })).toBe('10/11/2026');
    expect(formatCaseDate({ date: '2026-11-10' })).toBe('10/11/2026');
  });
});

// How two names are told to be the same one: a company written by hand, or read by the AI,
// against the ones of the catalog.
describe('nameKey', () => {
  it('ignores capitals, accents and the spaces around and between the words', () => {
    expect(nameKey('  CORPORACIÓN   Ñandú ')).toBe('corporacion nandu');
    expect(nameKey('Ferretería El Tornillo')).toBe(nameKey('ferreteria el tornillo'));
  });

  it('keeps apart the names that differ in anything else', () => {
    expect(nameKey('Acme S.A.')).not.toBe(nameKey('Acme SA'));
    expect(nameKey('Acme 2')).not.toBe(nameKey('Acme'));
  });

  it('is empty for a name of spaces alone', () => {
    expect(nameKey(' \t ')).toBe('');
  });
});

// What every select of a status or a priority offers, in the form of a case and in the filters.
describe('the options of the status and the priority', () => {
  it('are the statuses from the open ones to the resolved, each with its name', () => {
    expect(STATUS_OPTIONS).toEqual([
      { id: 'UNRESOLVED', label: 'Sin resolver' },
      { id: 'PENDING', label: 'Pendiente' },
      { id: 'RESOLVED', label: 'Resuelto' },
    ]);
  });

  it('are the priorities from the lowest, each with its name', () => {
    expect(PRIORITY_OPTIONS).toEqual([
      { id: 'LOW', label: 'Baja' },
      { id: 'MEDIUM', label: 'Media' },
      { id: 'HIGH', label: 'Alta' },
      { id: 'CRITICAL', label: 'Crítica' },
    ]);
  });
});
