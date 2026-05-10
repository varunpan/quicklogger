import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

async function pinClock(page: Page) {
  await page.addInitScript(() => {
    const now = new Date('2026-05-10T15:00:00').getTime();
    const D = Date;
    // Forward all constructor args so multi-arg `new Date(y, m, d)` calls
    // (used in daysAgo's local-calendar arithmetic) still work correctly.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).Date = class extends D {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      constructor(...args: any[]) {
        if (args.length === 0) super(now);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        else super(...(args as [any]));
      }
      static now() { return now; }
    };
  });
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
        cost: '39.42',
        notes: 'Costco Pump 4'
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

test('renders last-fillup strip with both lines', async ({ page }) => {
  await pinClock(page);
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill: 87,234 mi · 7 days ago/)).toBeVisible();
  await expect(page.getByText(/10\.8 Gal · \$39\.42 · Costco Pump 4/)).toBeVisible();
});

test('omits the strip when no last-fuelup exists', async ({ page }) => {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2014, make: 'Honda', model: 'Accord' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill:/)).toHaveCount(0);
});
