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

  await expect(page.getByRole('status')).toContainText(
    'Logged 45,320 mi with Off-road trailer, Roof tent'
  );
  expect(posted).toMatchObject({ vehicleId: 1, odometer: 45320, equipmentIds: [7, 8] });
});

test('shows a hint when the vehicle has no equipment', async ({ page }) => {
  await baseStubs(page, { equipment: [] });
  await gotoOdometerViaDrawer(page);
  await expect(page.getByText('No equipment on this vehicle.')).toBeVisible();
});

test('surfaces an upstream failure as an error toast', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/odometer', (route) =>
    route.fulfill({ status: 502, json: { error: 'Could not add odometer record to LubeLogger' } })
  );
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();
  await expect(page.getByRole('alert')).toContainText("Couldn't log odometer");
});
