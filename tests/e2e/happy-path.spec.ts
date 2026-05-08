import { test, expect } from '@playwright/test';
import { mockLubelogger } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests (the SW intercepts /api/* GETs by default).
test.use({ serviceWorkers: 'block' });

test('logs a CAD/L fillup and shows USD/gal in confirmation', async ({ page }) => {
  await mockLubelogger(page);
  await page.goto('/');

  await page.getByPlaceholder('87,432').fill('87432');
  await page.getByPlaceholder('11.2').fill('50');
  await page.getByRole('button', { name: 'L', exact: true }).click();
  await page.getByPlaceholder('42.18').fill('65');
  // Currency <select> sits next to the cost input; select the one with CAD as an option.
  await page.locator('select', { has: page.locator('option', { hasText: 'CAD' }) }).selectOption('CAD');

  await page.getByRole('button', { name: /^log fillup$/i }).click();

  await expect(page.getByText(/Logged: 13\.\d{2} Gal/)).toBeVisible();
  await expect(page.getByText(/\$47\.\d{2}/)).toBeVisible();
});
