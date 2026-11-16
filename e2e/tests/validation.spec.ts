import { expect, test } from '../support/fixtures';

// Through nginx and the API as its image is built: what a client that sends something the API
// cannot take reads. The web checks its forms before sending; the MCP server and anyone calling
// the API get these messages as they are.
test('el API explica en español, campo por campo, lo que no acepta de una solicitud', async ({ api, request }) => {
  expect(await api.attempt('POST', '/api/companies', { name: 'Empresa Demo', role: 'ADMIN' })).toEqual({ status: 400, message: ['El campo «role» no se admite'] });
  expect(await api.attempt('PUT', '/api/settings/reminders', { staleHours: 1.5, promiseSoonDays: 61 })).toEqual({
    status: 400,
    message: ['El campo «staleHours» debe ser un número entero', 'El campo «promiseSoonDays» no puede ser mayor que 60'],
  });
  expect(await api.attempt('GET', '/api/tickets/abc')).toEqual({ status: 400, message: 'El identificador «id» debe ser un número entero' });

  const broken = await request.post('/api/auth/login', { headers: { 'Content-Type': 'application/json' }, data: '{"username": ' });
  expect(broken.status()).toBe(400);
  expect(((await broken.json()) as { message: unknown }).message).toBe('Los datos enviados no son un JSON válido');
});
