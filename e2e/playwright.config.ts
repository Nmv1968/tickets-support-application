import { defineConfig, devices } from '@playwright/test';
import { ADMIN_STATE, BASE_URL, TIME_ZONE } from './support/env';

const CI = !!process.env.CI;

/**
 * End-to-end tests against the throwaway stack of scripts/stack.mjs (`npm run stack:up`). Every
 * test makes its own data under unique names, so they run in parallel and in any order on the
 * same database.
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './support/global-setup.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: CI ? [['list'], ['html', { open: 'never' }], ['github']] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    storageState: ADMIN_STATE,
    // The browser in the zone of the application: "today" is the same day for the case form and the API.
    timezoneId: TIME_ZONE,
    locale: 'es-EC',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
