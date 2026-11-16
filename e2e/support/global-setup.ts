import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { request } from '@playwright/test';
import { login } from './api';
import { ADMIN_PASSWORD, ADMIN_STATE, ADMIN_USERNAME, BASE_URL } from './env';
import { storageStateFor } from './session';

/**
 * Logs in once as the admin of the stack and keeps the session as the browser keeps it, so that
 * the tests start already inside the application. The login screen has a test of its own.
 */
export default async function globalSetup(): Promise<void> {
  const probe = await request.newContext({ baseURL: BASE_URL });
  try {
    // The health check of the API: it answers once the API is up and reaches its database.
    const response = await probe.get('/api/health', { timeout: 10_000 }).catch(() => null);
    if (!response?.ok()) {
      throw new Error(`El API no responde en ${BASE_URL}. Levanta la pila de pruebas con "npm run stack:up" (en e2e/).`);
    }
  } finally {
    await probe.dispose();
  }
  if (!ADMIN_PASSWORD) throw new Error('Falta la contraseña del admin de pruebas: no existe e2e/.stack.env ni E2E_ADMIN_PASSWORD.');

  const session = await login(ADMIN_USERNAME, ADMIN_PASSWORD);
  mkdirSync(dirname(ADMIN_STATE), { recursive: true });
  writeFileSync(ADMIN_STATE, JSON.stringify(storageStateFor(session), null, 2));
}
