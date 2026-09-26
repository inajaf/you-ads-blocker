import { test, expect } from '@playwright/test';

// Key routes (see src/App.tsx): `/` is the public marketing landing page; the
// video app now lives under `/app`. /app/watch/:id and /app/channel/:id need
// real content ids, so they are covered indirectly through navigation tests later.
const pages = ['/', '/app', '/app/search', '/app/library', '/app/settings', '/app/import'];

// Console noise that is expected in dev and must not fail the smoke test
// (e.g. remote catalog backends being unreachable in an offline/dev environment).
const IGNORED_CONSOLE = [/net::ERR_/i, /Failed to fetch/i, /favicon/i];

// Browsers report a failed subresource as a bare "Failed to load resource: the
// server responded with a status of 404" console error with no URL, so the text
// alone cannot tell our own asset apart from a third-party one. Third-party
// backends (Piped/proxy hosts) 404 thumbnails regularly in dev, which is the same
// class of noise as the entries above; our own 4xx must still fail.
const GENERIC_RESOURCE_ERROR = /Failed to load resource/i;
const LOCAL_HOST = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/i;

function trackFailedResponses(page: import('@playwright/test').Page) {
  const failed: { local: boolean }[] = [];
  page.on('response', (response) => {
    if (response.status() < 400) return;
    failed.push({ local: LOCAL_HOST.test(response.url()) });
  });
  return {
    /** True when a generic subresource failure is third-party-only noise. */
    isThirdPartyOnly() {
      return failed.length > 0 && failed.every((entry) => !entry.local);
    },
  };
}

for (const path of pages) {
  test.describe(`page ${path}`, () => {
    test('responds 200 with no console errors', async ({ page }) => {
      const errors: string[] = [];
      const failedResponses = trackFailedResponses(page);
      page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
        // A bare subresource failure is only ignored when every 4xx came from a
        // third party: our own missing asset must still fail this test.
        if (GENERIC_RESOURCE_ERROR.test(text) && failedResponses.isThirdPartyOnly()) return;
        errors.push(text);
      });
      page.on('pageerror', (err) => errors.push(err.message));

      const resp = await page.goto(path);
      expect(resp?.status()).toBe(200);
      await page.waitForLoadState('networkidle');
      expect(errors, `Console errors on ${path}:\n${errors.join('\n')}`).toHaveLength(0);
    });

    test('mobile width 390px — no horizontal scroll', async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth
      );
      expect(overflow, `Horizontal scroll on ${path} at 390px`).toBe(false);
    });
  });
}
