import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';

/** The whole ng-select of its combobox: what a person sees and presses. */
export function selectBox(combobox: Locator): Locator {
  return combobox.locator('xpath=ancestor::ng-select[1]');
}

/**
 * Chooses an option of an ng-select as a person does: a press on the select, the text typed when
 * given (to narrow a long list, or to offer "Crear…"), and a press on the option. The press goes
 * to the box, not to its input: a select without search has an input nobody can see. The list
 * hangs from the body (appendTo="body"), and only one is open at a time.
 */
export async function chooseOption(combobox: Locator, option: string, typed?: string): Promise<void> {
  await selectBox(combobox).locator('.ng-select-container').click();
  if (typed !== undefined) await combobox.fill(typed);
  await combobox.page().getByRole('option', { name: option, exact: true }).click();
}

/** The notice the application shows after an action (core/toast.ts). */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator('app-toasts').getByText(text);
}

/** The side panel with the form of a case. */
export function casePanel(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Detalle del caso' });
}

/** The row of the case list with this code. */
export function caseRow(page: Page, code: string): Locator {
  return page.getByRole('row').filter({ has: page.getByRole('button', { name: code, exact: true }) });
}

/** Writes in the search box of the case list. Its list follows after a short pause, by itself. */
export async function search(page: Page, text: string): Promise<void> {
  await page.getByRole('searchbox', { name: 'Buscar casos' }).fill(text);
}

/** Opens the case list on this case and its panel, as a person who looks it up by its code. */
export async function openCase(page: Page, code: string): Promise<Locator> {
  await page.goto('/casos');
  await search(page, code);
  await caseRow(page, code).getByRole('button', { name: code, exact: true }).click();
  const panel = casePanel(page);
  await expect(panel.getByText(code, { exact: true })).toBeVisible();
  return panel;
}
