import type { Ticket } from '../../core/api';
import type { IconName } from '../../core/icons';
import { PRIORITY_CLASS, PRIORITY_ICON, PRIORITY_LABEL, PROMISE_CLASS, PROMISE_ICON, formatCaseDate, formatDateTime, formatDay, formatMinutes, formatMomentDay, promiseText, timeAgo } from '../../core/ui';
import type { ColumnId } from './ticket-columns';

/**
 * A case as the list shows it, in a row of the table or on a phone card: its texts written out
 * once, when the list arrives, and not again on every redraw of the page.
 *
 * The ones that count from today ("vence mañana", "hace 20 min") are as of that moment, like the
 * flags the server sends with the case (overdue, forgotten, the state of its promise).
 */
export interface CaseRow {
  readonly ticket: Ticket;
  /** The day of the case, "05/11/2026". */
  readonly day: string;
  /** The same with its time, when it has one: "05/11/2026 14:35". */
  readonly dayAndTime: string;
  /** "Archivado el …", what its "Archivado" badge says to the pointer. Empty for a case that is not archived. */
  readonly archived: string;
  /** "Registrado el …", what its day of registration says to the pointer. */
  readonly registered: string;
  /** The icon and the colour of its priority (see PRIORITY_ICON). Only shown with a priority: the colour is empty without one. */
  readonly priorityIcon: IconName;
  readonly priorityClass: string;
  /** Its delivery promise: the day, how far it is ("vence mañana", only while it is open), its icon and its colour. */
  readonly promiseDay: string;
  readonly promiseDue: string;
  readonly promiseIcon: IconName;
  readonly promiseClass: string;
  /** "hace 20 min": its last activity, as it says to the pointer. */
  readonly lastActivityAgo: string;
  /**
   * What each column of plain text says of the case: in the table, and on the lines of a card.
   * Empty when the case has nothing there; the other columns have no entry.
   */
  readonly text: Readonly<Partial<Record<ColumnId, string>>>;
}

/** The case as its row shows it. `userNames` names the users by id, for "Registrado por". */
export function caseRow(t: Ticket, userNames: ReadonlyMap<number, string>): CaseRow {
  const promiseDay = formatDay(t.promisedDate);
  const promiseDue = t.promiseState ? promiseText(t.promisedDate) : '';
  return {
    ticket: t,
    day: formatDay(t.date),
    dayAndTime: formatCaseDate(t),
    archived: t.archivedAt ? 'Archivado el ' + formatDateTime(t.archivedAt) : '',
    registered: 'Registrado el ' + formatDateTime(t.createdAt),
    priorityIcon: t.priority ? PRIORITY_ICON[t.priority] : 'flag',
    priorityClass: t.priority ? PRIORITY_CLASS[t.priority] : '',
    promiseDay,
    promiseDue,
    promiseIcon: t.promiseState ? PROMISE_ICON[t.promiseState] : 'calendar-clock-outline',
    promiseClass: t.promiseState ? PROMISE_CLASS[t.promiseState] : 'text-muted',
    lastActivityAgo: timeAgo(t.lastActivityAt),
    text: {
      createdAt: formatMomentDay(t.createdAt),
      priority: t.priority ? PRIORITY_LABEL[t.priority] : '',
      module: t.moduleName ?? '',
      promisedDate: t.promisedDate ? promiseDay + (promiseDue ? ' · ' + promiseDue : '') : '',
      dueAt: formatDateTime(t.dueAt),
      estimatedMinutes: t.estimatedMinutes === null ? '' : formatMinutes(t.estimatedMinutes),
      // Zero is a case nobody has put time on: nothing to say.
      spentMinutes: t.spentMinutes ? formatMinutes(t.spentMinutes) : '',
      lastNote: t.lastNote ?? '',
      createdBy: (t.createdById !== null && userNames.get(t.createdById)) || '',
      lastActivityAt: formatDateTime(t.lastActivityAt),
    },
  };
}
