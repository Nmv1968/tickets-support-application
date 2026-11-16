import type { DynamicContent } from 'pdfmake/interfaces';
import { PDF_COLOR, pdfFrame, pdfSafe, renderPdf } from './pdf';

describe('pdfSafe', () => {
  it('keeps Spanish text and line breaks', () => {
    const text = 'Señor Núñez: ¿cómo está la «facturación»?\n¡Lista!';
    expect(pdfSafe(text)).toBe(text);
  });

  it('replaces typographic marks with their plain form and anything else Helvetica lacks with "?"', () => {
    expect(pdfSafe('“Hola” ‘mundo’ – — …')).toBe('"Hola" \'mundo\' - - ...');
    expect(pdfSafe('Listo ✓ → fin')).toBe('Listo ? ? fin');
  });
});

describe('pdfFrame', () => {
  const frame = pdfFrame('Casos de Soporte', '14/11/2026', 28);

  it('heads every page with the title and the day the document was made, within its side margins', () => {
    expect(frame.defaultStyle).toEqual({ font: 'Helvetica', fontSize: 8 });
    expect(frame.header).toEqual({
      margin: [28, 22, 28, 0],
      columns: [
        { text: 'Casos de Soporte', fontSize: 15, bold: true, color: PDF_COLOR.primary },
        { text: 'Generado el 14/11/2026', alignment: 'right', fontSize: 8, color: PDF_COLOR.muted, margin: [0, 6, 0, 0] },
      ],
    });
  });

  it('numbers each page at its foot', () => {
    expect((frame.footer as DynamicContent)(2, 3, { width: 0, height: 0, orientation: 'portrait' })).toEqual({
      text: 'Página 2 de 3',
      alignment: 'center',
      fontSize: 7,
      color: PDF_COLOR.muted,
      margin: [0, 12, 0, 0],
    });
  });

  it('draws with the font renderPdf has', async () => {
    const pdf = await renderPdf({ ...frame, content: ['Hola'] });

    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
