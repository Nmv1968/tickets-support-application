import ExcelJS from 'exceljs';
import { expect, test } from '../support/fixtures';
import { toast } from '../support/ui';

test('descarga la plantilla e importa una hoja, con la vista previa de una fila rechazada', async ({ page, api, uid }, testInfo) => {
  const company = await api.createCompany(`Imprenta Demo ${uid}`);
  const unknown = `Empresa Inexistente ${uid}`;

  await page.goto('/casos');
  await page.getByRole('button', { name: 'Importar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Importar hoja de casos' });
  await expect(dialog).toBeVisible();

  // The template: an Excel with the columns the import reads and the values of the system.
  const download = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Descargar plantilla' }).click();
  const template = await download;
  expect(template.suggestedFilename()).toBe('plantilla-casos-soporte.xlsx');
  const templatePath = testInfo.outputPath('plantilla.xlsx');
  await template.saveAs(templatePath);
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(templatePath);
  const headers = (book.worksheets[0].getRow(1).values as unknown[]).map(String);
  expect(headers).toEqual(expect.arrayContaining(['Fecha', 'Empresa', 'Descripción', 'Estado']));
  const values = book.getWorksheet('Valores del sistema');
  expect(values, 'la hoja «Valores del sistema»').toBeTruthy();
  const listed: string[] = [];
  values!.eachRow((row) => row.eachCell((cell) => listed.push(String(cell.value))));
  expect(listed).toContain(company.name);

  // A sheet of three rows: two of a company that exists and one of a company that does not.
  const sheet = new ExcelJS.Workbook();
  const cases = sheet.addWorksheet('Casos');
  cases.addRow(['Fecha', 'Empresa', 'Descripción', 'Estado']);
  cases.addRow([new Date(Date.UTC(2026, 9, 5)), company.name, `Importado uno ${uid}`, 'Pendiente']);
  cases.addRow([new Date(Date.UTC(2026, 9, 6)), company.name, `Importado dos ${uid}`, 'Resuelto']);
  cases.addRow([new Date(Date.UTC(2026, 9, 7)), unknown, `Importado rechazado ${uid}`, 'Pendiente']);
  const sheetPath = testInfo.outputPath('casos.xlsx');
  await sheet.xlsx.writeFile(sheetPath);

  await dialog.getByLabel('Archivo').setInputFiles(sheetPath);
  const rejected = dialog.getByRole('region', { name: 'Filas rechazadas (1)' });
  await expect(rejected).toBeVisible();
  await expect(rejected.getByRole('row').filter({ hasText: `La empresa «${unknown}» no existe` })).toContainText('4');
  await expect(dialog.getByText(`Importado uno ${uid}`)).toBeVisible();

  await dialog.getByRole('button', { name: 'Importar 2 casos' }).click();
  await expect(toast(page, '2 casos importados. 1 fila rechazada.')).toBeVisible();
  await expect(dialog).toBeHidden();

  const imported = await api.searchTickets(uid);
  expect(imported.map((ticket) => ticket.description).sort()).toEqual([`Importado dos ${uid}`, `Importado uno ${uid}`]);
  expect(imported.every((ticket) => ticket.company === company.name)).toBe(true);
  expect(imported.find((ticket) => ticket.description === `Importado dos ${uid}`)?.status).toBe('RESOLVED');
});
