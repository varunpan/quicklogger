import { test, expect } from '@playwright/test';
import { seedPrefs } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests (the SW intercepts /api/* GETs by default).
test.use({ serviceWorkers: 'block' });

// The 5xx/network catch branch of submit() falls back to enqueueing the
// fill-up in IndexedDB. If IDB itself is unavailable (Safari private mode,
// quota), that enqueue must NOT fail silently — the regression was an
// unguarded `Queue.open()` whose rejection escaped the handler: no toast,
// fill-up gone. The fix wraps it and surfaces an explicit "NOT saved" toast.
test('server 500 with IndexedDB unavailable shows the explicit NOT-saved toast', async ({
  page
}) => {
  await seedPrefs(page, { smartChecksEnabled: false });
  // Simulate Safari private mode: any indexedDB access throws. Must be set
  // before page scripts run. The last-fuelup mock below must return a real
  // record so the loader's offline resolver (which also opens IDB) never runs.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('indexedDB disabled (private mode)');
      }
    });
  });
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({
      json: { date: '2026-05-08', odometer: 87000, fuelConsumed: 11.2, cost: 42.18, notes: '' }
    })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );
  // Upstream down: 5xx routes submit() into the offline-fallback branch.
  await page.route('**/api/fuelup', (route) =>
    route.fulfill({ status: 500, json: { error: 'boom' } })
  );

  await page.goto('/');

  await page.locator('#odometer').fill('87432');
  await page.getByLabel('Volume', { exact: true }).fill('11.2');
  await page.getByLabel('Cost', { exact: true }).fill('42.18');
  await page.getByRole('button', { name: /^log fillup$/i }).click();

  // Locate by ARIA role: the toast must be announced to screen readers
  // (role="alert" for the error kind — review Q5), not just painted.
  await expect(
    page.getByRole('alert').filter({
      hasText: "Couldn't save — device storage unavailable. This fill-up was NOT saved."
    })
  ).toBeVisible();
});
