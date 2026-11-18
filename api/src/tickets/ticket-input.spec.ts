import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ASSIGNEES } from '../assignees/assignees.service';
import { validationPipe } from '../common/validation';
import { COMPANIES } from '../companies/companies.service';
import { SUPPORT_TYPES } from '../support-types/support-types.service';
import { MISSING_ENTRY, TicketInput } from './ticket-input';

/** What the person would read for this request body: the messages of the 400, none when it is accepted. */
const errors = async (input: Record<string, unknown>): Promise<string[]> =>
  (await validate(plainToInstance(TicketInput, input))).flatMap((error) => Object.values(error.constraints ?? {}));

describe('ticket input dates', () => {
  it('accepts real days written YYYY-MM-DD, and null to remove the promise', async () => {
    expect(await errors({ date: '2026-11-02', promisedDate: '2028-02-29' })).toEqual([]);
    expect(await errors({ promisedDate: null })).toEqual([]);
  });

  it('rejects days that do not exist, with a message in Spanish', async () => {
    expect(await errors({ date: '2026-13-45' })).toEqual(['La fecha del caso no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.']);
    expect(await errors({ promisedDate: '2026-02-30' })).toEqual([
      'La promesa de entrega no es válida. Debe ser una fecha real con el formato AAAA-MM-DD.',
    ]);
  });

  it('rejects any other way of writing a date', async () => {
    for (const date of ['2/11/2026', '2026-11-2', '2026-11-02T10:00:00Z', '', 20261102]) {
      expect(await errors({ date })).toHaveLength(1);
    }
  });
});

describe('ticket input limits', () => {
  it('says in Spanish which text is too long', async () => {
    expect(await errors({ description: 'x'.repeat(5001) })).toEqual(['La descripción no puede tener más de 5000 caracteres']);
    expect(await errors({ customerReply: 'x'.repeat(5001) })).toEqual(['La respuesta para el cliente no puede tener más de 5000 caracteres']);
    expect(await errors({ note: 'x'.repeat(5001) })).toEqual(['La observación no puede tener más de 5000 caracteres']);
    expect(await errors({ description: 'x'.repeat(5000), customerReply: 'x'.repeat(5000), note: 'x'.repeat(5000) })).toEqual([]);
  });

  it('says in Spanish that the minutes are out of range', async () => {
    const estimated = 'El tiempo estimado debe estar entre 0 y 1000000 minutos';
    const spent = 'El tiempo real debe estar entre 0 y 1000000 minutos';
    expect(await errors({ estimatedMinutes: 1_000_001 })).toEqual([estimated]);
    expect(await errors({ estimatedMinutes: -1 })).toEqual([estimated]);
    expect(await errors({ spentMinutes: 1_000_001 })).toEqual([spent]);
    expect(await errors({ spentMinutes: -1 })).toEqual([spent]);
    expect(await errors({ estimatedMinutes: 0, spentMinutes: 1_000_000 })).toEqual([]);
  });

  it('refuses the id of a company, of a person, of a module or of a support type that no record can have', async () => {
    // Beyond 2147483647 the database cannot even hold the number.
    for (const id of [0, -1, 2_147_483_648, 99_999_999_999]) {
      expect(await errors({ companyId: id })).toEqual(['La empresa no existe']);
      expect(await errors({ assigneeIds: [1, id] })).toEqual(['El responsable no existe']);
      expect(await errors({ moduleId: id })).toEqual(['El módulo no existe']);
      expect(await errors({ supportTypeIds: [1, id] })).toEqual(['El tipo de soporte no existe']);
    }
    expect(await errors({ companyId: 1, assigneeIds: [1, 2_147_483_647], moduleId: 2_147_483_647, supportTypeIds: [1, 2_147_483_647] })).toEqual([]);
  });

  // Out of range here, or not found by the service: either way the entry is not in its catalog,
  // which says the same of it.
  it('says of an entry that is not there what its catalog says', () => {
    expect(MISSING_ENTRY).toEqual({
      company: COMPANIES.messages.missing,
      assignee: ASSIGNEES.messages.missing,
      module: 'El módulo no existe',
      supportType: SUPPORT_TYPES.messages.missing,
    });
  });

  // The company used to be a text of the case. Sent that way now, it is not taken for the catalog's.
  it('takes the company as the id of one of the catalog, not as a name', async () => {
    expect(await errors({ companyId: 'ACME' })).not.toEqual([]);
    expect(await errors({ companyId: 1.5 })).not.toEqual([]);
  });

  it('still accepts null where it removes the value', async () => {
    expect(await errors({ moduleId: null, priority: null, estimatedMinutes: null, promisedDate: null, customerReply: null })).toEqual([]);
  });
});

describe('ticket input responsibles', () => {
  const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

  it('accepts a list of ids of the catalog: empty, with one repeated, or with up to 20', async () => {
    for (const assigneeIds of [[], [3], [3, 1, 3], ids(20)]) expect(await errors({ assigneeIds })).toEqual([]);
  });

  it('says in Spanish that a case cannot have more than 20', async () => {
    expect(await errors({ assigneeIds: ids(21) })).toEqual(['Un caso no puede tener más de 20 responsables']);
  });

  it('refuses what is not a list of whole numbers', async () => {
    for (const assigneeIds of [3, '3', { id: 3 }, [1.5], ['3'], [null], ['Ana']]) {
      expect(await errors({ assigneeIds })).not.toEqual([]);
    }
  });

  // The one responsible a case used to have. A client that still sends it is told so, in Spanish,
  // by the pipe every request goes through.
  it('no longer takes a single assigneeId', async () => {
    const refusal: unknown = await validationPipe()
      .transform({ assigneeId: 3 }, { type: 'body', metatype: TicketInput })
      .catch((error: unknown) => error);
    expect(refusal).toBeInstanceOf(BadRequestException);
    expect((refusal as BadRequestException).getResponse()).toMatchObject({ message: ['El campo «assigneeId» no se admite'] });
  });
});

describe('ticket input support types', () => {
  const ids = (count: number): number[] => Array.from({ length: count }, (_, index) => index + 1);

  it('accepts a list of ids of the catalog: empty, with one repeated, or with up to 20', async () => {
    for (const supportTypeIds of [[], [3], [3, 1, 3], ids(20)]) expect(await errors({ supportTypeIds })).toEqual([]);
  });

  it('says in Spanish that a case cannot carry more than 20', async () => {
    expect(await errors({ supportTypeIds: ids(21) })).toEqual(['Un caso no puede tener más de 20 tipos de soporte']);
  });

  it('refuses what is not a list of whole numbers', async () => {
    for (const supportTypeIds of [3, '3', { id: 3 }, [1.5], ['3'], [null], ['Capacitación']]) {
      expect(await errors({ supportTypeIds })).not.toEqual([]);
    }
  });
});

describe('ticket input archive', () => {
  it('accepts the switch only as true or false', async () => {
    expect(await errors({ archived: true })).toEqual([]);
    expect(await errors({ archived: false })).toEqual([]);
    for (const archived of ['true', 1, 'only']) expect(await errors({ archived })).not.toEqual([]);
  });
});

describe('ticket input fields a case no longer has', () => {
  /** The fields the API refuses for not being part of a case, checked as it checks every request body. */
  const unknownFields = async (input: Record<string, unknown>): Promise<string[]> =>
    (await validate(plainToInstance(TicketInput, input), { whitelist: true, forbidNonWhitelisted: true })).map((error) => error.property);

  // Ignored, a caller that still sends them would believe the company or the client were stored.
  it('refuses the company as text and the client as responsible, instead of ignoring them', async () => {
    expect(await unknownFields({ company: 'ACME', assignedToClient: true, companyId: 2, description: 'No abre' })).toEqual(['company', 'assignedToClient']);
    expect(await unknownFields({ companyId: 2, description: 'No abre', supportTypeIds: [1], archived: false })).toEqual([]);
  });
});

describe('ticket input time', () => {
  it('accepts a time of day written HH:MM on the 24-hour clock, and null to remove it', async () => {
    for (const time of ['00:00', '08:05', '14:35', '23:59']) expect(await errors({ time })).toEqual([]);
    expect(await errors({ time: null })).toEqual([]);
    expect(await errors({})).toEqual([]);
  });

  it('rejects anything else, with a message in Spanish', async () => {
    for (const time of ['24:00', '14:60', '2:35', '14:35:10', '2:35 pm', '1435', '', 1435]) {
      expect(await errors({ time })).toEqual(['La hora del caso no es válida. Usa el formato HH:MM, de 00:00 a 23:59.']);
    }
  });
});
