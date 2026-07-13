import { test, expect } from '@playwright/test';
import { seedPrefs } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests (the SW intercepts /api/* GETs by default).
test.use({ serviceWorkers: 'block' });

// When the FX chain is down (/api/fx → 503), the form offers a manual-rate
// field. A rate typed there belongs to the currency it was typed for —
// switching the currency select must clear it, because the server applies
// `manualFxRate` unconditionally (src/lib/server/convert.ts). The regression:
// switching back to the target currency hid the field but retained the value,
// and submit silently sent the stale rate.
test('switching currency back to the target clears a typed manual FX rate', async ({ page }) => {
  await seedPrefs(page, { smartChecksEnabled: false });
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  // FX chain all-fail: the deliberate 503 → { available: false } → manual field.
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ status: 503, json: { available: false } })
  );
  // Maintenance endpoint must respond — the post-submit redirect navigates here.
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/fuelup', async (route) => {
    posted = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      json: {
        ok: true,
        submitted: {
          gallons: 11.2,
          cost: 42.18,
          currency: 'USD',
          fxRate: 1,
          fxSource: 'identity',
          fxStale: false
        }
      }
    });
  });

  await page.goto('/');

  await page.locator('#odometer').fill('87432');
  await page.getByLabel('Volume', { exact: true }).fill('11.2');
  await page.getByLabel('Cost', { exact: true }).fill('42.18');

  const currencySelect = page.locator('select', {
    has: page.locator('option', { hasText: 'CAD' })
  });
  await currencySelect.selectOption('CAD');
  const manualRate = page.getByPlaceholder('0.73');
  await expect(manualRate).toBeVisible();
  await manualRate.fill('0.72');

  // Back to the target currency: the field hides and the typed rate goes with it.
  await currencySelect.selectOption('USD');
  await expect(manualRate).not.toBeVisible();

  await page.getByRole('button', { name: /^log fillup$/i }).click();
  await expect.poll(() => posted).not.toBeNull();
  expect(posted).not.toHaveProperty('manualFxRate');
  expect(posted!.currency).toBe('USD');
});
