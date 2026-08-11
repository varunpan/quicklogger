import { test, expect } from '@playwright/test';
import { mockQuickloggerApi, seedPrefs } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests.
test.use({ serviceWorkers: 'block' });

/**
 * Regression guard for the offline duplicate-queue bug: a submit that can't
 * reach the server used to leave the user on a fully-populated form with the
 * button re-enabled, so people tapped again and queued a second identical
 * fill-up. The queued path now resets the form and navigates to /history,
 * where the Queued badge is durable proof the entry landed.
 *
 * Aborting /api/fuelup produces the same network-error rejection real offline
 * does, and it exercises the identical catch branch — WebKit can't drive the
 * real offline / service-worker path (see the project's offline-e2e note).
 */
test('a failed submit queues the fill-up, resets the form, and lands on History', async ({
  page
}) => {
  await seedPrefs(page, { smartChecksEnabled: false, lastVehicleId: 1 });
  await mockQuickloggerApi(page);
  // Kill the submit only — the vehicle list still resolves so /history's
  // loader can render the picker card (offline it comes from the SW cache).
  await page.route('**/api/fuelup', (route) => route.abort('failed'));

  await page.goto('/');

  await page.locator('#odometer').fill('87432');
  await page.getByLabel('Volume', { exact: true }).fill('11.2');
  await page.getByLabel('Cost', { exact: true }).fill('40');
  await page.getByRole('button', { name: /^log fillup$/i }).click();

  await page.waitForURL(/\/history\?vehicleId=1$/);

  // Exactly one card, badged Queued — the duplicate this fix prevents would
  // show up as a second identical card here.
  await expect(page.getByTestId('fillup-card')).toHaveCount(1);
  await expect(page.getByText('Queued', { exact: true })).toBeVisible();
  await expect(page.getByText('87,432 mi')).toBeVisible();

  // Back on the form the pump values are gone, so a re-tap can't re-submit
  // the same fill-up.
  await page.goBack();
  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Cost', { exact: true })).toHaveValue('');
});
