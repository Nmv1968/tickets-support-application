import { Priority, TicketStatus } from '@prisma/client';
import { ArrayMaxSize, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateBy } from 'class-validator';
import { ASSIGNEES } from '../assignees/assignees.service';
import { MAX_ID } from '../common/id.pipe';
import { isDateOnly, isTimeOnly } from '../common/labels';
import { tooLong } from '../common/validation';
import { COMPANIES } from '../companies/companies.service';
import { SUPPORT_TYPES } from '../support-types/support-types.service';

// The body of a request that creates or edits a case, checked before it reaches the service.

/** Accepts only a day that exists, written `YYYY-MM-DD`. `message` is the text of the 400 the person reads. */
function IsDateOnly(message: string): PropertyDecorator {
  return ValidateBy({ name: 'isDateOnly', validator: { validate: isDateOnly } }, { message });
}

/** Accepts only a time of day written `HH:mm`, 24-hour clock. */
function IsTimeOnly(message: string): PropertyDecorator {
  return ValidateBy({ name: 'isTimeOnly', validator: { validate: isTimeOnly } }, { message });
}

/** The most characters of the description of a case, of an observation and of the reply for the client. The import cuts what is longer. */
export const TEXT_MAX = 5000;

/** The 400s of an observation without text and of one too long: the first one of a new case, and those added later (`NoteDto`). */
export const EMPTY_NOTE = 'La observación está vacía';
export const NOTE_TOO_LONG = tooLong('La observación', TEXT_MAX);

/**
 * The 400 of a case that points at an entry its catalog does not have: the one of each catalog
 * when it is asked for an entry it does not have. The service says it of an id that no entry has
 * (`TicketsService.lookups`), and the checks here of an id that none can have.
 */
export const MISSING_ENTRY = {
  company: COMPANIES.messages.missing,
  assignee: ASSIGNEES.messages.missing,
  module: 'El módulo no existe',
  supportType: SUPPORT_TYPES.messages.missing,
} as const;

// Texts of the 400 the person reads when a value of a case is too long or out of range.
const MAX_MINUTES = 1_000_000;
const minutesRange = (field: string): { message: string } => ({ message: `${field} debe estar entre 0 y ${MAX_MINUTES} minutos` });
// An id that no record can have. Passed on, the database rejects the number and the answer is a 500.
const noCompany = { message: MISSING_ENTRY.company };
const noPerson = { message: MISSING_ENTRY.assignee, each: true };
const noModule = { message: MISSING_ENTRY.module };
const noSupportType = { message: MISSING_ENTRY.supportType, each: true };

/** Support types one case can carry. */
export const MAX_SUPPORT_TYPES = 20;
/** Responsibles one case can have. */
export const MAX_ASSIGNEES = 20;

/**
 * Used for both create and update. Create additionally requires company and description.
 * `@IsOptional()` also lets a null through. Where the case can be left without the value, null
 * removes it (see each field); for every other field the service reads null as "not sent".
 */
export class TicketInput {
  /** Day the client reported the problem. The registration moment (`createdAt`) is not an input. */
  @IsOptional() @IsDateOnly('La fecha del caso no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.') date?: string;
  /** Time of day the client reported it, `HH:mm`. Optional; null removes it. */
  @IsOptional() @IsTimeOnly('La hora del caso no es válida. Usa el formato HH:MM, de 00:00 a 23:59.') time?: string | null;
  /** A company of the catalog. */
  @IsOptional() @IsInt() @Min(1, noCompany) @Max(MAX_ID, noCompany) companyId?: number;
  @IsOptional() @IsString() @MaxLength(TEXT_MAX, tooLong('La descripción', TEXT_MAX)) description?: string;
  @IsOptional() @IsEnum(TicketStatus) status?: TicketStatus;
  /**
   * Responsibles of the case, as ids of the catalog, as the support types: the whole set, which on
   * an edit replaces the one the case had. An empty list leaves the case without any, which is also
   * how a new case starts. A repeated id counts once.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_ASSIGNEES, { message: `Un caso no puede tener más de ${MAX_ASSIGNEES} responsables` })
  @IsInt({ each: true })
  @Min(1, noPerson)
  @Max(MAX_ID, noPerson)
  assigneeIds?: number[];
  /**
   * "Tipos de soporte" of the case, as ids of the catalog. The whole set: on an edit it replaces
   * the one the case had, and an empty list leaves the case without any. A repeated id counts once.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SUPPORT_TYPES, { message: `Un caso no puede tener más de ${MAX_SUPPORT_TYPES} tipos de soporte` })
  @IsInt({ each: true })
  @Min(1, noSupportType)
  @Max(MAX_ID, noSupportType)
  supportTypeIds?: number[];
  /** True archives the case and false brings it back. */
  @IsOptional() @IsBoolean() archived?: boolean;
  @IsOptional() @IsEnum(Priority) priority?: Priority | null;
  @IsOptional() @IsInt() @Min(0, minutesRange('El tiempo estimado')) @Max(MAX_MINUTES, minutesRange('El tiempo estimado')) estimatedMinutes?: number | null;
  @IsOptional() @IsInt() @Min(0, minutesRange('El tiempo real')) @Max(MAX_MINUTES, minutesRange('El tiempo real')) spentMinutes?: number;
  /** Null leaves the case without a module. */
  @IsOptional() @IsInt() @Min(1, noModule) @Max(MAX_ID, noModule) moduleId?: number | null;
  /** "Promesa de entrega": day promised to the client, `YYYY-MM-DD`. Null removes the promise. */
  @IsOptional()
  @IsDateOnly('La promesa de entrega no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.')
  promisedDate?: string | null;
  /** Message for the client. Null or empty clears it. */
  @IsOptional() @IsString() @MaxLength(TEXT_MAX, tooLong('La respuesta para el cliente', TEXT_MAX)) customerReply?: string | null;
  /** Create only: first "observación". */
  @IsOptional() @IsString() @MaxLength(TEXT_MAX, NOTE_TOO_LONG) note?: string;
  @IsOptional() @IsBoolean() aiGenerated?: boolean;
}
