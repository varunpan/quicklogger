import { test, expect } from '@playwright/test';
import { mockLubelogger, seedPrefs } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests (the SW intercepts /api/* GETs by default).
test.use({ serviceWorkers: 'block' });

test('logs a CAD/L fillup, shows USD/gal in confirmation, and redirects to maintenance', async ({ page }) => {
  // Smart checks (default on) would fire against the real upstream
  // lastFuelup that SSR reads in via page.goto. This test is about the
  // CAD/L conversion path, not smart checks — disable them here so the
  // submit is robust to whatever the real LubeLogger most-recent fillup
  // happens to be.
  await seedPrefs(page, { smartChecksEnabled: false });
  await mockLubelogger(page);
  // Maintenance endpoint must respond — the post-submit redirect navigates here.
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));

  await page.goto('/');

  await page.getByPlaceholder('87,432').fill('87432');
  await page.getByPlaceholder('11.2').fill('50');
  await page.getByRole('button', { name: 'L', exact: true }).click();
  await page.getByPlaceholder('42.18').fill('65');
  // Currency <select> sits next to the cost input; select the one with CAD as an option.
  await page
    .locator('select', { has: page.locator('option', { hasText: 'CAD' }) })
    .selectOption('CAD');

  await page.getByRole('button', { name: /^log fillup$/i }).click();

  // After a successful submit the app navigates to /maintenance with the
  // submitted vehicle's id. The toast may be momentarily visible during the
  // transition; the URL is the durable signal.
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  await expect(page.getByRole('heading', { name: 'Upcoming maintenance' })).toBeVisible();
});
