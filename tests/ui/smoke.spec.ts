import { test, expect } from '@playwright/test';

// Key routes (see src/App.tsx): `/` is the public marketing landing page; the
// video app now lives under `/app`. /app/watch/:id and /app/channel/:id need
// real content ids, so they are covered indirectly through navigation tests later.
const pages = ['/', '/app', '/app/search', '/app/library', '/app/settings', '/app/import'];

// Console noise that is expected in dev and must not fail the smoke test
// (e.g. remote catalog backends being unreachable in an offline/dev environment).
const IGNORED_CONSOLE = [/net::ERR_/i, /Failed to fetch/i, /favicon/i];

for (const path of pages) {
  test.describe(`page ${path}`, () => {
    test('responds 200 with no console errors', async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error' && !IGNORED_CONSOLE.some((re) => re.test(msg.text()))) {
          errors.push(msg.text());
        }
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
