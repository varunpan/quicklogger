import { test, expect, type Page } from '@playwright/test';
import {
  pinClock,
  gotoHomeViaClientRouter,
  seedQueueEntry,
  seedLastFuelupCache
} from './fixtures';

test.use({ serviceWorkers: 'block' });

async function mockVehiclesAndFx(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2014, make: 'Honda', model: 'Accord' }] })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
}

test('upstream-down + cached snapshot renders strip with offline chip', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockVehiclesAndFx(page);
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ status: 502, body: '' })
  );
  await seedLastFuelupCache(page, 1, {
    id: '999',
    vehicleId: '1',
    date: '5/3/2026',
    odometer: '87234',
    fuelConsumed: '10.8',
    cost: '39.42',
    notes: 'Costco Pump 4'
  });
  await gotoHomeViaClientRouter(page);

  await expect(page.getByText(/Last fill: 87,234 mi · May 3, 2026 \(7 days ago\)/)).toBeVisible();
  await expect(page.getByText(/^offline copy$/i)).toBeVisible();
  // Cached upstream — costCurrency is null, so render uses $cost.
  await expect(page.getByText(/10\.8 Gal · \$39\.42 · Costco Pump 4/)).toBeVisible();
  // Field prefilled.
  await expect(page.getByPlaceholder('87,432')).toHaveValue('87234');
});

test('upstream-down + queue synced entry renders <currency> <cost>', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockVehiclesAndFx(page);
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ status: 502, body: '' })
  );
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-05-08',
      odometer: 87800,
      volume: 11.5,
      volumeUnit: 'gal',
      cost: 60,
      currency: 'CAD',
      isFillToFull: true,
      missedFuelup: false,
      clientSubmissionId: 'aaaa'
    },
    status: 'synced'
  });
  await gotoHomeViaClientRouter(page);

  await expect(page.getByText(/Last fill: 87,800 mi · May 8, 2026 \(2 days ago\)/)).toBeVisible();
  await expect(page.getByText(/^offline copy$/i)).toBeVisible();
  await expect(page.getByText(/11\.50 Gal · CAD 60\.00/)).toBeVisible();
  await expect(page.getByPlaceholder('87,432')).toHaveValue('87800');
});

test('upstream-down + nothing local: no strip, empty field', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockVehiclesAndFx(page);
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ status: 502, body: '' })
  );
  await gotoHomeViaClientRouter(page);

  await expect(page.getByText(/Last fill:/)).toHaveCount(0);
  await expect(page.getByText(/^offline copy$/i)).toHaveCount(0);
  await expect(page.getByPlaceholder('87,432')).toHaveValue('');
});

test('upstream-up: no offline chip on the strip', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockVehiclesAndFx(page);
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({
      json: {
        id: '999',
        vehicleId: '1',
        date: '5/3/2026',
        odometer: '87234',
        fuelConsumed: '10.8',
        cost: '39.42',
        notes: 'Costco Pump 4'
      }
    })
  );
  await gotoHomeViaClientRouter(page);

  await expect(page.getByText(/Last fill: 87,234 mi · May 3, 2026 \(7 days ago\)/)).toBeVisible();
  await expect(page.getByText(/^offline copy$/i)).toHaveCount(0);
});
