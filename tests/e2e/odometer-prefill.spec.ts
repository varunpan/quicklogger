import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function seedPrefs(page: Page, prefs: Record<string, unknown>) {
  await page.addInitScript((p) => {
    localStorage.setItem('quicklogger.prefs', JSON.stringify(p));
  }, prefs);
}

async function mockWithLastFuelup(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2014, make: 'Honda', model: 'Accord' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({
      json: {
        id: 999,
        date: '5/3/2026',
        odometer: '87234',
        fuelconsumed: '10.8',
        cost: '39.42'
      }
    })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
}

// Universal `+page.ts` `load` runs server-side during SSR — Playwright route
// mocks don't intercept those in-process SvelteKit fetches. Navigate to a
// non-form page first (its SSR data doesn't matter), then route into `/` via
// SvelteKit's client router so `load` re-runs in the browser where mocks apply.
async function gotoHomeViaClientRouter(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Fuel' }).click();
  await expect(page).toHaveURL('/');
}

test('field opens prefilled with last reading and a "prefilled" tag', async ({ page }) => {
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  const odo = page.getByPlaceholder('87,432');
  await expect(odo).toHaveValue('87234');
  await expect(page.getByText(/^prefilled$/i)).toBeVisible();
});

test('+300 mi chip increments the field on tap', async ({ page }) => {
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  const odo = page.getByPlaceholder('87,432');
  await page.getByRole('button', { name: /\+300 mi/ }).click();
  await expect(odo).toHaveValue('87534');
  await expect(page.getByText(/\+300 mi this tank/)).toBeVisible();
});

test('multi-tap stacks the increment', async ({ page }) => {
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  const chip = page.getByRole('button', { name: /\+300 mi/ });
  await chip.click();
  await chip.click();
  await expect(page.getByPlaceholder('87,432')).toHaveValue('87834');
  await expect(page.getByText(/\+600 mi this tank/)).toBeVisible();
});

test('manual edit replaces the prefill and updates the helper delta', async ({ page }) => {
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  const odo = page.getByPlaceholder('87,432');
  await odo.fill('87432');
  await expect(page.getByText(/\+198 mi this tank/)).toBeVisible();
});

test('chip is hidden when increment is 0', async ({ page }) => {
  await seedPrefs(page, { odometerPrefillEnabled: true, odometerIncrementMi: 0 });
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByRole('button', { name: /\+\d+ mi/ })).toHaveCount(0);
  await expect(page.getByPlaceholder('87,432')).toHaveValue('87234');
});

test('chip is hidden and field is empty when prefill is disabled', async ({ page }) => {
  await seedPrefs(page, { odometerPrefillEnabled: false, odometerIncrementMi: 300 });
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByPlaceholder('87,432')).toHaveValue('');
  await expect(page.getByRole('button', { name: /\+\d+ mi/ })).toHaveCount(0);
});
