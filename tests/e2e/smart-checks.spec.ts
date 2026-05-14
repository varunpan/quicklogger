import { test, expect } from '@playwright/test';
import {
  mockWithLastFuelup,
  gotoHomeViaClientRouter,
  seedPrefs,
  pinClock
} from './fixtures';

test.use({ serviceWorkers: 'block' });

// Intercept the POST so no test ever writes garbage data to the real upstream.
// The success path navigates to /maintenance?vehicleId=1, which server-side-loads
// /api/vehicle/reminders — mock that too (empty list) so SSR doesn't hit real upstream.
test.beforeEach(async ({ page }) => {
  await page.route('**/api/fuelup', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    return route.fulfill({
      json: {
        ok: true,
        submitted: {
          gallons: body.volume * (body.volumeUnit === 'L' ? 1 / 3.785411784 : 1),
          cost: body.cost * (body.currency === 'CAD' ? 0.73 : 1),
          fxRate: body.currency === 'CAD' ? 0.73 : 1,
          fxSource: 'frankfurter',
          fxStale: false
        }
      }
    });
  });
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
});

// Fixed local clock so check D ("future date") is deterministic. The
// fixture's DEFAULT_LAST_FUELUP is dated 5/3/2026; we pin "today" a few
// days later so the form's date default (today) doesn't accidentally
// trigger D.
const TODAY = '2026-05-14T12:00:00';

test('clean submit: valid values, no chip, posts immediately', async ({ page }) => {
  await pinClock(page, TODAY);
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);

  // Fill the required fields with valid values.
  await page.getByPlaceholder('87,432').fill('87500');
  await page.getByPlaceholder('11.2').fill('11.2');
  await page.getByPlaceholder('42.18').fill('42.50');

  // Tap Submit — no chip, navigates to /maintenance.
  await page.getByRole('button', { name: /^Log fillup$/ }).click();
  await expect(page).toHaveURL(/\/maintenance/);
  await expect(page.locator('[data-testid="smart-check-chip"]')).toHaveCount(0);
});

test('single-issue chip: low odometer triggers, Submit disabled, override posts', async ({ page }) => {
  await pinClock(page, TODAY);
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);

  // Odometer lower than last (87234), today's date, decent volume + cost.
  await page.getByPlaceholder('87,432').fill('1000');
  await page.getByPlaceholder('11.2').fill('11.2');
  await page.getByPlaceholder('42.18').fill('42.50');

  await page.getByRole('button', { name: /^Log fillup$/ }).click();

  // Chip appears with the A-line copy.
  const chip = page.locator('[data-testid="smart-check-chip"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('1 issue found');
  await expect(chip).toContainText(/Odometer .* is lower than the last fillup/);

  // Main Log fillup button is disabled.
  await expect(page.getByRole('button', { name: /^Log fillup$/ })).toBeDisabled();

  // Tap Submit anyway — fillup posts, navigates to /maintenance.
  await chip.getByRole('button', { name: 'Submit anyway' }).click();
  await expect(page).toHaveURL(/\/maintenance/);
});

test('multi-issue chip: low odo + future date + tiny volume → 3 lines, one override', async ({ page }) => {
  await pinClock(page, TODAY);
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);

  await page.getByPlaceholder('87,432').fill('1000');
  // Future date — type directly into the date input (it's bound).
  await page.locator('input[type="date"]').fill('2099-01-01');
  await page.getByPlaceholder('11.2').fill('0.1');
  await page.getByPlaceholder('42.18').fill('42.50');

  await page.getByRole('button', { name: /^Log fillup$/ }).click();

  const chip = page.locator('[data-testid="smart-check-chip"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('3 issues found');
  await expect(chip).toContainText(/Odometer .* is lower than the last fillup/);
  await expect(chip).toContainText('Date is in the future.');
  await expect(chip).toContainText(/Volume \(0\.1\) seems small/);

  // Exactly one Submit-anyway button.
  await expect(chip.getByRole('button', { name: 'Submit anyway' })).toHaveCount(1);
});

test('field-edit clears chip and re-enables Submit', async ({ page }) => {
  await pinClock(page, TODAY);
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);

  await page.getByPlaceholder('87,432').fill('1000');
  await page.getByPlaceholder('11.2').fill('11.2');
  await page.getByPlaceholder('42.18').fill('42.50');
  await page.getByRole('button', { name: /^Log fillup$/ }).click();

  const chip = page.locator('[data-testid="smart-check-chip"]');
  await expect(chip).toBeVisible();
  await expect(page.getByRole('button', { name: /^Log fillup$/ })).toBeDisabled();

  // Edit the odometer to a valid value.
  await page.getByPlaceholder('87,432').fill('87500');

  // Chip clears immediately; Submit re-enables.
  await expect(chip).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Log fillup$/ })).toBeEnabled();

  // Tap Submit again — posts cleanly.
  await page.getByRole('button', { name: /^Log fillup$/ }).click();
  await expect(page).toHaveURL(/\/maintenance/);
});

test('master toggle off: bad combination posts without a chip', async ({ page }) => {
  await pinClock(page, TODAY);
  await seedPrefs(page, {
    defaultVolumeUnit: 'gal',
    defaultCurrency: 'USD',
    odometerPrefillEnabled: true,
    odometerIncrementMi: 300,
    smartChecksEnabled: false
  });
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);

  // Same bad combo as the multi-issue test.
  await page.getByPlaceholder('87,432').fill('1000');
  await page.locator('input[type="date"]').fill('2099-01-01');
  await page.getByPlaceholder('11.2').fill('0.1');
  await page.getByPlaceholder('42.18').fill('42.50');

  await page.getByRole('button', { name: /^Log fillup$/ }).click();

  // No chip — straight through to /maintenance.
  await expect(page.locator('[data-testid="smart-check-chip"]')).toHaveCount(0);
  await expect(page).toHaveURL(/\/maintenance/);
});
