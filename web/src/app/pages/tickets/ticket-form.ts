import type { Priority, TicketDetail, TicketInput, TicketStatus } from '../../core/api';

/*
 * The form of the case panel as plain data: the draft the person works on, what it would store in
 * the case, and the rules that tell what changed, what is unsaved and what keeps it from being
 * saved. No Angular here: the panel (ticket-panel.ts) holds these in signals.
 */

/** No case is older than this. A date before it is a year that is still being typed. */
const OLDEST_DATE = '1900-01-01';

/**
 * The fields of a case the form edits, each as its control holds it. The person works on this
 * copy: the case gets what they changed only with "Actualizar".
 */
export interface Draft {
  /** Empty, or before 1900, while a date is being typed. */
  date: string;
  /** Empty: the case has only its date. */
  time: string;
  companyId: number;
  description: string;
  status: TicketStatus;
  /** Null: nobody. */
  assigneeId: number | null;
  priority: Priority | null;
  moduleId: number | null;
  supportTypeIds: number[];
  /** Minutes as typed: not rounded yet, and null while the field is empty. */
  estimatedMinutes: number | null;
  spentMinutes: number | null;
  /** The "Promesa de entrega" switch. On with no date yet, it only shows the date field. */
  promiseOn: boolean;
  promisedDate: string;
  customerReply: string;
}

/** What a draft stores in the case: the fields "Actualizar" can send, each as it is sent. */
type Values = Required<
  Pick<
    TicketInput,
    | 'date'
    | 'time'
    | 'companyId'
    | 'description'
    | 'status'
    | 'assigneeId'
    | 'priority'
    | 'moduleId'
    | 'supportTypeIds'
    | 'estimatedMinutes'
    | 'spentMinutes'
    | 'promisedDate'
    | 'customerReply'
  >
>;
type Field = keyof Values;

/** The two fields of minutes: the estimate and the time spent. */
export type MinutesField = 'estimatedMinutes' | 'spentMinutes';

/**
 * The fields of minutes that hold a text that is not a number ("30e", "45 min"). The browser
 * reports such a field as empty, which in the draft is a case without an estimate, or with no
 * time spent: saved like that, the case would lose the minutes it has.
 */
export type NotNumber = Readonly<Record<MinutesField, boolean>>;
/** Both fields of minutes hold a number, or nothing. */
export const NO_NOT_NUMBER: NotNumber = { estimatedMinutes: false, spentMinutes: false };

/**
 * What the fields hold besides the draft: the browser reports a time half typed, and minutes
 * written as a text, as an empty field. Read from the fields themselves, since the draft cannot
 * have them.
 */
export interface Unreadable {
  timeHalfTyped: boolean;
  notNumber: NotNumber;
}

/** What keeps a draft from being saved, by the field that says it. */
export type Problems = Partial<Record<'date' | 'time' | 'description' | 'promisedDate' | MinutesField, string>>;

/** The draft the person works on, and the fields it is compared with to tell what they changed. */
export interface Form {
  draft: Draft;
  base: Draft;
}

/**
 * A text as a textarea gives it back once written: with every line end as "\n". Kept as stored,
 * a text with Windows line ends (from an import or an assistant) would never equal what its
 * field holds, and would look changed by the person.
 */
function asHeld(text: string | null): string {
  return (text ?? '').replace(/\r\n?/g, '\n');
}

/** The form as it shows a stored case. */
export function draftOf(ticket: TicketDetail): Draft {
  return {
    date: ticket.date,
    time: ticket.time ?? '',
    companyId: ticket.companyId,
    description: asHeld(ticket.description),
    status: ticket.status,
    assigneeId: ticket.assigneeId,
    priority: ticket.priority,
    moduleId: ticket.moduleId,
    supportTypeIds: ticket.supportTypes.map((type) => type.id),
    estimatedMinutes: ticket.estimatedMinutes,
    spentMinutes: ticket.spentMinutes,
    promiseOn: ticket.promisedDate !== null,
    promisedDate: ticket.promisedDate ?? '',
    customerReply: asHeld(ticket.customerReply),
  };
}

/** Minutes typed in a number field as a case stores them: whole, and not below zero. Null for an empty field. */
function wholeMinutes(typed: number | null): number | null {
  return typed === null || !Number.isFinite(typed) ? null : Math.max(0, Math.round(typed));
}

/**
 * What a draft would leave in the case. Two drafts are compared through this, so that only what
 * would be stored differently counts as a change: not the spaces around a text, nor the same
 * minutes written another way ("30.4").
 */
function valuesOf(draft: Draft): Values {
  return {
    date: draft.date,
    time: draft.time || null,
    companyId: draft.companyId,
    description: draft.description.trim(),
    status: draft.status,
    assigneeId: draft.assigneeId,
    priority: draft.priority,
    moduleId: draft.moduleId,
    supportTypeIds: draft.supportTypeIds,
    estimatedMinutes: wholeMinutes(draft.estimatedMinutes),
    // "Real" always has a number: emptied, it goes back to zero.
    spentMinutes: wholeMinutes(draft.spentMinutes) ?? 0,
    // The switch on with no date chosen is no promise yet.
    promisedDate: draft.promiseOn && draft.promisedDate ? draft.promisedDate : null,
    // The reply can be left empty: it is then stored as none.
    customerReply: draft.customerReply.trim() || null,
  };
}

/** The support types of a case are a set: the order they were chosen in says nothing. */
function equal(a: Values[Field], b: Values[Field]): boolean {
  return Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((id) => b.includes(id)) : a === b;
}

/** The fields of the case two drafts would store differently. */
export function changed(draft: Draft, other: Draft): Field[] {
  const mine = valuesOf(draft);
  const theirs = valuesOf(other);
  return (Object.keys(mine) as Field[]).filter((field) => !equal(mine[field], theirs[field]));
}

/** What "Actualizar" would send of the case: the fields the draft changes from `base`, each as it is stored, and nothing else. */
export function changesOf(draft: Draft, base: Draft): TicketInput {
  const values = valuesOf(draft);
  return Object.fromEntries(changed(draft, base).map((field) => [field, values[field]]));
}

/**
 * The fields of the form hold something the case does not have. Besides what would be sent, the
 * promise switch turned on with no date yet, a time half typed and minutes that are not a
 * number: nothing to save, but the person's own, which the form must not lose by following the
 * case.
 */
export function isDirty(draft: Draft, base: Draft, unreadable: Unreadable): boolean {
  const { timeHalfTyped, notNumber } = unreadable;
  return changed(draft, base).length > 0 || draft.promiseOn !== base.promiseOn || timeHalfTyped || notNumber.estimatedMinutes || notNumber.spentMinutes;
}

/** What a field that a new case needs says when the form was sent without it ("Nuevo caso", the case the AI drafted). */
export const MISSING_COMPANY = 'Elige una empresa.';
export const MISSING_DESCRIPTION = 'Escribe la descripción.';

/** What the API answers to a case dated after today: said next to the date before it is sent. */
export const FUTURE_DATE = 'La fecha del caso no puede ser posterior a hoy';

/**
 * What is wrong with the date of a case, `YYYY-MM-DD`, on `today`: a problem cannot be reported in
 * the future, and the `max` of a date field does not stop a date typed in it. Undefined when nothing is.
 */
export function futureDate(date: string, today: string): string | undefined {
  return date > today ? FUTURE_DATE : undefined;
}

/** What keeps the draft from being saved as it stands, on `today`. Each is said next to its field. */
export function problemsOf(draft: Draft, unreadable: Unreadable, today: string): Problems {
  const problems: Problems = {};
  // Empty while a day is being typed, before 1900 while it is the year.
  if (draft.date < OLDEST_DATE) problems.date = 'Escribe la fecha completa.';
  else if (futureDate(draft.date, today)) problems.date = FUTURE_DATE;
  if (unreadable.timeHalfTyped) problems.time = 'Completa la hora o quítala.';
  if (!draft.description.trim()) problems.description = 'La descripción no puede quedar vacía.';
  if (draft.promiseOn && draft.promisedDate < OLDEST_DATE) problems.promisedDate = 'Elige la fecha prometida';
  if (unreadable.notNumber.estimatedMinutes) problems.estimatedMinutes = 'Escribe solo el número de minutos.';
  if (unreadable.notNumber.spentMinutes) problems.spentMinutes = 'Escribe solo el número de minutos.';
  return problems;
}

/**
 * The draft with its minutes as they would be stored ("30.4" is 30, "-5" is zero, and "Real"
 * emptied goes back to zero), so that what the fields show is what is saved. A "Real" that holds
 * a text that is not a number stays as it was typed, to be corrected: the zero would take its
 * place without a word.
 */
export function tidied(draft: Draft, notNumber: NotNumber): Draft {
  return {
    ...draft,
    estimatedMinutes: wholeMinutes(draft.estimatedMinutes),
    spentMinutes: notNumber.spentMinutes ? draft.spentMinutes : (wholeMinutes(draft.spentMinutes) ?? 0),
  };
}

/** `draft` with one field of the case as `source` has it. The promise is its switch and its date. */
function withField(draft: Draft, source: Draft, field: Field): Draft {
  return field === 'promisedDate' ? { ...draft, promiseOn: source.promiseOn, promisedDate: source.promisedDate } : { ...draft, [field]: source[field] };
}

/**
 * The form once a version of the case arrives with `fields`. What the version brings, compared
 * with `since`, goes into the base. It goes into the draft too, except in the fields the person
 * changed: those are theirs, and stay as they have them.
 */
export function withVersion(form: Form, fields: Draft, since: Draft): Form {
  const brought = changed(fields, since);
  const mine = changed(form.draft, form.base);
  return {
    base: brought.reduce((base, field) => withField(base, fields, field), form.base),
    draft: brought.filter((field) => !mine.includes(field)).reduce((draft, field) => withField(draft, fields, field), form.draft),
  };
}

/**
 * The form after a save of `sent`: the case as it is stored now, `fields`, everywhere. Except
 * what the person changed in `draft` while the save was on its way: that is theirs, and stays as a
 * change still to save.
 */
export function afterSave(fields: Draft, draft: Draft, sent: Draft): Form {
  return { base: fields, draft: changed(draft, sent).reduce((form, field) => withField(form, draft, field), fields) };
}
