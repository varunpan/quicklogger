import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

const FIXTURE = path.resolve('tests/e2e/sample.jpg');

// All tests navigate via `gotoHomeViaClientRouter` (settings → menu → Log Fuel)
// because `+page.ts` `load` runs server-side on a hard `page.goto('/')` and
// Playwright's `page.route()` mocks don't intercept SvelteKit's in-process
// server fetches. Going through the client router re-runs `load` in the
// browser where the route mocks (especially `/api/ocr`) apply.

async function commonRoutes(page: Page, lastFuelup: object | null = null) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ json: lastFuelup })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
}

// DOM ordering in src/routes/+page.svelte after feat/photo-capture-refinements:
// pump and odometer file inputs both render in the top capture row, in that
// order — pump first, then odometer.
//   - pump file input is nth=0
//   - odometer file input is nth=1

test('pump: chip appears + Use populates Volume + Cost', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });

  await gotoHomeViaClientRouter(page);
  const pumpTrigger = page.getByRole('button', { name: /Read pump display from photo/i });
  await expect(pumpTrigger).toBeVisible();

  // Pump file input is nth=0 (top capture row renders pump first, odometer second).
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  // Wait for confirm chip rendering
  await expect(page.getByText(/Detected:/)).toBeVisible();
  await expect(page.getByText(/11\.2 gal · \$42\.18/)).toBeVisible();

  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.locator('input[placeholder="11.2"]')).toHaveValue('11.2');
  await expect(page.locator('input[placeholder="42.18"]')).toHaveValue('42.18');
});

test('pump: Discard dismisses chip without populating', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({
      json: { mode: 'pump', volume: 5, volumeUnit: 'gal', cost: 20, pricePerUnit: 4 }
    });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Discard', exact: true }).click();
  await expect(page.getByText(/Detected:/)).toHaveCount(0);
  await expect(page.locator('input[placeholder="11.2"]')).toHaveValue('');
});

test('odometer: chip appears + Use populates Odometer', async ({ page }) => {
  await commonRoutes(page, {
    date: '2026-05-08',
    odometer: 87432,
    fuelConsumed: 11.2,
    cost: 42.18,
    notes: ''
  });
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({ json: { mode: 'odometer', odometer: 87612 } });
  });
  await gotoHomeViaClientRouter(page);
  const odoTrigger = page.getByRole('button', { name: /Read odometer from photo/i });
  await expect(odoTrigger).toBeVisible();

  // Odometer file input is nth=1 (top capture row: pump first, odometer second).
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=1', FIXTURE);
  await expect(page.getByText(/Detected: 87,612 mi/)).toBeVisible();
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.locator('input#odometer')).toHaveValue('87612');
});

test('odometer: detected > last + 2000 → amber advisory, [Use anyway] populates', async ({ page }) => {
  await commonRoutes(page, {
    date: '2026-05-08', odometer: 87432, fuelConsumed: 11.2, cost: 42.18, notes: ''
  });
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({ json: { mode: 'odometer', odometer: 92500 } });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=1', FIXTURE);
  await expect(page.getByText(/> 2,000 mi above last fillup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use anyway', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use anyway', exact: true }).click();
  await expect(page.locator('input#odometer')).toHaveValue('92500');
});

test('odometer: detected < last → amber advisory, [Use anyway] populates', async ({ page }) => {
  await commonRoutes(page, {
    date: '2026-05-08', odometer: 87432, fuelConsumed: 11.2, cost: 42.18, notes: ''
  });
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({ json: { mode: 'odometer', odometer: 80000 } });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=1', FIXTURE);
  await expect(page.getByText(/lower than last fillup/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use anyway', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Use anyway', exact: true }).click();
  await expect(page.locator('input#odometer')).toHaveValue('80000');
});

test('chips hidden when ocrEnabled=false', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => route.fulfill({ json: { enabled: false } }));
  await gotoHomeViaClientRouter(page);
  await expect(page.getByRole('button', { name: /Read pump display from photo/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Read odometer from photo/i })).toHaveCount(0);
});

test('429 surfaces as a toast with Retry-After', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({
      status: 429,
      headers: { 'retry-after': '120' },
      json: { error: 'rate limit', retryAfter: 120 }
    });
  });
  await gotoHomeViaClientRouter(page);
  // pump trigger (nth=0 — pump file input renders first in the top capture row)
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.getByText(/OCR rate limit reached, try again in 120s/)).toBeVisible();
});

test('502 surfaces as service-unreachable toast', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({ status: 502, json: { error: 'upstream' } });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.getByText(/OCR service unreachable/)).toBeVisible();
});

// (Removed in feat/photo-capture-refinements — odometer photo trigger now
// lives in the top capture row, not next to the +N mi chip. Kept here as a
// breadcrumb so a future contributor doesn't recreate the assertion.)

test('422 cross-field surfaces as "Couldn\'t read clearly"', async ({ page }) => {
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({ status: 422, json: { error: 'cross-field drift 58%' } });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.getByText(/Couldn't read clearly/)).toBeVisible();
});
