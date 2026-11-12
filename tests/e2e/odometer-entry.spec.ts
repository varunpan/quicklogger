import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const VEHICLE = { id: 1, year: 2021, make: 'Toyota', model: 'Tacoma' };

const EQUIPMENT = [
  { id: 7, description: 'Off-road trailer', isEquipped: true, distanceTraveled: 1240 },
  { id: 8, description: 'Roof tent', isEquipped: false, distanceTraveled: 310 }
];

async function baseStubs(page: Page, opts: { equipment?: unknown[] } = {}) {
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [VEHICLE] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/vehicle/equipment**', (route) =>
    route.fulfill({ json: opts.equipment ?? EQUIPMENT })
  );
  await page.route('**/api/vehicle/info**', (route) =>
    route.fulfill({ json: { vehicleData: VEHICLE, lastReportedOdometer: 45100 } })
  );
}

// +page.ts load runs server-side during SSR; page.route() mocks don't intercept
// those in-process fetches. Visit /settings first, then click through the drawer
// so the loader re-runs client-side where the mocks apply.
async function gotoOdometerViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page).toHaveURL('/odometer');
}

test('prefills the current odometer and pre-checks equipped equipment', async ({ page }) => {
  await baseStubs(page);
  await gotoOdometerViaDrawer(page);

  await expect(page.locator('#odo-only')).toHaveValue('45100');
  await expect(page.getByText('prefilled')).toBeVisible();
  await expect(page.getByTestId('equipment-7')).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByTestId('equipment-8')).toHaveAttribute('aria-checked', 'false');
  // An untouched prefill would log 0 distance — submit stays disabled.
  await expect(page.getByRole('button', { name: 'Log odometer' })).toBeDisabled();
});

test('submits an odometer-only entry with the selected equipment', async ({ page }) => {
  await baseStubs(page);
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/odometer', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await expect(page.getByText('+220 mi')).toBeVisible();
  await page.getByTestId('equipment-8').click();
  await page.getByRole('button', { name: 'Log odometer' }).click();

  // Same landing as a logged fill-up.
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posted).toMatchObject({ vehicleId: 1, odometer: 45320, equipmentIds: [7, 8] });
});

test('a reading lower than the last one needs Submit anyway', async ({ page }) => {
  await baseStubs(page);
  let posts = 0;
  await page.route('**/api/odometer', async (route) => {
    posts++;
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45000');
  await expect(page.getByTestId('smart-check-chip')).toContainText('lower than the last reading');
  await expect(page.getByRole('button', { name: 'Log odometer' })).toBeDisabled();

  await page.getByRole('button', { name: 'Submit anyway' }).click();
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posts).toBe(1);
});

test('shows a hint when the vehicle has no equipment', async ({ page }) => {
  await baseStubs(page, { equipment: [] });
  await gotoOdometerViaDrawer(page);
  await expect(page.getByText('No equipment on this vehicle.')).toBeVisible();
});

test('surfaces a 4xx rejection as an error toast without queueing', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/odometer', (route) =>
    route.fulfill({ status: 400, json: { error: 'Could not add odometer record to LubeLogger' } })
  );
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();
  await expect(page.getByRole('alert')).toContainText('Submission rejected');
  await expect(page).toHaveURL('/odometer');
});

/**
 * Offline path. Aborting /api/odometer produces the same network-error
 * rejection real offline does and exercises the identical catch branch —
 * WebKit can't drive the real offline / service-worker path (same approach as
 * queued-submit-redirect.spec.ts).
 */
test('a failed submit queues the reading and lands on History', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/odometer', (route) => route.abort('failed'));
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();

  await page.waitForURL(/\/history\?vehicleId=1$/);
  const card = page.getByTestId('odometer-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Queued', { exact: true })).toBeVisible();
  await expect(card.getByText('45,320 mi')).toBeVisible();
  await expect(card.getByText('with Off-road trailer')).toBeVisible();
});

test('falls back to the cached equipment + odometer when LubeLogger is unreachable', async ({
  page
}) => {
  await baseStubs(page);
  // Prime the snapshot with one online visit, then cut the two upstream reads.
  await gotoOdometerViaDrawer(page);
  await expect(page.getByTestId('equipment-7')).toBeVisible();
  await page.unroute('**/api/vehicle/equipment**');
  await page.unroute('**/api/vehicle/info**');
  await page.route('**/api/vehicle/equipment**', (route) => route.abort('failed'));
  await page.route('**/api/vehicle/info**', (route) => route.abort('failed'));

  await page.getByRole('link', { name: '← Back to Log Fuel' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page).toHaveURL('/odometer');

  await expect(page.getByText('readings will be saved and synced later')).toBeVisible();
  await expect(page.getByTestId('equipment-7')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#odo-only')).toHaveValue('45100');
});
