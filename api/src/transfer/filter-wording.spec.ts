import { parseTicketFilters } from '../tickets/ticket-filters';
import type { TicketFilters } from '../tickets/ticket-filters';
import { describeFilters, describeSelection } from './filter-wording';
import type { FilterNames } from './filter-wording';

describe('describeFilters', () => {
  const names: FilterNames = { assignee: 'Ana Pérez', company: 'ACME', module: 'Ventas > Facturas', supportType: 'Capacitación', createdBy: 'José Pérez' };
  /** Every filter of the list on its own, with the text the PDF header gives it. */
  const alone: [TicketFilters, string][] = [
    [{ status: ['PENDING'] }, 'Estado: Pendiente'],
    [{ status: ['UNRESOLVED', 'RESOLVED'] }, 'Estado: Sin resolver, Resuelto'],
    [{ assignee: 12 }, 'Responsable: Ana Pérez'],
    [{ assignee: 'none' }, 'Responsable: sin asignar'],
    [{ companyId: 9 }, 'Empresa: ACME'],
    [{ priority: 'HIGH' }, 'Prioridad: Alta'],
    [{ moduleId: 4 }, 'Módulo: Ventas > Facturas'],
    [{ supportType: 5 }, 'Tipo de soporte: Capacitación'],
    [{ createdBy: 3 }, 'Registrado por: José Pérez'],
    [{ from: '2026-01-05' }, 'Desde: 05/01/2026'],
    [{ to: '2026-01-31' }, 'Hasta: 31/01/2026'],
    [{ overdue: true }, 'Solo vencidos'],
    [{ stale: true }, 'Solo olvidados'],
    [{ promise: 'any' }, 'Solo con promesa de entrega'],
    [{ promise: 'overdue' }, 'Solo promesa de entrega vencida'],
    [{ promise: 'today' }, 'Solo promesa de entrega para hoy'],
    [{ promise: 'soon' }, 'Solo promesa de entrega próxima'],
    [{ promise: 'due' }, 'Solo promesa de entrega vencida, para hoy o próxima'],
    [{ archived: 'only' }, 'Solo archivados'],
    [{ archived: 'all' }, 'Incluye archivados'],
    [{ q: 'factura' }, 'Búsqueda: "factura"'],
  ];

  it.each(alone)('describes %j on its own', (filters, text) => {
    expect(describeFilters(filters, names)).toBe(text);
  });

  it('is tried above with every filter the list reads', () => {
    // The parser answers with one key per parameter it knows. These four order and page the list.
    const notFilters = ['sort', 'dir', 'page', 'pageSize'];
    const filterKeys = Object.keys(parseTicketFilters({})).filter((key) => !notFilters.includes(key));
    const tried = new Set(alone.flatMap(([filters]) => Object.keys(filters)));
    expect([...tried].sort()).toEqual(filterKeys.sort());
  });

  it('joins several filters, always in the same order', () => {
    const filters = parseTicketFilters({
      q: 'factura',
      archived: 'all',
      promise: 'due',
      stale: '1',
      overdue: '1',
      to: '2026-01-31',
      from: '2026-01-05',
      createdBy: '3',
      supportType: '5',
      moduleId: '4',
      priority: 'HIGH',
      companyId: '9',
      assignee: '12',
      status: 'PENDING,UNRESOLVED',
    });
    expect(describeFilters(filters, names)).toBe(
      [
        'Estado: Sin resolver, Pendiente',
        'Responsable: Ana Pérez',
        'Empresa: ACME',
        'Prioridad: Alta',
        'Módulo: Ventas > Facturas',
        'Tipo de soporte: Capacitación',
        'Registrado por: José Pérez',
        'Desde: 05/01/2026',
        'Hasta: 31/01/2026',
        'Solo vencidos',
        'Solo olvidados',
        'Solo promesa de entrega vencida, para hoy o próxima',
        'Incluye archivados',
        'Búsqueda: "factura"',
      ].join('  ·  '),
    );
    expect(describeFilters({ moduleId: 4, status: ['RESOLVED'] }, names)).toBe('Estado: Resuelto  ·  Módulo: Ventas > Facturas');
  });

  it('is empty when nothing filters', () => {
    expect(describeFilters({}, names)).toBe('');
    expect(describeFilters(parseTicketFilters({}), names)).toBe('');
    expect(describeFilters({ sort: 'company', dir: 'asc', page: 3, pageSize: 25 }, names)).toBe('');
    expect(describeFilters({ status: [], overdue: false, stale: false, q: '' }, names)).toBe('');
  });

  it('leaves out what the query string sent wrong, as the query does', () => {
    // A wrong day in the range is not among them: the parser refuses it, so it never gets here.
    const wrong = { status: ['a', 'b'], assignee: 'yo', companyId: 'ACME', moduleId: 'x', supportType: 'x', priority: 'URGENT', promise: 'pronto', archived: 'no' };
    expect(describeFilters(parseTicketFilters(wrong), names)).toBe('');
    expect(describeFilters(parseTicketFilters({ ...wrong, to: '2026-02-28' }), names)).toBe('Hasta: 28/02/2026');
  });

  it('reads a repeated parameter', () => {
    expect(describeFilters(parseTicketFilters({ status: ['RESOLVED', 'PENDING'], companyId: ['9', '10'] }), names)).toBe(
      'Estado: Pendiente, Resuelto  ·  Empresa: ACME',
    );
  });

  it('says so when the record a filter points at does not exist', () => {
    const nothing: FilterNames = { assignee: null, company: null, module: null, supportType: null, createdBy: null };
    expect(describeFilters({ assignee: 99 }, nothing)).toBe('Responsable: id 99 (no existe)');
    expect(describeFilters({ companyId: 99 }, nothing)).toBe('Empresa: id 99 (no existe)');
    expect(describeFilters({ moduleId: 0 }, nothing)).toBe('Módulo: id 0 (no existe)');
    expect(describeFilters({ supportType: 99 }, nothing)).toBe('Tipo de soporte: id 99 (no existe)');
    expect(describeFilters({ createdBy: 99 }, nothing)).toBe('Registrado por: id 99 (no existe)');
    expect(describeFilters({ assignee: 'none' }, nothing)).toBe('Responsable: sin asignar');
  });
});

// An archived case is out of the file unless its filter asks for it. A header that only said
// "todos los casos", or only the other filters, would promise the archived ones too.
describe('describeSelection', () => {
  const names: FilterNames = { assignee: null, company: 'ACME', module: null, supportType: null, createdBy: null };

  it('says that the archived cases are left out, with or without other filters', () => {
    expect(describeSelection({}, names)).toBe('Sin filtros: todos los casos sin archivar');
    expect(describeSelection(parseTicketFilters({ sort: 'date', archived: 'no' }), names)).toBe('Sin filtros: todos los casos sin archivar');
    expect(describeSelection({ companyId: 9, status: ['PENDING'] }, names)).toBe('Filtros: Estado: Pendiente  ·  Empresa: ACME  ·  Sin archivados');
  });

  it('words the filter of archived cases when it is the one that decides', () => {
    expect(describeSelection({ archived: 'all' }, names)).toBe('Filtros: Incluye archivados');
    expect(describeSelection({ companyId: 9, archived: 'only' }, names)).toBe('Filtros: Empresa: ACME  ·  Solo archivados');
  });
});
