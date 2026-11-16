import { inflateSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import { parseTicketFilters } from '../tickets/ticket-filters';
import { PDF_EXPORT_LIMIT } from './pdf-export';
import { active, exportRow, serviceOn } from './testing';

afterEach(() => jest.restoreAllMocks());

describe('pdf', () => {
  /** Watches the real pdfmake and gives the text of each paragraph of the document it was handed. */
  const watchDocument = (): (() => unknown[]) => {
    const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
    return () => {
      const { content } = print.mock.calls[0][0];
      return (Array.isArray(content) ? content : [content]).map((part) => (typeof part === 'object' && 'text' in part ? part.text : null));
    };
  };

  it('refuses more than 5000 cases after counting them, without loading any', async () => {
    expect(PDF_EXPORT_LIMIT).toBe(5000);
    const db = { ticket: { count: jest.fn().mockResolvedValue(5001), findMany: jest.fn() } };

    const refused = serviceOn(db).pdf({ status: ['PENDING'] });

    await expect(refused).rejects.toBeInstanceOf(BadRequestException);
    await expect(refused).rejects.toThrow(
      'La exportación a PDF admite hasta 5000 casos y la selección actual tiene 5001. ' +
        'Acota los filtros (por ejemplo, por fechas, estado o responsable) o exporta a Excel.',
    );
    expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active, { status: { in: ['PENDING'] } }] } });
    expect(db.ticket.findMany).not.toHaveBeenCalled();
  });

  it('does not offer Excel for a selection that Excel would refuse too', async () => {
    const db = { ticket: { count: jest.fn().mockResolvedValue(20001), findMany: jest.fn() } };

    await expect(serviceOn(db).pdf({})).rejects.toThrow(
      'La exportación a PDF admite hasta 5000 casos y la selección actual tiene 20001. ' +
        'Acota los filtros (por ejemplo, por fechas, estado o responsable).',
    );
  });

  it('builds the document for 5000 cases or fewer, headed by the filters its query ran with', async () => {
    const paragraphs = watchDocument();
    const db = {
      ticket: { count: jest.fn().mockResolvedValue(5000), findMany: jest.fn().mockResolvedValue([exportRow()]) },
      systemModule: { findUnique: jest.fn().mockResolvedValue({ name: 'Facturas', parent: { name: 'Ventas' } }) },
    };

    const file = await serviceOn(db).pdf({ moduleId: 4, dir: 'asc' });

    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const where = { AND: [active, { moduleId: 4 }] };
    expect(db.ticket.count).toHaveBeenCalledWith({ where });
    expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, orderBy: [{ id: 'asc' }] }));
    expect(paragraphs()).toContain('Filtros: Módulo: Ventas > Facturas  ·  Sin archivados');
    expect(paragraphs()).toContain('Total: 1   ·   Resueltos: 0   ·   Pendientes: 1   ·   Sin resolver: 0');
  });

  // In the order of the list it was asked from. By company is by the key of its name, as the list orders.
  it('orders the cases as the list does, by company too', async () => {
    const db = { ticket: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };

    await serviceOn(db).pdf({ sort: 'company', dir: 'desc' });

    expect(db.ticket.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: [{ company: { sortKey: 'desc' } }, { id: 'asc' }] }));
  });

  it('says that there are no filters only when there are none, and that the archived cases are not in it', async () => {
    const paragraphs = watchDocument();
    const db = { ticket: { count: jest.fn().mockResolvedValue(0), findMany: jest.fn().mockResolvedValue([]) } };

    // The order is not a filter.
    await serviceOn(db).pdf(parseTicketFilters({ sort: 'date', dir: 'asc' }));

    expect(db.ticket.count).toHaveBeenCalledWith({ where: { AND: [active] } });
    expect(paragraphs()).toContain('Sin filtros: todos los casos sin archivar');
  });

  it('lists the support types of each case in a column of their own', async () => {
    const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
    const types = [{ supportType: { name: 'Falla del sistema' } }, { supportType: { name: 'Capacitación' } }];
    const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue([exportRow({ supportTypes: types }), exportRow({ id: 8 })]) } };

    await serviceOn(db).pdf({});

    const content = print.mock.calls[0][0].content as { table?: { widths: unknown[]; body: unknown[][] } }[];
    const table = content.find((part) => part.table)?.table;
    const [titles, first, second] = table?.body ?? [];
    // pdfmake rewrites each cell in place while it lays the table out: by then every one is an object with its text.
    const text = (cell: unknown): unknown => (cell as { text: unknown }).text;
    const column = titles.findIndex((title) => text(title) === 'Tipos de soporte');
    expect(column).toBeGreaterThan(0);
    expect(text(first[column])).toBe('Capacitación, Falla del sistema');
    expect(text(second[column])).toBe('');
    // One width per column: pdfmake refuses a table whose rows and widths do not match.
    expect(table?.widths).toHaveLength(titles.length);
  });

  // pdfmake never makes a "*" column narrower than its longest word: with one, a web address in
  // a description widened the table past the edge of the sheet, and the status, the responsible,
  // the support types and the observations of every case went with it.
  it('keeps the table inside the page when a description has a long word without spaces: it goes on in the next line', async () => {
    const address = `https://erp.example.com/${'a'.repeat(200)}`;
    const cases = [exportRow({ description: `No abre ${address}`, notes: [{ text: 'Se revisó con el cliente', createdAt: new Date(2026, 10, 2, 10, 0) }] }), exportRow({ id: 8 })];
    const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

    // The file keeps what it draws compressed. Inflated, it says in plain text where each
    // rectangle and each line of text is put.
    const file = (await serviceOn(db).pdf({}))
      .toString('latin1')
      .split('endstream')
      .map((part) => part.split(/stream\r?\n/)[1] ?? '')
      .map((stream) => {
        try {
          return inflateSync(Buffer.from(stream, 'latin1')).toString('latin1');
        } catch {
          // Not a compressed part: nothing is drawn in it.
          return '';
        }
      })
      .join('\n');

    // An A4 sheet on its side, with 28 pt of margin at each side.
    const [left, right] = [28, 841.89 - 28];
    const rectangles = [...file.matchAll(/(-?[\d.]+) -?[\d.]+ (-?[\d.]+) -?[\d.]+ re\b/g)].map((found) => ({ from: Number(found[1]), to: Number(found[1]) + Number(found[2]) }));
    const lines = [...file.matchAll(/1 0 0 1 (-?[\d.]+) -?[\d.]+ Tm/g)].map((found) => Number(found[1]));
    // The header cells and every line of text start and end between the two margins.
    expect(rectangles.length).toBeGreaterThan(8);
    expect(lines.length).toBeGreaterThan(20);
    expect(Math.min(...rectangles.map((rect) => rect.from), ...lines)).toBeGreaterThanOrEqual(left - 0.5);
    expect(Math.max(...rectangles.map((rect) => rect.to))).toBeLessThanOrEqual(right + 0.5);
    expect(Math.max(...lines)).toBeLessThan(right);
    // The word is all there, cut into the lines its column has room for. Each line of text is
    // written in hexadecimal, in pieces with the spacing between them.
    const written = [...file.matchAll(/\[([^\]]*)\] TJ/g)].map((found) => [...found[1].matchAll(/<([0-9a-f]*)>/g)].map(([, hex]) => Buffer.from(hex, 'hex').toString('latin1')).join(''));
    const pieces = written.filter((line) => /^a+$/.test(line));
    expect(pieces.length).toBeGreaterThan(1);
    expect(written.join('')).toContain('a'.repeat(200));
  });

  // The header says "Incluye archivados" for the whole file. Which of its cases they are, only each row can say.
  it('marks each archived case under its code, and no other', async () => {
    const print = jest.spyOn(PdfPrinter.prototype, 'createPdfKitDocument');
    const cases = [exportRow({ id: 7, archivedAt: new Date(2026, 10, 5, 9, 0) }), exportRow({ id: 8 })];
    const db = { ticket: { count: jest.fn().mockResolvedValue(2), findMany: jest.fn().mockResolvedValue(cases) } };

    const file = await serviceOn(db).pdf({ archived: 'all' });

    expect(file.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const content = print.mock.calls[0][0].content as { table?: { body: unknown[][] } }[];
    const [, archived, other] = content.find((part) => part.table)?.table?.body ?? [];
    /** Every text of a cell, in the order it is read. */
    const lines = (cell: unknown): unknown[] => {
      const { text, stack } = cell as { text?: unknown; stack?: unknown[] };
      return stack ? stack.flatMap(lines) : [text];
    };
    expect(lines(archived[0])).toEqual(['SOP-00007', '(archivado)']);
    expect(lines(other[0])).toEqual(['SOP-00008']);
  });

  it('names in its header the company, the support type and the user its filters point at', async () => {
    const paragraphs = watchDocument();
    const named = (name: string): { findUnique: jest.Mock } => ({ findUnique: jest.fn().mockResolvedValue({ name }) });
    const db = {
      ticket: { count: jest.fn().mockResolvedValue(1), findMany: jest.fn().mockResolvedValue([exportRow()]) },
      company: named('ACME'),
      supportType: named('Capacitación'),
      user: named('José Pérez'),
    };

    await serviceOn(db).pdf({ companyId: 9, supportType: 5, createdBy: 3, archived: 'only' });

    expect(db.company.findUnique).toHaveBeenCalledWith({ where: { id: 9 }, select: { name: true } });
    expect(db.supportType.findUnique).toHaveBeenCalledWith({ where: { id: 5 }, select: { name: true } });
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { id: 3 }, select: { name: true } });
    expect(paragraphs()).toContain('Filtros: Empresa: ACME  ·  Tipo de soporte: Capacitación  ·  Registrado por: José Pérez  ·  Solo archivados');
  });
});
