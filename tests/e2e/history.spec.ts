import { test, expect, type Page } from '@playwright/test';
import { pinClock, seedQueueEntry, seedPrefs } from './fixtures';

test.use({ serviceWorkers: 'block' });

const VEHICLE = { id: 1, year: 2014, make: 'Honda', model: 'Accord' };

async function mockVehiclesOnly(page: Page, vehicles = [VEHICLE]) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: vehicles })
  );
  // The new /history doesn't call /api/vehicle/last-fuelup or /api/fx
  // anymore, but we still mock vehicles because the loader uses it.
}

/**
 * Navigate to /history via the drawer rather than `page.goto`. Reason:
 * `+page.ts` `load` runs server-side during SSR, and Playwright's
 * `page.route()` mocks don't intercept those in-process SvelteKit
 * fetches. Re-running the loader client-side lets the mocks apply.
 * Mirrors `gotoMaintenanceViaDrawer` in maintenance.spec.ts.
 */
async function gotoHistoryViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL('/history');
}

test('empty IDB shows "No fillups logged on this device yet"', async ({ page }) => {
  await mockVehiclesOnly(page);
  await gotoHistoryViaDrawer(page);

  await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
  await expect(page.getByText(/2014 Honda Accord/)).toBeVisible();
  await expect(page.getByText('No fillups logged on this device yet.')).toBeVisible();
  await expect(page.getByText(/Only fillups logged through this PWA/)).toBeVisible();
});

test('rows for other vehicles only → "No fillups logged for this vehicle yet"', async ({ page }) => {
  await mockVehiclesOnly(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 99,
      date: '2026-05-01',
      odometer: 90000,
      volume: 10,
      volumeUnit: 'gal',
      cost: 35,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      clientSubmissionId: 'a'
    },
    status: 'synced'
  });
  await seedPrefs(page, { lastVehicleId: 1 });
  await gotoHistoryViaDrawer(page);

  await expect(page.getByText('No fillups logged for this vehicle yet.')).toBeVisible();
});

test('synced card renders without badge, with all optional lines', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-04-07',
      odometer: 105197,
      volume: 14.279,
      volumeUnit: 'gal',
      cost: 50.96,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      notes: 'clean windshield',
      tags: 'Costco',
      clientSubmissionId: 'b'
    },
    status: 'synced'
  });
  await gotoHistoryViaDrawer(page);

  // No badge.
  await expect(page.getByText('Queued', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Failed', { exact: true })).toHaveCount(0);
  // Date + relative.
  await expect(page.getByText('Apr 7, 2026 · 36 days ago')).toBeVisible();
  // Odometer.
  await expect(page.getByText('105,197 mi')).toBeVisible();
  // Fuel · cost (toFixed shapes).
  await expect(page.getByText('14.279 gal · USD 50.96')).toBeVisible();
  // Optional lines.
  await expect(page.getByText('Fill-to-full', { exact: true })).toBeVisible();
  await expect(page.getByText(/note: clean windshield/)).toBeVisible();
  await expect(page.getByText('#Costco', { exact: true })).toBeVisible();
});

test('queued card renders amber badge', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-05-12',
      odometer: 105420,
      volume: 11.8,
      volumeUnit: 'gal',
      cost: 42.15,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      tags: 'Costco',
      clientSubmissionId: 'c'
    },
    status: 'queued'
  });
  await gotoHistoryViaDrawer(page);

  const badge = page.getByText('Queued', { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/text-amber-300/);
  await expect(page.getByText('May 12, 2026 · yesterday')).toBeVisible();
});

test('failed card renders rose badge, error line, attempts line', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-04-30',
      odometer: 105100,
      volume: 12,
      volumeUnit: 'gal',
      cost: 44,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      clientSubmissionId: 'd'
    },
    status: 'failed',
    attempts: 3,
    lastError: '400 invalid odometer'
  });
  await gotoHistoryViaDrawer(page);

  const badge = page.getByText('Failed', { exact: true });
  await expect(badge).toBeVisible();
  await expect(badge).toHaveClass(/text-rose-300/);
  await expect(page.getByText(/error: 400 invalid odometer/)).toBeVisible();
  await expect(page.getByText(/attempts: 3/)).toBeVisible();
});

test('sort order: newer date first', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page);
  for (const date of ['2026-04-01', '2026-04-15', '2026-04-08']) {
    await seedQueueEntry(page, {
      input: {
        vehicleId: 1,
        date,
        odometer: 100000,
        volume: 10,
        volumeUnit: 'gal',
        cost: 30,
        currency: 'USD',
        isFillToFull: true,
        missedFuelup: false,
        clientSubmissionId: `e-${date}`
      },
      status: 'synced'
    });
  }
  await gotoHistoryViaDrawer(page);

  const fillupCards = page.locator('[data-testid="fillup-card"]');
  await expect(fillupCards).toHaveCount(3);
  await expect(fillupCards.nth(0)).toContainText('Apr 15, 2026');
  await expect(fillupCards.nth(1)).toContainText('Apr 8, 2026');
  await expect(fillupCards.nth(2)).toContainText('Apr 1, 2026');
});

test('same-date tie-breaker: higher enqueuedAt renders first', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-04-15',
      odometer: 100000,
      volume: 10,
      volumeUnit: 'gal',
      cost: 30,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      notes: 'earlier',
      clientSubmissionId: 'f1'
    },
    status: 'synced',
    enqueuedAt: 1000
  });
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-04-15',
      odometer: 100050,
      volume: 11,
      volumeUnit: 'gal',
      cost: 33,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      notes: 'later',
      clientSubmissionId: 'f2'
    },
    status: 'synced',
    enqueuedAt: 2000
  });
  await gotoHistoryViaDrawer(page);

  const fillupCards = page.locator('[data-testid="fillup-card"]');
  await expect(fillupCards).toHaveCount(2);
  await expect(fillupCards.nth(0)).toContainText('note: later');
  await expect(fillupCards.nth(1)).toContainText('note: earlier');
});

test('vehicle picker filters and round-trips through /vehicles', async ({ page }) => {
  await pinClock(page, '2026-05-13T10:00:00');
  await mockVehiclesOnly(page, [
    VEHICLE,
    { id: 2, year: 2021, make: 'Toyota', model: 'Sienna' }
  ]);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-04-15',
      odometer: 100000,
      volume: 10,
      volumeUnit: 'gal',
      cost: 30,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      notes: 'accord note',
      clientSubmissionId: 'g1'
    },
    status: 'synced'
  });
  await seedQueueEntry(page, {
    input: {
      vehicleId: 2,
      date: '2026-04-15',
      odometer: 50000,
      volume: 12,
      volumeUnit: 'gal',
      cost: 40,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      notes: 'sienna note',
      clientSubmissionId: 'g2'
    },
    status: 'synced'
  });
  await seedPrefs(page, { lastVehicleId: 1 });
  await gotoHistoryViaDrawer(page);

  // Vehicle 1 only.
  await expect(page.getByText(/accord note/)).toBeVisible();
  await expect(page.getByText(/sienna note/)).not.toBeVisible();

  // Tap picker → /vehicles?from=history → pick Sienna → land on /history?vehicleId=2.
  await page.getByRole('link', { name: /Vehicle\s*2014 Honda Accord/i }).click();
  await expect(page).toHaveURL('/vehicles?from=history');
  await page.getByRole('button', { name: /2021 Toyota Sienna/i }).click();
  await expect(page).toHaveURL(/\/history\?vehicleId=2/);

  await expect(page.getByText(/sienna note/)).toBeVisible();
  await expect(page.getByText(/accord note/)).not.toBeVisible();
});
