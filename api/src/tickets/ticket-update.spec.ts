import { BadRequestException } from '@nestjs/common';
import { day } from '../common/testing';
import { ANA, CLIENT, FAILURE, LUIS, NOW, TRAINING, USER_ERROR, assignedTo, carrying, stored } from './testing';
import type { AssigneeRow, SupportTypeRow } from './testing';
import { TicketInput } from './ticket-input';
import { planTicketUpdate } from './ticket-update';
import type { TicketUpdateContext } from './ticket-update';

describe('planTicketUpdate', () => {
  const context = (changes: Partial<TicketUpdateContext> = {}): TicketUpdateContext => ({
    now: NOW,
    companyName: null,
    assignees: null,
    supportTypes: null,
    moduleName: null,
    slaHours: null,
    ...changes,
  });
  /** What an edit that changes nothing writes: the mark that somebody worked on the case. */
  const untouched = { data: { lastActivityAt: NOW }, history: [] };

  it('writes only the activity mark when nothing is sent', () => {
    expect(planTicketUpdate(stored(), {}, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
  });

  describe('status', () => {
    it('sets resolvedAt when the case is resolved', () => {
      const { data, history } = planTicketUpdate(stored(), { status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ status: 'RESOLVED', resolvedAt: NOW });
      expect(history).toEqual([{ field: 'Estado', oldValue: 'Pendiente', newValue: 'Resuelto' }]);
    });

    it('clears resolvedAt when the case is reopened', () => {
      const resolved = stored({ status: 'RESOLVED', resolvedAt: new Date('2026-11-05T12:00:00.000Z') });
      const { data, history } = planTicketUpdate(resolved, { status: 'UNRESOLVED' }, context());
      expect(data).toMatchObject({ status: 'UNRESOLVED', resolvedAt: null });
      expect(history).toEqual([{ field: 'Estado', oldValue: 'Resuelto', newValue: 'Sin resolver' }]);
    });

    it('leaves resolvedAt alone when the status sent is the one the case has', () => {
      const resolved = stored({ status: 'RESOLVED', resolvedAt: new Date('2026-11-05T12:00:00.000Z') });
      const { data, history } = planTicketUpdate(resolved, { status: 'RESOLVED' }, context());
      expect(data).not.toHaveProperty('status');
      expect(data).not.toHaveProperty('resolvedAt');
      expect(history).toEqual([]);
    });

    it('stops a running timer when the case is resolved and adds its minutes', () => {
      const running = stored({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      const { data } = planTicketUpdate(running, { status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ spentMinutes: 35, timerStartedAt: null });
    });

    // The form sends the status and the time spent in one edit. With the timer running, the person
    // who types the real time and resolves means that number, not the one the timer would give.
    it('takes the minutes typed in the same edit over the ones of the timer it stops', () => {
      const running = stored({ spentMinutes: 10, timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      expect(planTicketUpdate(running, { status: 'RESOLVED', spentMinutes: 60 }, context()).data).toMatchObject({ spentMinutes: 60, timerStartedAt: null });
      // Zero is a number typed too.
      expect(planTicketUpdate(running, { status: 'RESOLVED', spentMinutes: 0 }, context()).data).toMatchObject({ spentMinutes: 0, timerStartedAt: null });
      // A null is "not sent": the minutes of the timer are added, as when the field is not there.
      const unsent = { status: 'RESOLVED', spentMinutes: null } as unknown as TicketInput;
      expect(planTicketUpdate(running, unsent, context()).data).toMatchObject({ spentMinutes: 35, timerStartedAt: null });
      expect(planTicketUpdate(stored(), { status: 'RESOLVED', spentMinutes: 99 }, context()).data.spentMinutes).toBe(99);
    });

    it('leaves the timer running on any other status change', () => {
      const running = stored({ timerStartedAt: new Date(NOW.getTime() - 25 * 60_000) });
      const { data } = planTicketUpdate(running, { status: 'UNRESOLVED' }, context());
      expect(data).not.toHaveProperty('timerStartedAt');
      expect(data).not.toHaveProperty('spentMinutes');
    });
  });

  describe('responsibles', () => {
    const unassigned = { assignees: [] };
    /** The responsibles of the input as `lookups` finds them. */
    const found = (...people: AssigneeRow[]): TicketUpdateContext['assignees'] => people;

    it('gives the case to another person of the catalog', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeIds: [5] }, context({ assignees: found(LUIS) }));
      expect(data).toEqual({
        lastActivityAt: NOW,
        assignees: { deleteMany: { assigneeId: { in: [3] } }, createMany: { data: [{ assigneeId: 5 }] } },
      });
      expect(history).toEqual([{ field: 'Responsables', oldValue: 'Ana', newValue: 'Luis' }]);
    });

    it('gives a responsible to a case that had none', () => {
      const { data, history } = planTicketUpdate(stored(unassigned), { assigneeIds: [5] }, context({ assignees: found(LUIS) }));
      expect(data.assignees).toEqual({ deleteMany: undefined, createMany: { data: [{ assigneeId: 5 }] } });
      expect(history).toEqual([{ field: 'Responsables', oldValue: null, newValue: 'Luis' }]);
    });

    it('adds a second responsible and keeps the first one, written only as the difference', () => {
      const { data, history } = planTicketUpdate(stored(), { assigneeIds: [5, 3] }, context({ assignees: found(LUIS, ANA) }));
      expect(data.assignees).toEqual({ deleteMany: undefined, createMany: { data: [{ assigneeId: 5 }] } });
      // By name, as the support types.
      expect(history).toEqual([{ field: 'Responsables', oldValue: 'Ana', newValue: 'Ana, Luis' }]);
    });

    it('takes one of several off', () => {
      const before = stored({ assignees: assignedTo(LUIS, ANA, CLIENT) });
      const { data, history } = planTicketUpdate(before, { assigneeIds: [3, 8] }, context({ assignees: found(ANA, CLIENT) }));
      expect(data.assignees).toEqual({ deleteMany: { assigneeId: { in: [5] } }, createMany: undefined });
      expect(history).toEqual([{ field: 'Responsables', oldValue: 'Ana, Cliente, Luis', newValue: 'Ana, Cliente' }]);
    });

    it('leaves the case without responsible when the list is empty', () => {
      const { data, history } = planTicketUpdate(stored({ assignees: assignedTo(ANA, LUIS) }), { assigneeIds: [] }, context({ assignees: [] }));
      expect(data).toEqual({ lastActivityAt: NOW, assignees: { deleteMany: { assigneeId: { in: [3, 5] } }, createMany: undefined } });
      expect(history).toEqual([{ field: 'Responsables', oldValue: 'Ana, Luis', newValue: null }]);
    });

    it('does nothing when the responsibles sent are the ones the case has, in any order, nobody included', () => {
      expect(planTicketUpdate(stored(), { assigneeIds: [3] }, context({ assignees: found(ANA) }))).toEqual(untouched);
      const both = stored({ assignees: assignedTo(ANA, LUIS) });
      expect(planTicketUpdate(both, { assigneeIds: [5, 3] }, context({ assignees: found(LUIS, ANA) }))).toEqual(untouched);
      expect(planTicketUpdate(stored(unassigned), { assigneeIds: [] }, context({ assignees: [] }))).toEqual(untouched);
    });

    // As for the support types: null is "not sent", and the case keeps the ones it has.
    it('leaves them alone when the input does not carry them, or carries a null', () => {
      expect(planTicketUpdate(stored(), { status: 'RESOLVED' }, context()).data).not.toHaveProperty('assignees');
      const unsent = { assigneeIds: null } as unknown as TicketInput;
      expect(planTicketUpdate(stored(), unsent, context())).toEqual(untouched);
    });

    // "Cliente" was a switch of the case that won over the person. It is a responsible of the catalog now.
    it('names "Cliente" in the history like any other responsible', () => {
      const { history } = planTicketUpdate(stored(), { assigneeIds: [8] }, context({ assignees: found(CLIENT) }));
      expect(history).toEqual([{ field: 'Responsables', oldValue: 'Ana', newValue: 'Cliente' }]);
    });
  });

  describe('company', () => {
    it('moves the case to another company of the catalog, and names both in the history', () => {
      const { data, history } = planTicketUpdate(stored(), { companyId: 5 }, context({ companyName: 'Corporación Ñandú' }));
      expect(data).toEqual({ lastActivityAt: NOW, companyId: 5, searchText: 'corporacion nandu no abre la factura' });
      expect(history).toEqual([{ field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú' }]);
    });

    it('does nothing when the company sent is the one the case has', () => {
      expect(planTicketUpdate(stored(), { companyId: 2 }, context({ companyName: 'ACME' }))).toEqual(untouched);
    });
  });

  describe('support types', () => {
    /** The types of the input as the caller looks them up: id and name. */
    const found = (...types: SupportTypeRow[]): TicketUpdateContext['supportTypes'] => types.map(({ id, name }) => ({ id, name }));

    it('gives a case its first types, and names them in the history in alphabetical order', () => {
      const { data, history } = planTicketUpdate(stored(), { supportTypeIds: [2, 1] }, context({ supportTypes: found(FAILURE, TRAINING) }));
      expect(data).toEqual({
        lastActivityAt: NOW,
        supportTypes: { deleteMany: undefined, createMany: { data: [{ supportTypeId: 2 }, { supportTypeId: 1 }] } },
      });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación, Falla del sistema' }]);
    });

    it('replaces the whole set: what is not in the list goes, what is new comes, what stays is not rewritten', () => {
      const before = stored({ supportTypes: carrying(TRAINING, FAILURE) });
      const { data, history } = planTicketUpdate(before, { supportTypeIds: [2, 3] }, context({ supportTypes: found(FAILURE, USER_ERROR) }));
      expect(data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [1] } }, createMany: { data: [{ supportTypeId: 3 }] } });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: 'Error de usuario, Falla del sistema' }]);
    });

    it('leaves the case without types with an empty list', () => {
      const before = stored({ supportTypes: carrying(FAILURE, TRAINING) });
      const { data, history } = planTicketUpdate(before, { supportTypeIds: [] }, context({ supportTypes: [] }));
      expect(data.supportTypes).toEqual({ deleteMany: { supportTypeId: { in: [2, 1] } }, createMany: undefined });
      expect(history).toEqual([{ field: 'Tipos de soporte', oldValue: 'Capacitación, Falla del sistema', newValue: null }]);
    });

    it('does nothing when the list sent is the set the case has, in whatever order', () => {
      const before = stored({ supportTypes: carrying(TRAINING, FAILURE) });
      expect(planTicketUpdate(before, { supportTypeIds: [2, 1] }, context({ supportTypes: found(FAILURE, TRAINING) }))).toEqual(untouched);
      expect(planTicketUpdate(stored(), { supportTypeIds: [] }, context({ supportTypes: [] }))).toEqual(untouched);
    });

    it('keeps the types the case has when the list is not sent', () => {
      const before = stored({ supportTypes: carrying(TRAINING) });
      expect(planTicketUpdate(before, { status: 'RESOLVED' }, context()).data).not.toHaveProperty('supportTypes');
    });
  });

  describe('archive', () => {
    const archivedAt = new Date('2026-11-05T12:00:00.000Z');

    it('archives a case at the moment of the edit', () => {
      const { data, history } = planTicketUpdate(stored(), { archived: true }, context());
      expect(data).toEqual({ archivedAt: NOW });
      expect(history).toEqual([{ field: 'Archivado', oldValue: 'No', newValue: 'Sí' }]);
    });

    it('brings an archived case back', () => {
      const { data, history } = planTicketUpdate(stored({ archivedAt }), { archived: false }, context());
      expect(data).toEqual({ archivedAt: null });
      expect(history).toEqual([{ field: 'Archivado', oldValue: 'Sí', newValue: 'No' }]);
    });

    it('does nothing when the case is already where it is sent: the first archive date stays', () => {
      expect(planTicketUpdate(stored({ archivedAt }), { archived: true }, context())).toEqual({ data: {}, history: [] });
      expect(planTicketUpdate(stored(), { archived: false }, context())).toEqual({ data: {}, history: [] });
    });

    // Putting a case away is not working on it: a forgotten case stays forgotten if it comes back.
    it('does not count as activity on the case, in either direction', () => {
      expect(planTicketUpdate(stored(), { archived: true }, context()).data).not.toHaveProperty('lastActivityAt');
      expect(planTicketUpdate(stored({ archivedAt }), { archived: false }, context()).data).not.toHaveProperty('lastActivityAt');
      // Fields the request body leaves undefined are not fields sent.
      expect(planTicketUpdate(stored(), { archived: true, status: undefined, time: undefined }, context()).data).toEqual({ archivedAt: NOW });
    });

    it('counts as activity when the same edit changes something else of the case', () => {
      const { data, history } = planTicketUpdate(stored(), { archived: true, status: 'RESOLVED' }, context());
      expect(data).toMatchObject({ lastActivityAt: NOW, archivedAt: NOW, status: 'RESOLVED' });
      expect(history.map((change) => change.field)).toEqual(['Estado', 'Archivado']);
    });
  });

  describe('priority', () => {
    it('recomputes the deadline from the registration of the case', () => {
      const { data, history } = planTicketUpdate(stored(), { priority: 'HIGH' }, context({ slaHours: 8 }));
      expect(data).toMatchObject({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      expect(history).toEqual([{ field: 'Prioridad', oldValue: null, newValue: 'Alta' }]);
    });

    it('removes the deadline when the priority is removed or has no SLA', () => {
      const urgent = stored({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      const removed = planTicketUpdate(urgent, { priority: null }, context());
      expect(removed.data).toMatchObject({ priority: null, dueAt: null });
      expect(removed.history).toEqual([{ field: 'Prioridad', oldValue: 'Alta', newValue: null }]);
      expect(planTicketUpdate(urgent, { priority: 'LOW' }, context({ slaHours: null })).data).toMatchObject({ priority: 'LOW', dueAt: null });
    });

    it('leaves the deadline alone when the priority sent is the one the case has', () => {
      const urgent = stored({ priority: 'HIGH', dueAt: new Date('2026-11-02T22:00:00.000Z') });
      const { data, history } = planTicketUpdate(urgent, { priority: 'HIGH' }, context({ slaHours: 24 }));
      expect(data).not.toHaveProperty('dueAt');
      expect(history).toEqual([]);
    });
  });

  describe('time of the case', () => {
    it('sets the time and writes it in the history', () => {
      const { data, history } = planTicketUpdate(stored(), { time: '14:35' }, context());
      expect(data.time).toBe('14:35');
      expect(history).toEqual([{ field: 'Hora del caso', oldValue: null, newValue: '14:35' }]);
    });

    // Unlike the date, a case can be left without a time.
    it('removes the time with null', () => {
      const { data, history } = planTicketUpdate(stored({ time: '14:35' }), { time: null }, context());
      expect(data.time).toBeNull();
      expect(history).toEqual([{ field: 'Hora del caso', oldValue: '14:35', newValue: null }]);
    });

    it('does nothing when the time sent is the one the case has, or when none is sent', () => {
      const timed = stored({ time: '14:35' });
      expect(planTicketUpdate(timed, { time: '14:35' }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(timed, { priority: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(stored(), { time: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
    });

    it('changes with the date in one edit', () => {
      const { data, history } = planTicketUpdate(stored(), { date: '2026-11-05', time: '09:10' }, context());
      expect(data).toMatchObject({ date: day('2026-11-05'), time: '09:10' });
      expect(history.map((change) => change.field)).toEqual(['Fecha del caso', 'Hora del caso']);
    });
  });

  describe('promised delivery date', () => {
    it('sets the promise', () => {
      const { data, history } = planTicketUpdate(stored(), { promisedDate: '2026-11-20' }, context());
      expect(data.promisedDate).toEqual(day('2026-11-20'));
      expect(history).toEqual([{ field: 'Promesa de entrega', oldValue: null, newValue: '20/11/2026' }]);
    });

    it('clears the promise', () => {
      const { data, history } = planTicketUpdate(stored({ promisedDate: day('2026-11-20') }), { promisedDate: null }, context());
      expect(data.promisedDate).toBeNull();
      expect(history).toEqual([{ field: 'Promesa de entrega', oldValue: '20/11/2026', newValue: null }]);
    });

    it('does nothing when the promise sent is the one the case has', () => {
      const promised = stored({ promisedDate: day('2026-11-20') });
      expect(planTicketUpdate(promised, { promisedDate: '2026-11-20' }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
      expect(planTicketUpdate(stored(), { promisedDate: null }, context())).toEqual({ data: { lastActivityAt: NOW }, history: [] });
    });
  });

  describe('history', () => {
    it('records one line per field that changed', () => {
      const dto: TicketInput = {
        date: '2026-11-05',
        companyId: 5,
        description: 'No imprime',
        status: 'RESOLVED',
        assigneeIds: [5],
        supportTypeIds: [1],
        archived: true,
        moduleId: 4,
      };
      const names = { companyName: 'Corporación Ñandú', assignees: [LUIS], supportTypes: [{ id: 1, name: 'Capacitación' }], moduleName: 'Ventas > Facturas' };
      const { history } = planTicketUpdate(stored(), dto, context(names));
      expect(history).toEqual([
        { field: 'Fecha del caso', oldValue: '2026-11-02', newValue: '2026-11-05' },
        { field: 'Empresa', oldValue: 'ACME', newValue: 'Corporación Ñandú' },
        { field: 'Descripción', oldValue: null, newValue: null },
        { field: 'Estado', oldValue: 'Pendiente', newValue: 'Resuelto' },
        { field: 'Responsables', oldValue: 'Ana', newValue: 'Luis' },
        { field: 'Tipos de soporte', oldValue: null, newValue: 'Capacitación' },
        { field: 'Archivado', oldValue: 'No', newValue: 'Sí' },
        { field: 'Módulo', oldValue: null, newValue: 'Ventas > Facturas' },
      ]);
    });

    it('records nothing for values equal to the stored ones, nor for fields without history', () => {
      const dto: TicketInput = {
        date: '2026-11-02',
        companyId: 2,
        description: 'No abre la factura',
        assigneeIds: [3],
        supportTypeIds: [],
        archived: false,
        estimatedMinutes: 30,
        spentMinutes: 20,
        customerReply: ' Listo ',
      };
      const { data, history } = planTicketUpdate(stored(), dto, context({ companyName: 'ACME', assignees: [ANA], supportTypes: [] }));
      expect(history).toEqual([]);
      expect(data).toMatchObject({ estimatedMinutes: 30, spentMinutes: 20, customerReply: 'Listo' });
      expect(data).not.toHaveProperty('companyId');
      expect(data).not.toHaveProperty('assignees');
      expect(data).not.toHaveProperty('supportTypes');
      expect(data).not.toHaveProperty('archivedAt');
    });

    it('names the module the case had when it is removed', () => {
      const withModule = stored({ moduleId: 4, module: { id: 4, name: 'Facturas', parent: { name: 'Ventas' } } });
      expect(planTicketUpdate(withModule, { moduleId: null }, context()).history).toEqual([
        { field: 'Módulo', oldValue: 'Ventas > Facturas', newValue: null },
      ]);
    });
  });

  describe('texts', () => {
    it('recomputes the search key when company or description change', () => {
      const nandu = context({ companyName: 'Corporación Ñandú' });
      expect(planTicketUpdate(stored(), { companyId: 5 }, nandu).data.searchText).toBe('corporacion nandu no abre la factura');
      expect(planTicketUpdate(stored(), { description: 'No IMPRIME' }, context()).data.searchText).toBe('acme no imprime');
      expect(planTicketUpdate(stored(), { companyId: 5, description: 'No IMPRIME' }, nandu).data.searchText).toBe('corporacion nandu no imprime');
      expect(planTicketUpdate(stored(), { status: 'RESOLVED' }, context()).data).not.toHaveProperty('searchText');
    });

    it('clears the message for the client when it arrives empty', () => {
      const replied = stored({ customerReply: 'Listo' });
      expect(planTicketUpdate(replied, { customerReply: '  ' }, context()).data.customerReply).toBeNull();
      expect(planTicketUpdate(replied, { customerReply: null }, context()).data.customerReply).toBeNull();
    });

    it('refuses to leave the case without description', () => {
      expect(() => planTicketUpdate(stored(), { description: '' }, context())).toThrow(BadRequestException);
      expect(() => planTicketUpdate(stored(), { description: '   ' }, context())).toThrow('La descripción no puede quedar vacía');
    });

    it('refuses a case date after today, with one day of slack', () => {
      expect(planTicketUpdate(stored(), { date: '2026-11-12' }, context()).data.date).toEqual(day('2026-11-12'));
      expect(() => planTicketUpdate(stored(), { date: '2026-11-13' }, context())).toThrow('La fecha del caso no puede ser posterior a hoy');
    });
  });

  // The checks of the request body let a null through in every optional field.
  describe('null in a field the case cannot be left without', () => {
    const nulls = (fields: Record<string, null>): TicketInput => fields;

    it('is read as "not sent": nothing is written and nothing fails', () => {
      const fields = ['date', 'companyId', 'description', 'status', 'spentMinutes', 'supportTypeIds', 'archived'];
      // The case carries a type and is archived: a null taken for "none" or for "no" would show.
      const before = stored({ supportTypes: carrying(TRAINING), archivedAt: new Date('2026-11-05T12:00:00.000Z') });
      for (const field of fields) {
        expect(planTicketUpdate(before, nulls({ [field]: null }), context())).toEqual(untouched);
      }
      expect(planTicketUpdate(before, nulls(Object.fromEntries(fields.map((field) => [field, null]))), context())).toEqual(untouched);
    });

    it('keeps the stored text in the search key when only the other one is sent', () => {
      const onlyCompany: TicketInput = { ...nulls({ description: null }), companyId: 5 };
      expect(planTicketUpdate(stored(), onlyCompany, context({ companyName: 'Otra' })).data).toEqual({ lastActivityAt: NOW, companyId: 5, searchText: 'otra no abre la factura' });
      const onlyDescription: TicketInput = { ...nulls({ companyId: null }), description: 'No imprime' };
      expect(planTicketUpdate(stored(), onlyDescription, context()).data).toEqual({ lastActivityAt: NOW, description: 'No imprime', searchText: 'acme no imprime' });
    });
  });
});
