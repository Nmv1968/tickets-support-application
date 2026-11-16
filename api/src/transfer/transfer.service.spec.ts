import ExcelJS from 'exceljs';
import { ADMIN_USER } from '../common/testing';
import { XLSX_EXPORT_LIMIT } from '../common/xlsx';
import { PDF_EXPORT_LIMIT } from './pdf-export';
import { exportRow, serviceOn } from './testing';

describe('export', () => {
  afterEach(() => jest.restoreAllMocks());

  // The count has just checked the selection against the limit. A `take` on top of it would cut
  // the file, without notice, when a case is registered between the count and the read.
  it.each(['xlsx', 'pdf'] as const)('%s: loads the whole selection when it is at the limit, without a cut', async (format) => {
    const limit = { xlsx: XLSX_EXPORT_LIMIT, pdf: PDF_EXPORT_LIMIT }[format];
    const db = { ticket: { count: jest.fn().mockResolvedValue(limit), findMany: jest.fn().mockResolvedValue([exportRow()]) } };

    await expect(serviceOn(db)[format]({})).resolves.toBeInstanceOf(Buffer);

    expect(db.ticket.findMany).toHaveBeenCalledTimes(1);
    const [query] = db.ticket.findMany.mock.calls[0] as [object];
    expect(query).not.toHaveProperty('take');
  });

  // People export, look at the file, and import it again, there or in another installation.
  describe('an exported spreadsheet, imported back', () => {
    const user = ADMIN_USER;
    const cases = [
      exportRow({
        id: 1,
        time: '14:35',
        priority: 'CRITICAL',
        module: { name: 'Facturas', parent: { name: 'Ventas' } },
        supportTypes: [{ supportType: { name: 'Falla del sistema' } }, { supportType: { name: 'Capacitación' } }],
        notes: [{ text: 'Se llamó al cliente', createdAt: new Date(2026, 10, 2, 10, 0) }],
      }),
      // Archived: its row says so in a column the import does not read.
      exportRow({ id: 2, description: 'Pide un reporte', status: 'RESOLVED', assignee: null, priority: null, module: null, archivedAt: new Date(2026, 10, 5, 9, 0) }),
    ];
    /** A system with the catalogs the cases above use, and the cases given. */
    const database = (storedCases: Record<string, unknown>[]) => ({
      ticket: { count: jest.fn().mockResolvedValue(storedCases.length), findMany: jest.fn().mockResolvedValue(storedCases), createMany: jest.fn() },
      company: { findMany: jest.fn().mockResolvedValue([{ id: 2, name: 'ACME' }]), createManyAndReturn: jest.fn() },
      assignee: { findMany: jest.fn().mockResolvedValue([{ id: 3, name: 'Ana' }]), createManyAndReturn: jest.fn() },
      supportType: {
        findMany: jest.fn().mockResolvedValue([
          { id: 11, name: 'Capacitación' },
          { id: 12, name: 'Falla del sistema' },
        ]),
        createManyAndReturn: jest.fn(),
      },
      systemModule: { findMany: jest.fn().mockResolvedValue([{ id: 22, name: 'Facturas', parent: { name: 'Ventas' } }]) },
      slaPolicy: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const exported = async (): Promise<{ buffer: Buffer; originalname: string }> => ({
      buffer: await serviceOn(database(cases)).xlsx({ archived: 'all' }),
      originalname: 'casos-soporte-2026-11-12.xlsx',
    });

    it('creates nothing where those cases already are: no case, and nothing in the catalogs', async () => {
      const db = database(cases);

      const result = await serviceOn(db).import(await exported(), { dryRun: false, dateOrder: 'dmy', createMissing: true }, user);

      expect(result).toMatchObject({ totalRows: 2, duplicates: 2, toCreate: 0, rejected: 0 });
      expect(result.created).toEqual({ companies: [], assignees: [], supportTypes: [] });
      expect(db.ticket.createMany).not.toHaveBeenCalled();
      for (const catalog of [db.company, db.assignee, db.supportType]) expect(catalog.createManyAndReturn).not.toHaveBeenCalled();
    });

    it('is read whole where they are not: every column the import knows, and every value found in the catalogs', async () => {
      const file = await exported();
      const result = await serviceOn(database([])).import(file, { dryRun: true, dateOrder: 'dmy', createMissing: false }, user);

      // The file has the column that says which cases are archived, and the import takes it for none of its own.
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
      expect(workbook.worksheets[0].getRow(1).values).toContain('Archivado');
      expect(Object.values(result.columns).join(', ')).not.toContain('Archivado');
      expect(result.columns).toEqual({
        date: 'Fecha del caso',
        time: 'Hora del caso',
        company: 'Empresa',
        description: 'Descripción',
        status: 'Estado',
        priority: 'Prioridad',
        module: 'Módulo',
        assignee: 'Responsable',
        supportTypes: 'Tipos de soporte',
        note: 'Observación',
      });
      expect(result).toMatchObject({ toCreate: 2, rejected: 0, rejectedSample: [] });
      expect(result.unknown).toEqual({ companies: [], assignees: [], supportTypes: [], modules: [], priorities: [], statuses: [] });
      expect(result.sample).toEqual([
        {
          date: '2026-11-02',
          time: '14:35',
          company: 'ACME',
          description: 'No abre la factura',
          status: 'PENDING',
          priority: 'CRITICAL',
          module: 'Ventas > Facturas',
          assignee: 'Ana',
          supportTypes: ['Capacitación', 'Falla del sistema'],
          note: 'Se llamó al cliente',
        },
        {
          date: '2026-11-02',
          time: null,
          company: 'ACME',
          description: 'Pide un reporte',
          status: 'RESOLVED',
          priority: null,
          module: null,
          assignee: null,
          supportTypes: [],
          note: null,
        },
      ]);
    });
  });
});
