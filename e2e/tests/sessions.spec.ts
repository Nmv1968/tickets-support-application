import { Api, login, loginStatus } from '../support/api';
import { BASE_URL } from '../support/env';
import { expect, test } from '../support/fixtures';
import { toast } from '../support/ui';

/** A stream of events opened with this token as the web opens it, through nginx, and read as it arrives. */
async function openStream(token: string): Promise<{ status: number; isOpen: () => boolean; close: () => void }> {
  const abort = new AbortController();
  const response = await fetch(`${BASE_URL}/api/events`, { headers: { Authorization: `Bearer ${token}`, Accept: 'text/event-stream' }, signal: abort.signal });
  let open = response.ok;
  if (response.body) {
    const reader = response.body.getReader();
    void (async () => {
      try {
        while (!(await reader.read()).done);
      } catch {
        // Closed by the test.
      }
      open = false;
    })();
  }
  return { status: response.status, isOpen: () => open, close: () => abort.abort() };
}

test('quien cambia su contraseña sigue en su sesión y las demás sesiones suyas se cierran', async ({ newUser, pageAs }) => {
  const user = await newUser();
  const page = await pageAs(user);
  // The same person logged in somewhere else: another browser, another device.
  const elsewhere = await Api.loggedIn(user);
  const next = `${user.password}-nueva`;

  try {
    await page.goto('/configuracion');
    await page.getByRole('tab', { name: 'Mi cuenta' }).click();
    await page.getByLabel('Contraseña actual').fill(user.password);
    await page.getByLabel('Contraseña nueva (mínimo 6 caracteres)').fill(next);
    await page.getByRole('button', { name: 'Cambiar contraseña' }).click();
    await expect(toast(page, 'Contraseña cambiada. Si tenías la sesión abierta en otro navegador o equipo, allí se cerró.')).toBeVisible();

    // This session goes on, with the token the API answered, after a reload too.
    await page.reload();
    await page.goto('/casos');
    await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
    await expect(page).toHaveURL(/\/casos$/);

    // The other one is over, and only the new password logs in.
    expect((await elsewhere.attempt('GET', '/api/auth/me')).status).toBe(401);
    expect(await loginStatus(user.username, user.password)).toBe(401);
    expect(await loginStatus(user.username, next)).toBe(200);
  } finally {
    await elsewhere.dispose();
  }
});

test('un administrador que cambia la contraseña de alguien cierra la sesión que esa persona tenía abierta', async ({ api, newUser, pageAs }) => {
  const user = await newUser();
  const page = await pageAs(user);
  await page.goto('/casos');
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();

  expect((await api.attempt('PATCH', `/api/users/${user.id}`, { password: `${user.password}-otra` })).status).toBe(200);

  // Whatever the screen asks next is refused: the web goes back to the login screen.
  await page.goto('/casos');
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
});

// Changed from Usuarios, it would end the very session that changes it. An administrator of its
// own: the one of the stack is the session every other test runs with.
test('un administrador cambia su propia contraseña en Mi cuenta, no en Usuarios', async ({ newUser, pageAs }) => {
  const admin = await newUser('ADMIN');
  const page = await pageAs(admin);

  await page.goto('/configuracion');
  const own = page.getByRole('row').filter({ has: page.getByRole('textbox', { name: `Nombre de ${admin.username}`, exact: true }) });
  await expect(own.getByText('Tu contraseña, en Mi cuenta')).toBeVisible();
  await expect(own.getByRole('button')).toHaveCount(0);

  // Asked of the API all the same, it refuses, and the session goes on.
  const asAdmin = await Api.loggedIn(admin);
  try {
    expect(await asAdmin.attempt('PATCH', `/api/users/${admin.id}`, { password: 'no-se-guarda' })).toEqual({
      status: 400,
      message: 'Tu propia contraseña se cambia en Configuración > Mi cuenta, con la contraseña actual.',
    });
    expect((await asAdmin.attempt('GET', '/api/auth/me')).status).toBe(200);
  } finally {
    await asAdmin.dispose();
  }
  expect(await loginStatus(admin.username, admin.password)).toBe(200);
});

// The API looks at the token of a stream when it opens: the stream itself ends with the session.
test('un flujo de eventos abierto se cierra cuando un administrador cambia la contraseña de su usuario', async ({ api, newUser }) => {
  const user = await newUser();
  const other = await newUser();
  const token = (await login(user.username, user.password)).token;
  const stream = await openStream(token);
  const otherStream = await openStream((await login(other.username, other.password)).token);

  try {
    expect(stream.status).toBe(200);
    expect(otherStream.status).toBe(200);

    expect((await api.attempt('PATCH', `/api/users/${user.id}`, { password: `${user.password}-otra` })).status).toBe(200);

    await expect.poll(stream.isOpen, { timeout: 5_000 }).toBe(false);
    // Opened again with the same token, it is refused; the stream of someone else goes on.
    const again = await openStream(token);
    again.close();
    expect(again.status).toBe(401);
    expect(otherStream.isOpen()).toBe(true);
  } finally {
    stream.close();
    otherStream.close();
  }
});

// Nothing is asked of the page, and no change is announced to it (an edit in Usuarios would make it
// read the catalogs again, and that request would be refused): its stream ends, opening it again
// is refused, and the web goes back to the login screen on its own.
test('cambiar la contraseña desde otro equipo devuelve sola al ingreso la pantalla abierta con la anterior', async ({ newUser, pageAs }) => {
  const user = await newUser();
  const page = await pageAs(user);
  await page.goto('/casos');
  await expect(page.getByRole('heading', { name: 'Casos de soporte' })).toBeVisible();
  await expect(page.getByText('En vivo', { exact: true })).toBeVisible();

  const elsewhere = await Api.loggedIn(user);
  try {
    expect((await elsewhere.attempt('POST', '/api/auth/password', { current: user.password, next: `${user.password}-nueva` })).status).toBe(200);
  } finally {
    await elsewhere.dispose();
  }

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('button', { name: 'Ingresar', exact: true })).toBeVisible();
});
