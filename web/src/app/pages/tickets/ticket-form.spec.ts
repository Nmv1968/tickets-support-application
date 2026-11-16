import { ticket } from '../../testing/fixtures';
import { FUTURE_DATE, NO_NOT_NUMBER, afterSave, changed, changesOf, draftOf, futureDate, isDirty, problemsOf, tidied, withVersion } from './ticket-form';
import type { Draft, Unreadable } from './ticket-form';

/** Case 7 as the form shows it, with what a test is about changed. */
function draft(changes: Partial<Draft> = {}): Draft {
  return { ...draftOf(ticket({ estimatedMinutes: 30, spentMinutes: 15 })), ...changes };
}

/** Fields that hold nothing the draft cannot have. */
const READABLE: Unreadable = { timeHalfTyped: false, notNumber: NO_NOT_NUMBER };

/** The day the problems are looked at: after the date of case 7. */
const TODAY = '2026-11-14';

// The rules of the form of the case panel, as plain data: what the person changed, what would be
// sent, what is unsaved and what keeps the draft from being saved. The panel spec tries the same
// rules on the screen.
describe('ticket form', () => {
  describe('draftOf', () => {
    it('shows a stored case as its controls hold it', () => {
      const stored = ticket({
        time: null,
        supportTypes: [
          { id: 2, name: 'Falla del sistema', color: '#b91c1c' },
          { id: 1, name: 'Capacitación', color: '#12b76a' },
        ],
        promisedDate: null,
        customerReply: null,
      });

      expect(draftOf(stored)).toEqual({
        date: '2026-11-05',
        // No time: an empty field.
        time: '',
        companyId: 1,
        description: 'No imprime',
        status: 'PENDING',
        assigneeId: null,
        priority: null,
        moduleId: null,
        supportTypeIds: [2, 1],
        estimatedMinutes: null,
        spentMinutes: 0,
        // No promise: the switch off, and no date.
        promiseOn: false,
        promisedDate: '',
        customerReply: '',
      });
    });

    it('turns a promise into its switch on and its date', () => {
      expect(draftOf(ticket({ promisedDate: '2026-12-24' }))).toEqual(jasmine.objectContaining({ promiseOn: true, promisedDate: '2026-12-24' }));
    });

    // As a textarea gives them back: kept with Windows line ends, they would never equal what the field holds.
    it('writes every line end of its texts as "\\n"', () => {
      const fields = draftOf(ticket({ description: 'No imprime\r\ndesde el lunes\rni el martes', customerReply: 'Hola\r\nListo' }));

      expect(fields.description).toBe('No imprime\ndesde el lunes\nni el martes');
      expect(fields.customerReply).toBe('Hola\nListo');
    });
  });

  describe('changed', () => {
    it('is nothing for a draft as the case has it', () => {
      expect(changed(draft(), draft())).toEqual([]);
    });

    it('names the fields the case would store differently', () => {
      expect(changed(draft({ description: 'No imprime desde el lunes', priority: 'HIGH' }), draft())).toEqual(['description', 'priority']);
    });

    it('leaves out what would be stored the same: the spaces around a text, minutes written another way, types chosen in another order', () => {
      const base = draft({ supportTypeIds: [1, 2], customerReply: 'Ya puede imprimir.' });
      const same = draft({ description: '  No imprime ', estimatedMinutes: 30.4, supportTypeIds: [2, 1], customerReply: ' Ya puede imprimir. ' });

      expect(changed(same, base)).toEqual([]);
    });

    it('tells a type taken off, and one put in its place', () => {
      expect(changed(draft({ supportTypeIds: [1] }), draft({ supportTypeIds: [1, 2] }))).toEqual(['supportTypeIds']);
      expect(changed(draft({ supportTypeIds: [1, 3] }), draft({ supportTypeIds: [1, 2] }))).toEqual(['supportTypeIds']);
    });

    it('takes an emptied "Real" for zero, an emptied reply for none, and the promise switch on with no date for no promise', () => {
      const base = draft({ spentMinutes: 0 });

      expect(changed({ ...base, spentMinutes: null }, base)).toEqual([]);
      expect(changed({ ...base, customerReply: '   ' }, base)).toEqual([]);
      expect(changed({ ...base, promiseOn: true, promisedDate: '' }, base)).toEqual([]);
    });

    it('takes a date chosen with the promise switch off for no promise', () => {
      expect(changed(draft({ promiseOn: false, promisedDate: '2026-12-24' }), draft())).toEqual([]);
      expect(changed(draft({ promiseOn: true, promisedDate: '2026-12-24' }), draft())).toEqual(['promisedDate']);
    });
  });

  describe('changesOf', () => {
    it('is what "Actualizar" sends: the fields that changed, as the case stores them, and nothing else', () => {
      const base = draft({ time: '14:30' });
      const edited = draft({ time: '', description: ' No imprime desde el lunes ', estimatedMinutes: 45.6, assigneeId: 4 });

      expect(changesOf(edited, base)).toEqual({ time: null, description: 'No imprime desde el lunes', estimatedMinutes: 46, assigneeId: 4 });
    });

    it('sends a promise taken off, an emptied estimate and an emptied reply as none, and an emptied "Real" as zero', () => {
      const base = draft({ promiseOn: true, promisedDate: '2026-12-24', customerReply: 'Ya puede imprimir.' });
      const emptied = draft({ promiseOn: false, estimatedMinutes: null, spentMinutes: null, customerReply: '' });

      expect(changesOf(emptied, base)).toEqual({ promisedDate: null, estimatedMinutes: null, spentMinutes: 0, customerReply: null });
    });

    it('is empty with nothing changed', () => {
      expect(changesOf(draft({ description: 'No imprime ' }), draft())).toEqual({});
    });
  });

  describe('isDirty', () => {
    it('with something to send', () => {
      expect(isDirty(draft({ status: 'RESOLVED' }), draft(), READABLE)).toBeTrue();
    });

    it('is not, with what would be stored the same', () => {
      expect(isDirty(draft({ description: 'No imprime ' }), draft(), READABLE)).toBeFalse();
    });

    // Nothing to save in these, but the person's own: the form must not lose them by following the case.
    it('with the promise switch turned on and no date chosen yet', () => {
      expect(isDirty(draft({ promiseOn: true }), draft(), READABLE)).toBeTrue();
    });

    it('with a time half typed, or minutes written as a text that is not a number', () => {
      expect(isDirty(draft(), draft(), { ...READABLE, timeHalfTyped: true })).toBeTrue();
      expect(isDirty(draft(), draft(), { ...READABLE, notNumber: { estimatedMinutes: true, spentMinutes: false } })).toBeTrue();
      expect(isDirty(draft(), draft(), { ...READABLE, notNumber: { estimatedMinutes: false, spentMinutes: true } })).toBeTrue();
    });
  });

  describe('problemsOf', () => {
    it('is nothing for a draft that can be saved', () => {
      expect(problemsOf(draft({ promiseOn: true, promisedDate: '2026-12-24' }), READABLE, TODAY)).toEqual({});
    });

    // Empty while a day is being typed, a year before 1900 while it is the year.
    it('asks for the whole date of the case', () => {
      for (const typed of ['', '0002-11-05', '0202-11-05']) {
        expect(problemsOf(draft({ date: typed }), READABLE, TODAY)).withContext(typed).toEqual({ date: 'Escribe la fecha completa.' });
      }
      expect(problemsOf(draft({ date: '1900-01-01' }), READABLE, TODAY)).toEqual({});
    });

    // The max of the date field does not stop a date typed in it: the API refused it, in a toast that went away.
    it('does not take a case dated after today, with the words of the API', () => {
      expect(FUTURE_DATE).toBe('La fecha del caso no puede ser posterior a hoy');
      expect(problemsOf(draft({ date: '2026-11-15' }), READABLE, TODAY)).toEqual({ date: FUTURE_DATE });
      expect(problemsOf(draft({ date: '2031-01-01' }), READABLE, TODAY)).toEqual({ date: FUTURE_DATE });
      expect(problemsOf(draft({ date: TODAY }), READABLE, TODAY)).toEqual({});
    });

    it('tells a date after today apart from one that is not: futureDate', () => {
      expect(futureDate('2026-11-15', TODAY)).toBe(FUTURE_DATE);
      expect(futureDate(TODAY, TODAY)).toBeUndefined();
      // An empty field: the new case is of today.
      expect(futureDate('', TODAY)).toBeUndefined();
    });

    it('asks to finish a time half typed, or to take it off', () => {
      expect(problemsOf(draft(), { ...READABLE, timeHalfTyped: true }, TODAY)).toEqual({ time: 'Completa la hora o quítala.' });
    });

    it('does not let the description be emptied, spaces aside', () => {
      expect(problemsOf(draft({ description: '   ' }), READABLE, TODAY)).toEqual({ description: 'La descripción no puede quedar vacía.' });
    });

    it('asks for the promised date while the switch is on, and not once it is off', () => {
      for (const typed of ['', '0202-12-24']) {
        expect(problemsOf(draft({ promiseOn: true, promisedDate: typed }), READABLE, TODAY)).withContext(typed).toEqual({ promisedDate: 'Elige la fecha prometida' });
      }
      expect(problemsOf(draft({ promiseOn: false, promisedDate: '' }), READABLE, TODAY)).toEqual({});
    });

    it('asks for numbers in the field of minutes that holds a text', () => {
      expect(problemsOf(draft(), { ...READABLE, notNumber: { estimatedMinutes: true, spentMinutes: false } }, TODAY)).toEqual({ estimatedMinutes: 'Escribe solo el número de minutos.' });
      expect(problemsOf(draft(), { ...READABLE, notNumber: { estimatedMinutes: false, spentMinutes: true } }, TODAY)).toEqual({ spentMinutes: 'Escribe solo el número de minutos.' });
    });

    it('says every problem at once, each by its field', () => {
      const problems = problemsOf(draft({ date: '', description: '' }), { timeHalfTyped: true, notNumber: { estimatedMinutes: true, spentMinutes: true } }, TODAY);

      expect(Object.keys(problems).sort()).toEqual(['date', 'description', 'estimatedMinutes', 'spentMinutes', 'time']);
    });
  });

  describe('tidied', () => {
    it('gives the minutes as the case would store them: whole, and not below zero', () => {
      expect(tidied(draft({ estimatedMinutes: 45.6, spentMinutes: -5 }), NO_NOT_NUMBER)).toEqual(draft({ estimatedMinutes: 46, spentMinutes: 0 }));
    });

    it('leaves an emptied estimate empty, and puts an emptied "Real" back to zero', () => {
      expect(tidied(draft({ estimatedMinutes: null, spentMinutes: null }), NO_NOT_NUMBER)).toEqual(draft({ estimatedMinutes: null, spentMinutes: 0 }));
    });

    // The browser reports a text as an empty field: the zero would take its place without a word.
    it('does not turn a "Real" that holds a text into a zero', () => {
      expect(tidied(draft({ spentMinutes: null }), { estimatedMinutes: false, spentMinutes: true }).spentMinutes).toBeNull();
    });

    it('changes nothing else', () => {
      const edited = draft({ description: ' No imprime desde el lunes ', promiseOn: true });

      expect(tidied(edited, NO_NOT_NUMBER)).toEqual(edited);
    });
  });

  describe('withVersion', () => {
    it('brings what the version changed into the base and into the draft', () => {
      const form = { draft: draft(), base: draft() };
      const next = draft({ status: 'RESOLVED', priority: 'HIGH' });

      expect(withVersion(form, next, draft())).toEqual({ draft: next, base: next });
    });

    it('leaves in the draft the fields the person changed; the base takes the version, so that they are still a change', () => {
      const form = { draft: draft({ priority: 'LOW', description: 'No imprime desde el lunes' }), base: draft() };
      const next = draft({ priority: 'HIGH', status: 'RESOLVED' });
      const taken = withVersion(form, next, draft());

      expect(taken.draft).toEqual(draft({ priority: 'LOW', description: 'No imprime desde el lunes', status: 'RESOLVED' }));
      expect(taken.base).toEqual(next);
    });

    it('brings only what changed since `since`: what the form does not have stays as it is', () => {
      const stale = draft({ moduleId: 2 });
      const form = { draft: draft({ description: 'No imprime desde el lunes' }), base: draft() };
      // Stored as `stale` before, and now with the status changed too: only the status is brought.
      const taken = withVersion(form, draft({ moduleId: 2, status: 'RESOLVED' }), stale);

      expect(taken.base).toEqual(draft({ status: 'RESOLVED' }));
      expect(taken.draft).toEqual(draft({ description: 'No imprime desde el lunes', status: 'RESOLVED' }));
    });

    it('brings a promise as its switch and its date', () => {
      const form = { draft: draft(), base: draft() };
      const promised = draft({ promiseOn: true, promisedDate: '2026-12-24' });

      expect(withVersion(form, promised, draft()).draft).toEqual(promised);
      expect(withVersion({ draft: promised, base: promised }, draft(), promised).draft).toEqual(draft());
    });
  });

  describe('afterSave', () => {
    it('shows the case as it is stored now, everywhere', () => {
      const sent = draft({ priority: 'HIGH' });
      const stored = draft({ priority: 'HIGH', spentMinutes: 20 });

      expect(afterSave(stored, sent, sent)).toEqual({ draft: stored, base: stored });
    });

    it('keeps what the person changed while the save was on its way, still to save', () => {
      const sent = draft({ priority: 'HIGH' });
      const stored = draft({ priority: 'HIGH' });
      const saved = afterSave(stored, { ...sent, description: 'No imprime desde el lunes' }, sent);

      expect(saved.base).toEqual(stored);
      expect(saved.draft).toEqual(draft({ priority: 'HIGH', description: 'No imprime desde el lunes' }));
      expect(changed(saved.draft, saved.base)).toEqual(['description']);
    });
  });
});
