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

// What used to come in English from Nest, Express and body-parser, before any route of the API ran.
test('el API dice en español que una ruta no existe, que la sesión terminó y que un envío pesa demasiado', async ({ api, request }) => {
  expect(await api.attempt('GET', '/api/nada-por-aqui')).toEqual({ status: 404, message: 'La ruta no existe.' });
  expect(await api.attempt('PUT', '/api/tickets', {})).toEqual({ status: 404, message: 'La ruta no existe.' });
  expect(await api.attempt('GET', '/api/tickets/%FF')).toEqual({ status: 400, message: 'La dirección tiene caracteres que no se pueden leer.' });
  expect(await api.attempt('POST', '/api/companies', { name: 'Grande', relleno: 'x'.repeat(200 * 1024) })).toEqual({
    status: 413,
    message: 'Los datos enviados pesan más de 100 KB, lo máximo que el sistema recibe en una solicitud.',
  });

  const withoutSession = await request.get('/api/tickets');
  expect(withoutSession.status()).toBe(401);
  expect(await withoutSession.json()).toEqual({ statusCode: 401, error: 'Unauthorized', message: 'La sesión terminó o no es válida. Vuelve a ingresar.' });
});

// The healthcheck of Docker Compose asks the API itself; this goes through nginx, as a monitor would.
test('el API dice sin sesión que está en marcha y llega a su base de datos, y nada más', async ({ request }) => {
  const health = await request.get('/api/health');

  expect(health.status()).toBe(200);
  expect(await health.json()).toEqual({ status: 'ok', database: 'ok' });
});
