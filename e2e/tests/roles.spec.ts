import { Api, login } from '../support/api';
import { expect, test } from '../support/fixtures';
import { toast } from '../support/ui';

const ADMIN_TABS = ['Usuarios', 'SLA', 'Recordatorios', 'IA', 'Logo'];

test('un agente no ve lo que es de administradores y el API le responde 403', async ({ newUser, pageAs }) => {
  const agent = await newUser();
  const page = await pageAs(agent);

  await page.goto('/configuracion');
  const tabs = page.getByRole('tablist').getByRole('tab');
  await expect(tabs).toHaveText(['Responsables', 'Empresas', 'Tipos de soporte', 'Módulos', 'Mi cuenta']);
  for (const name of ADMIN_TABS) await expect(page.getByRole('tab', { name, exact: true })).toHaveCount(0);
  // The catalogs stay theirs: the case forms add entries to them.
  await expect(page.getByLabel('Nombre del responsable', { exact: true })).toBeVisible();

  // Hidden is not all: the API refuses it too, in Spanish.
  const session = await login(agent.username, agent.password);
  const asAgent = await Api.as(session.token);
  try {
    expect(session.user.role).toBe('AGENT');
    const refused = { status: 403, message: 'Solo un administrador puede hacer esto.' };
    expect(await asAgent.attempt('POST', '/api/users', { username: `otro.${agent.username}`, name: 'Otro', password: 'secreto1', role: 'ADMIN' })).toEqual(refused);
    expect(await asAgent.attempt('PATCH', `/api/users/${agent.id}`, { role: 'ADMIN' })).toEqual(refused);
    expect(await asAgent.attempt('GET', '/api/ai/config')).toEqual(refused);
    expect(await asAgent.attempt('PUT', '/api/settings/reminders', { staleHours: 1 })).toEqual(refused);
    // What the screens of an agent read is open to them.
    expect((await asAgent.attempt('GET', '/api/users')).status).toBe(200);
    expect(await asAgent.attempt('GET', '/api/ai/status')).toEqual({ status: 200, message: undefined });
  } finally {
    await asAgent.dispose();
  }
});

test('un administrador hace administrador a un agente, que entonces ve Usuarios', async ({ page, api, newUser, pageAs }) => {
  const agent = await newUser();

  await page.goto('/configuracion');
  await expect(page.getByRole('tab', { name: 'Usuarios', selected: true })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: agent.username });
  await expect(row.getByRole('cell', { name: 'Agente', exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Hacer administrador' }).click();
  await expect(toast(page, `Rol de ${agent.name}: Administrador`)).toBeVisible();
  await expect(row.getByRole('cell', { name: 'Administrador', exact: true })).toBeVisible();
  expect((await api.users()).find((user) => user.id === agent.id)?.role).toBe('ADMIN');

  // Nobody changes their own role: the row of the session has no button for it.
  const own = page.getByRole('row').filter({ has: page.getByRole('textbox', { name: 'Nombre de admin', exact: true }) });
  await expect(own.getByRole('button', { name: /^Hacer / })).toHaveCount(0);

  const promoted = await pageAs(agent);
  await promoted.goto('/configuracion');
  await expect(promoted.getByRole('tablist').getByRole('tab')).toHaveText([
    'Usuarios',
    'Responsables',
    'Empresas',
    'Tipos de soporte',
    'Módulos',
    ...ADMIN_TABS.slice(1),
    'Mi cuenta',
  ]);
});
