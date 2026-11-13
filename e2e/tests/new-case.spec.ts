import { expect, test } from '../support/fixtures';
import { caseRow, chooseOption, search, toast } from '../support/ui';

test('crea una empresa desde «Crear empresa» y registra un caso con «Nuevo caso»', async ({ page, api, uid }) => {
  const company = `Comercial Demo ${uid}`;
  const description = `No imprime la factura del día ${uid}`;

  await page.goto('/casos');
  await page.getByRole('button', { name: 'Nuevo caso' }).click();
  const form = page.getByRole('form', { name: 'Nuevo caso' });
  await expect(form).toBeVisible();

  await chooseOption(form.getByRole('combobox', { name: 'Empresa' }), `Crear empresa «${company}»`, company);
  await expect(toast(page, `Empresa «${company}» creada`)).toBeVisible();

  await form.getByLabel('Descripción').fill(description);
  await chooseOption(form.getByRole('combobox', { name: 'Prioridad' }), 'Alta');
  await form.getByRole('button', { name: 'Registrar' }).click();

  const registered = toast(page, /^Caso \S+ registrado$/);
  await expect(registered).toBeVisible();
  const code = /^Caso (\S+) registrado$/.exec((await registered.textContent())!.trim())![1];

  // The form stays open and empty, ready for the next case.
  await expect(form.getByLabel('Descripción')).toHaveValue('');

  await search(page, description);
  const row = caseRow(page, code);
  await expect(row).toContainText(company);
  await expect(row).toContainText(description);
  await expect(row).toContainText('Pendiente');

  const [stored] = await api.searchTickets(description);
  expect(stored).toMatchObject({ code, company, description, status: 'PENDING', priority: 'HIGH' });
});
