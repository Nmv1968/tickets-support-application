import { expect, test } from '../support/fixtures';

// Starts with no session: this is the test of the login screen itself.
test.use({ storageState: { cookies: [], origins: [] } });

test('ingresa por la pantalla de login y rechaza una contraseña incorrecta', async ({ page, newUser }) => {
  const user = await newUser();

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Usuario').fill(user.username);
  await page.getByLabel('Contraseña').fill(`${user.password}-mal`);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Usuario o contraseña incorrectos');
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Contraseña').fill(user.password);
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();

  await expect(page).toHaveURL(/\/casos$/);
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
  await expect(page.getByText(user.name, { exact: true })).toBeVisible();

  // The session survives a reload, as the browser keeps it.
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
});
