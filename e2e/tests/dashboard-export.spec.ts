import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { expect, test } from '../support/fixtures';

test('el dashboard descarga su reporte en Excel y en PDF', async ({ page, api, uid }, testInfo) => {
  const company = await api.createCompany(`Farmacia Demo ${uid}`);
  await api.createTicket({ companyId: company.id, description: `Caso para el reporte ${uid}`, priority: 'MEDIUM' });

  await page.goto('/dashboard');
  const report = page.getByRole('group', { name: 'Descargar el reporte' });
  await expect(report).toBeVisible();

  const excelDownload = page.waitForEvent('download');
  await report.getByRole('button', { name: 'Excel', exact: true }).click();
  const excel = await excelDownload;
  expect(excel.suggestedFilename()).toMatch(/^reporte-soporte-\d{4}-\d{2}-\d{2}\.xlsx$/);
  const excelPath = testInfo.outputPath(excel.suggestedFilename());
  await excel.saveAs(excelPath);
  const excelBytes = readFileSync(excelPath);
  expect(excelBytes.length).toBeGreaterThan(0);
  expect(excelBytes.subarray(0, 2).toString('latin1')).toBe('PK');
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(excelPath);
  expect(book.worksheets.map((sheet) => sheet.name)).toEqual(expect.arrayContaining(['Resumen', 'Por empresa', 'Datos']));

  // The buttons come back once the file is made: one export at a time.
  await expect(report.getByRole('button', { name: 'PDF', exact: true })).toBeEnabled();
  const pdfDownload = page.waitForEvent('download');
  await report.getByRole('button', { name: 'PDF', exact: true }).click();
  const pdf = await pdfDownload;
  expect(pdf.suggestedFilename()).toMatch(/^reporte-soporte-\d{4}-\d{2}-\d{2}\.pdf$/);
  const pdfPath = testInfo.outputPath(pdf.suggestedFilename());
  await pdf.saveAs(pdfPath);
  const pdfBytes = readFileSync(pdfPath);
  expect(pdfBytes.length).toBeGreaterThan(1000);
  expect(pdfBytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
});
