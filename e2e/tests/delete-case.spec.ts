import { expect, test } from '../support/fixtures';
import { casePanel, openCase, toast } from '../support/ui';

test('elimina un caso después de confirmarlo en el diálogo', async ({ page, api, uid }) => {
  const company = await api.createCompany(`Panadería Demo ${uid}`);
  const ticket = await api.createTicket({ companyId: company.id, description: `Caso para eliminar ${uid}` });

  const panel = await openCase(page, ticket.code);
  const question = page.getByRole('alertdialog', { name: `¿Eliminar el caso ${ticket.code}?` });

  // Cancel first: nothing is deleted.
  await panel.getByRole('button', { name: 'Eliminar caso' }).click();
  await expect(question).toContainText('No se puede deshacer');
  await question.getByRole('button', { name: 'Cancelar' }).click();
  await expect(question).toBeHidden();
  expect(await api.ticketStatus(ticket.id)).toBe(200);

  await panel.getByRole('button', { name: 'Eliminar caso' }).click();
  await question.getByRole('button', { name: 'Eliminar', exact: true }).click();
  await expect(toast(page, `Caso ${ticket.code} eliminado`)).toBeVisible();
  await expect(casePanel(page)).toBeHidden();
  await expect(page.getByRole('button', { name: ticket.code, exact: true })).toHaveCount(0);
  expect(await api.ticketStatus(ticket.id)).toBe(404);
});
