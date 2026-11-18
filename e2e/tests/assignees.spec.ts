import { expect, test } from '../support/fixtures';
import { caseRow, casePanel, chooseOption, openCase, search, selectBox, toast } from '../support/ui';

// A user of its own: the filter panel left open is a preference of each user.
test('guarda un caso con dos responsables, los muestra en la lista también al recargar, y el filtro por uno de ellos lo encuentra', async ({ api, uid, newUser, pageAs }) => {
  const company = await api.createCompany(`Ferretería Demo ${uid}`);
  const [ana, luis, other] = await Promise.all([
    api.createAssignee(`Ana Demo ${uid}`),
    api.createAssignee(`Luis Demo ${uid}`),
    api.createAssignee(`Otra Persona Demo ${uid}`),
  ]);
  const description = `Caso de dos responsables ${uid}`;
  const ticket = await api.createTicket({ companyId: company.id, description });
  const page = await pageAs(await newUser());

  // Chosen one after the other, as the support types: the list stays open between them.
  const panel = await openCase(page, ticket.code);
  const people = panel.getByRole('combobox', { name: 'Responsables', exact: true });
  await chooseOption(people, luis.name, luis.name);
  await chooseOption(people, ana.name, ana.name);
  await people.press('Escape');
  await expect(selectBox(people).locator('app-type-chip')).toContainText([luis.name, ana.name]);
  await expect(panel.getByRole('button', { name: `Quitar ${ana.name}` })).toBeVisible();
  await panel.getByRole('button', { name: 'Actualizar' }).click();
  await expect(toast(page, 'Caso actualizado')).toBeVisible();
  await panel.getByRole('button', { name: 'Cerrar', exact: true }).click();
  await expect(casePanel(page)).toBeHidden();

  // By name and separated by commas, as the exports write them.
  const both = `${ana.name}, ${luis.name}`;
  const row = caseRow(page, ticket.code);
  await expect(row).toContainText(both);
  await page.reload();
  await search(page, uid);
  await expect(row).toContainText(both);

  // The filter by one of them finds the case, which has another one too; by somebody else, not.
  await page.getByRole('button', { name: 'Filtros', exact: true }).click();
  const filter = page.getByRole('group', { name: 'Filtros' }).getByRole('combobox', { name: 'Responsable', exact: true });
  await chooseOption(filter, luis.name, luis.name);
  await expect(row).toBeVisible();
  await chooseOption(filter, other.name, other.name);
  await expect(page.getByText('Ningún caso coincide con los filtros.')).toBeVisible();
  await expect(row).toHaveCount(0);
  await chooseOption(filter, ana.name, ana.name);
  await expect(row).toBeVisible();

  expect((await api.ticket(ticket.id)).assignees.map((person) => person.name)).toEqual([ana.name, luis.name]);
});
