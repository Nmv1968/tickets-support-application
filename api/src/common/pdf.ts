import type { TicketStatus } from '@prisma/client';
import PdfPrinter from 'pdfmake';
import type { TDocumentDefinitions } from 'pdfmake/interfaces';

// What the PDFs of the API share: the list of cases (transfer/pdf-export.ts) and the report of the
// dashboard (dashboard/dashboard.report.ts).

/** The PDF uses the built-in Helvetica font, which only covers Latin-1. */
export function pdfSafe(text: string): string {
  return text
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\t\n -~\u00A0-\u00FF]/g, '?');
}

/** Colour of each status in the PDFs of the app. */
export const PDF_STATUS_COLOR: Record<TicketStatus, string> = { RESOLVED: '#12b76a', PENDING: '#b97a00', UNRESOLVED: '#e5484d' };

/** The other colours of the PDFs of the app: the brand blue of the titles, the grey of what is said in passing, and the lines between rows. */
export const PDF_COLOR = { primary: '#0c7beb', muted: '#5b6472', rule: '#dbe4f3' } as const;

/** The cell of the header of a table of the PDFs: white bold text on the brand blue. */
export const PDF_HEADER_CELL = { bold: true, color: '#ffffff', fillColor: PDF_COLOR.primary } as const;

/**
 * What every PDF of the app has around its content: the font of `renderPdf`, a heading on each page
 * with the title of the document and when it was made (`generated`), and the number of the page at
 * its foot. `sideMargin` is the margin of its pages at each side, which the heading keeps too.
 */
export function pdfFrame(title: string, generated: string, sideMargin: number): Pick<TDocumentDefinitions, 'defaultStyle' | 'header' | 'footer'> {
  return {
    defaultStyle: { font: 'Helvetica', fontSize: 8 },
    header: {
      margin: [sideMargin, 22, sideMargin, 0],
      columns: [
        { text: title, fontSize: 15, bold: true, color: PDF_COLOR.primary },
        { text: `Generado el ${generated}`, alignment: 'right', fontSize: 8, color: PDF_COLOR.muted, margin: [0, 6, 0, 0] },
      ],
    },
    footer: (page: number, pages: number) => ({
      text: `Página ${page} de ${pages}`,
      alignment: 'center',
      fontSize: 7,
      color: PDF_COLOR.muted,
      margin: [0, 12, 0, 0],
    }),
  };
}

/** Draws a pdfmake document with Helvetica, the font built into every PDF reader: no font file to ship. */
export function renderPdf(definition: TDocumentDefinitions): Promise<Buffer> {
  const printer = new PdfPrinter({
    Helvetica: {
      normal: 'Helvetica',
      bold: 'Helvetica-Bold',
      italics: 'Helvetica-Oblique',
      bolditalics: 'Helvetica-BoldOblique',
    },
  });
  const document = printer.createPdfKitDocument(definition);
  return new Promise<Buffer>((resolvePdf, reject) => {
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolvePdf(Buffer.concat(chunks)));
    document.on('error', reject);
    document.end();
  });
}
