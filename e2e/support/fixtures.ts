import { randomBytes } from 'node:crypto';
import { test as base } from '@playwright/test';
import type { Page } from '@playwright/test';
import { Api, login } from './api';
import type { TestUser } from './api';
import { BASE_URL, TIME_ZONE } from './env';
import { adminToken, storageStateFor } from './session';

interface Fixtures {
  /** The API as the admin, to set up what a test needs and to look at what it stored. */
  api: Api;
  /** Unique to this test: it goes into every name the test creates, so no two tests share data. */
  uid: string;
  /** A user of its own for the test, for what is kept per user (columns, the filter panel). */
  newUser: () => Promise<TestUser>;
  /** A browser of its own, logged in as that user. */
  pageAs: (user: TestUser) => Promise<Page>;
}

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const api = await Api.as(adminToken());
    await use(api);
    await api.dispose();
  },

  uid: async ({}, use) => {
    await use(`${Date.now().toString(36)}${randomBytes(3).toString('hex')}`);
  },

  newUser: async ({ api, uid }, use) => {
    let count = 0;
    await use(async () => {
      count++;
      const username = `e2e.${uid}.${count}`;
      return api.createUser({ username, name: `Usuario Demo ${count} ${uid}`, password: randomBytes(12).toString('hex') });
    });
  },

  pageAs: async ({ browser }, use) => {
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [];
    await use(async (user) => {
      const session = await login(user.username, user.password);
      const context = await browser.newContext({ baseURL: BASE_URL, timezoneId: TIME_ZONE, locale: 'es-EC', storageState: storageStateFor(session) });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect } from '@playwright/test';
