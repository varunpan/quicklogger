import { test, expect } from '@playwright/test';
import { mockWithLastFuelup, gotoHomeViaClientRouter, seedPrefs } from './fixtures';

test.use({ serviceWorkers: 'block' });

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
