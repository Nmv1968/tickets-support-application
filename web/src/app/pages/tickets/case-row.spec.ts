import { formatDateTime, todayIso } from '../../core/ui';
import { ticket } from '../../testing/fixtures';
import { caseRow } from './case-row';

const USERS = new Map([[2, 'Luis']]);

/** The day `days` from today, `YYYY-MM-DD`. */
function dayFromToday(days: number): string {
  const day = new Date(`${todayIso()}T12:00:00`);
  day.setDate(day.getDate() + days);
  return [day.getFullYear(), day.getMonth() + 1, day.getDate()].map((n) => String(n).padStart(2, '0')).join('-');
}

// A row of the list is written out once per case, and the template only puts its texts on screen.
describe('caseRow', () => {
  it('writes out what the row and the card of a case say of it', () => {
    const row = caseRow(
      ticket({
        date: '2026-11-05',
        time: '14:35',
        createdAt: '2026-11-06T15:00:00.000Z',
        priority: 'CRITICAL',
        assignees: [
          { id: 4, name: 'Ana' },
          { id: 5, name: 'Luis' },
        ],
        moduleName: 'Ventas / Facturas',
        dueAt: '2026-11-06T10:00:00.000Z',
        estimatedMinutes: 95,
        spentMinutes: 30,
        lastNote: 'Se llamó al cliente',
        createdById: 2,
        lastActivityAt: '2026-11-07T08:00:00.000Z',
      }),
      USERS,
    );

    expect(row.day).toBe('05/11/2026');
    expect(row.dayAndTime).toBe('05/11/2026 14:35');
    expect(row.registered).toBe('Registrado el ' + formatDateTime('2026-11-06T15:00:00.000Z'));
    expect(row.priorityClass).toBe('text-danger');
    expect(row.lastActivityAgo).toMatch(/^hace \d+ días$/);
    expect(row.text).toEqual({
      createdAt: '06/11/2026',
      // Every responsible, as the API orders them: by name.
      assignee: 'Ana, Luis',
      priority: 'Crítica',
      module: 'Ventas / Facturas',
      promisedDate: '',
      dueAt: formatDateTime('2026-11-06T10:00:00.000Z'),
      estimatedMinutes: '1 h 35 min',
      spentMinutes: '30 min',
      lastNote: 'Se llamó al cliente',
      createdBy: 'Luis',
      lastActivityAt: formatDateTime('2026-11-07T08:00:00.000Z'),
    });
  });

  it('leaves empty what a case does not have', () => {
    const row = caseRow(ticket({ time: null, priority: null, moduleName: null, dueAt: null, estimatedMinutes: null, spentMinutes: 0, lastNote: null, createdById: null }), USERS);

    expect(row.dayAndTime).toBe(row.day);
    expect(row.archived).toBe('');
    expect(row.priorityClass).toBe('');
    for (const column of ['assignee', 'priority', 'module', 'promisedDate', 'dueAt', 'estimatedMinutes', 'spentMinutes', 'lastNote', 'createdBy'] as const) {
      expect(row.text[column]).withContext(column).toBe('');
    }
  });

  it('says who registered the case only when that user is known, and an estimate of zero as such', () => {
    expect(caseRow(ticket({ createdById: 9 }), USERS).text.createdBy).toBe('');
    expect(caseRow(ticket({ estimatedMinutes: 0 }), USERS).text.estimatedMinutes).toBe('0 min');
  });

  it('says when an archived case was archived', () => {
    expect(caseRow(ticket({ archivedAt: '2026-11-08T09:00:00.000Z' }), USERS).archived).toBe('Archivado el ' + formatDateTime('2026-11-08T09:00:00.000Z'));
  });

  describe('the delivery promise', () => {
    it('of an open case: its day, how far it is, in the colour of its state', () => {
      const promised = dayFromToday(3);
      const row = caseRow(ticket({ promisedDate: promised, promiseState: 'soon' }), USERS);
      const day = promised.split('-').reverse().join('/');

      expect(row.promiseDay).toBe(day);
      expect(row.promiseDue).toBe('vence en 3 días');
      expect(row.promiseClass).toBe('text-primary');
      expect(row.text.promisedDate).toBe(`${day} · vence en 3 días`);
    });

    it('of a resolved case, which has no state against it: only its day, in grey', () => {
      const row = caseRow(ticket({ status: 'RESOLVED', promisedDate: '2026-12-24', promiseState: null }), USERS);

      expect(row.promiseDay).toBe('24/12/2026');
      expect(row.promiseDue).toBe('');
      expect(row.promiseClass).toBe('text-muted');
      expect(row.text.promisedDate).toBe('24/12/2026');
    });
  });
});
