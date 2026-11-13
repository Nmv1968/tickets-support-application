import { expect, test } from '../support/fixtures';
import { caseRow, casePanel, chooseOption, openCase, search, selectBox, toast } from '../support/ui';

test('cambia campos de un caso, los guarda con «Actualizar» y siguen ahí al recargar', async ({ page, api, uid }) => {
  const company = await api.createCompany(`Distribuidora Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `El reporte de ventas sale vacío ${uid}` });
  const description = `El reporte de ventas sale vacío desde la actualización ${uid}`;

  let panel = await openCase(page, ticket.code);
  await panel.getByLabel('Descripción').fill(description);
  await chooseOption(panel.getByRole('combobox', { name: 'Estado' }), 'Sin resolver');
  await chooseOption(panel.getByRole('combobox', { name: 'Prioridad' }), 'Crítica');
  await panel.getByLabel('Estimado (minutos)').fill('45');
  await expect(panel.getByRole('status').filter({ hasText: 'Cambios sin guardar' })).toBeVisible();

  await panel.getByRole('button', { name: 'Actualizar' }).click();
  await expect(toast(page, 'Caso actualizado')).toBeVisible();
  await expect(panel.getByText('Cambios sin guardar')).toBeHidden();

  await page.reload();
  panel = await openCase(page, ticket.code);
  await expect(panel.getByLabel('Descripción')).toHaveValue(description);
  await expect(selectBox(panel.getByRole('combobox', { name: 'Estado' }))).toContainText('Sin resolver');
  await expect(selectBox(panel.getByRole('combobox', { name: 'Prioridad' }))).toContainText('Crítica');
  await expect(panel.getByLabel('Estimado (minutos)')).toHaveValue('45');

  expect(await api.ticket(ticket.id)).toMatchObject({ description, status: 'UNRESOLVED', priority: 'CRITICAL', estimatedMinutes: 45 });
});

test('pregunta antes de salir de un caso con cambios sin guardar', async ({ page, api, uid }) => {
  const company = await api.createCompany(`Ferretería Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `No carga el inventario ${uid}` });

  // Into the list from another screen, as a person does: the Back button of the browser then has somewhere to go.
  await page.goto('/dashboard');
  await page.getByRole('navigation', { name: 'Principal' }).first().getByRole('link', { name: 'Casos' }).click();
  await search(page, ticket.code);
  await caseRow(page, ticket.code).getByRole('button', { name: ticket.code, exact: true }).click();
  const panel = casePanel(page);
  await panel.getByLabel('Descripción').fill(`Texto que no se guarda ${uid}`);
  const question = page.getByRole('alertdialog', { name: 'Hay cambios sin guardar' });

  // The button that closes the panel asks; staying keeps the change on screen.
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(question).toBeHidden();
  await expect(panel.getByLabel('Descripción')).toHaveValue(`Texto que no se guarda ${uid}`);

  // The Back button of the browser, which takes the whole screen away, asks too.
  await page.goBack();
  await expect(question).toBeVisible();
  await question.getByRole('button', { name: 'Seguir editando' }).click();
  await expect(page).toHaveURL(/\/casos$/);

  // Leaving discards it: the case stays as it was stored.
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await question.getByRole('button', { name: 'Descartar y salir' }).click();
  await expect(casePanel(page)).toBeHidden();
  expect((await api.ticket(ticket.id)).description).toBe(`No carga el inventario ${uid}`);
});
