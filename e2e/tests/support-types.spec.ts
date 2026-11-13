import { expect, test } from '../support/fixtures';
import { caseRow, chooseOption, openCase, toast } from '../support/ui';

test('crea un tipo de soporte con su color, lo pone en un caso y se ve su chip', async ({ page, api, uid }) => {
  const name = `Capacitación demo ${uid}`;
  const color = '#7c3aed';
  const rgb = 'rgb(124, 58, 237)';

  await page.goto('/configuracion');
  await page.getByRole('tab', { name: 'Tipos de soporte' }).click();
  await page.getByLabel('Nombre del tipo de soporte').fill(name);
  await page.getByLabel('Color del tipo nuevo, en hexadecimal').fill(color);
  await page.getByRole('button', { name: 'Agregar' }).click();
  await expect(toast(page, 'Tipo de soporte agregado')).toBeVisible();
  // In the catalog, as its chip: its name on its colour.
  const chip = page.locator('app-type-chip', { hasText: name });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveCSS('background-color', rgb);

  const company = await api.createCompany(`Óptica Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `Pide una capacitación del módulo de caja ${uid}` });

  const panel = await openCase(page, ticket.code);
  await chooseOption(panel.getByRole('combobox', { name: 'Tipos de soporte' }), name, name);
  await panel.getByRole('button', { name: 'Actualizar' }).click();
  await expect(toast(page, 'Caso actualizado')).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();

  const rowChip = caseRow(page, ticket.code).locator('app-type-chip', { hasText: name });
  await expect(rowChip).toBeVisible();
  await expect(rowChip).toHaveCSS('background-color', rgb);

  expect((await api.ticket(ticket.id)).supportTypes).toEqual([expect.objectContaining({ name, color })]);
});
