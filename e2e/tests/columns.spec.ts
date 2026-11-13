import { expect, test } from '../support/fixtures';
import type { Page } from '@playwright/test';

/** Opens the case list and waits for the columns the server keeps for the user, so that what is not there can be told apart from what has not arrived yet. */
async function openList(page: Page): Promise<void> {
  const columns = page.waitForResponse((response) => response.url().includes('/api/preferences/tickets.columns') && response.request().method() === 'GET');
  await page.goto('/casos');
  await columns;
  await expect(page.getByRole('columnheader', { name: 'Empresa' })).toBeVisible();
}

test('las columnas elegidas se guardan para el usuario y no cambian las de otro', async ({ newUser, pageAs }) => {
  const owner = await newUser();
  const other = await newUser();
  const page = await pageAs(owner);

  await openList(page);
  await expect(page.getByRole('columnheader', { name: 'Módulo' })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'Observación' })).toBeVisible();

  await page.getByRole('button', { name: 'Columnas' }).click();
  const menu = page.getByRole('group', { name: 'Columnas de la lista' });
  const saved = page.waitForResponse((response) => response.url().includes('/api/preferences/tickets.columns') && response.request().method() === 'PUT' && response.ok());
  await menu.getByRole('checkbox', { name: 'Módulo' }).check();
  await saved;
  const savedAgain = page.waitForResponse((response) => response.url().includes('/api/preferences/tickets.columns') && response.request().method() === 'PUT' && response.ok());
  await menu.getByRole('checkbox', { name: 'Observación' }).uncheck();
  await savedAgain;

  await expect(page.getByRole('columnheader', { name: 'Módulo' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Observación' })).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('columnheader', { name: 'Módulo' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Observación' })).toHaveCount(0);

  // Another browser of the same user, with nothing kept in it: the choice comes from the server.
  const elsewhere = await pageAs(owner);
  await openList(elsewhere);
  await expect(elsewhere.getByRole('columnheader', { name: 'Módulo' })).toBeVisible();
  await expect(elsewhere.getByRole('columnheader', { name: 'Observación' })).toHaveCount(0);

  // Someone else keeps the columns they start with.
  const otherPage = await pageAs(other);
  await openList(otherPage);
  await expect(otherPage.getByRole('columnheader', { name: 'Observación' })).toBeVisible();
  await expect(otherPage.getByRole('columnheader', { name: 'Módulo' })).toHaveCount(0);
});
