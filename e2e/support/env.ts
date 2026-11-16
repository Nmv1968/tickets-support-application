import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The folder of the end-to-end tests. Playwright runs from it (npm scripts of e2e/). */
export const E2E_DIR = join(__dirname, '..');

/** A file of the repository, as text with \n line ends whatever the checkout left. */
export function repoFile(...path: string[]): string {
  return readFileSync(join(E2E_DIR, '..', ...path), 'utf8').split('\r\n').join('\n');
}

/** Written by `npm run stack:up` (scripts/stack.mjs): the port and the secrets of the throwaway stack. */
function stackEnv(): Record<string, string> {
  const file = join(E2E_DIR, '.stack.env');
  if (!existsSync(file)) return {};
  const values: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (match) values[match[1]] = match[2];
  }
  return values;
}

const stack = stackEnv();

export const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${stack.WEB_PORT ?? '4321'}`;
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME ?? stack.ADMIN_USERNAME ?? 'admin';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? stack.ADMIN_PASSWORD ?? '';

/** The browser of the admin session, saved by the global setup and used by every test unless it says otherwise. */
export const ADMIN_STATE = join(E2E_DIR, '.auth', 'admin.json');

/** The zone the application runs in (TZ of docker-compose.yml): "today" must be the same day for the browser and the API. */
export const TIME_ZONE = 'America/Guayaquil';
