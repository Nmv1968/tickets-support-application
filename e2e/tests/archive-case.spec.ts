import { expect, test } from '../support/fixtures';
import { caseRow, casePanel, chooseOption, openCase, search, toast } from '../support/ui';

// A user of its own: the filter panel left open is a preference of each user.
test('archiva un caso y solo aparece con el filtro de archivados', async ({ api, uid, newUser, pageAs }) => {
  const company = await api.createCompany(`Librería Demo ${uid}`);
  const description = `Caso para archivar ${uid}`;
  const ticket = await api.createTicket({ companyId: company.id, description });
  const page = await pageAs(await newUser());

  const panel = await openCase(page, ticket.code);
  await panel.getByRole('button', { name: 'Archivar' }).click();
  await expect(toast(page, 'Caso archivado')).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Desarchivar' })).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(casePanel(page)).toBeHidden();

  // The list of every day leaves it out.
  await page.reload();
  await search(page, description);
  await expect(page.getByText('Ningún caso coincide con los filtros.')).toBeVisible();
  await expect(caseRow(page, ticket.code)).toHaveCount(0);

  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  await chooseOption(page.getByRole('combobox', { name: 'Archivados' }), 'Archivados');
  const row = caseRow(page, ticket.code);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Archivado');
  await expect(row).toContainText(description);

  // Back to the active ones: gone again.
  await chooseOption(page.getByRole('combobox', { name: 'Archivados' }), 'Activos');
  await expect(row).toHaveCount(0);

  expect((await api.ticket(ticket.id)).archivedAt).not.toBeNull();
});
