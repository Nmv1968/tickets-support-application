import { readFileSync } from 'node:fs';
import type { BrowserContextOptions } from '@playwright/test';
import type { Session } from './api';
import { ADMIN_STATE, BASE_URL } from './env';

type StorageState = Exclude<BrowserContextOptions['storageState'], string | undefined>;

/** A browser already logged in as this user: the two keys the web reads its session from (web/src/app/core/auth.ts). */
export function storageStateFor(session: Session): StorageState {
  return {
    cookies: [],
    origins: [
      {
        origin: new URL(BASE_URL).origin,
        localStorage: [
          { name: 'st.token', value: session.token },
          { name: 'st.user', value: JSON.stringify(session.user) },
        ],
      },
    ],
  };
}

/** The token of the admin session the global setup saved. */
export function adminToken(): string {
  const state = JSON.parse(readFileSync(ADMIN_STATE, 'utf8')) as StorageState;
  const token = state.origins[0]?.localStorage.find((item) => item.name === 'st.token')?.value;
  if (!token) throw new Error(`${ADMIN_STATE} no tiene la sesión del admin`);
  return token;
}
