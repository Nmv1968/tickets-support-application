import type { Page } from '@playwright/test';

/** What the browser reported against the security headers of a page (web/security-headers.conf). */
export interface PolicyReports {
  /** Violations of the Content-Security-Policy, from the `securitypolicyviolation` events of the page. */
  violations: string[];
  /** Messages of the browser console about the Content-Security-Policy or the Permissions-Policy. */
  console: string[];
}

const POLICY_MESSAGE = /Content Security Policy|Content-Security-Policy|Permissions[- ]Policy|Feature[- ]Policy/i;

/**
 * Listens, from before the page loads and across all its navigations, to what the browser reports
 * against the Content-Security-Policy and the Permissions-Policy: the `securitypolicyviolation`
 * events of the page, and the messages of the browser console, which also tell what a policy
 * cannot report as an event (a feature of the Permissions-Policy the browser does not know, a
 * policy it cannot read). The console is read through the DevTools protocol: Chromium only, the
 * browser of these tests.
 */
export async function watchPolicies(page: Page): Promise<PolicyReports> {
  const reports: PolicyReports = { violations: [], console: [] };

  await page.exposeBinding('reportPolicyViolation', (_source, text: string) => {
    reports.violations.push(text);
  });
  await page.addInitScript(() => {
    const report = (text: string) => (window as unknown as { reportPolicyViolation(text: string): Promise<void> }).reportPolicyViolation(text);
    document.addEventListener('securitypolicyviolation', (event) => {
      void report(`${event.effectiveDirective} ${event.blockedURI || '-'} (${event.sourceFile || event.documentURI}:${event.lineNumber}) ${event.sample}`.trim());
    });
  });

  const devtools = await page.context().newCDPSession(page);
  devtools.on('Log.entryAdded', ({ entry }) => {
    if (POLICY_MESSAGE.test(entry.text)) reports.console.push(`${entry.level}: ${entry.text}`);
  });
  await devtools.send('Log.enable');

  return reports;
}

/**
 * Lets what the page reported reach the test: a violation is reported in a task of its own, after
 * what caused it. Two frames of the page are enough for it to have been sent.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
}
