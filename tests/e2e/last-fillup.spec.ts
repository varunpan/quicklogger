import { test, expect } from '@playwright/test';
import { pinClock, mockWithLastFuelup, gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('renders last-fillup strip with both lines', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill: 87,234 mi · May 3, 2026 \(7 days ago\)/)).toBeVisible();
  await expect(page.getByText(/10\.8 Gal · \$39\.42 · Costco Pump 4/)).toBeVisible();
});

test('omits the strip when no last-fuelup exists', async ({ page }) => {
  await mockWithLastFuelup(page, null);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill:/)).toHaveCount(0);
});

test('home strip renders cost in locale-correct currency format', async ({ page }) => {
  // Upstream cached entry → costCurrency is null → formatCost falls back to the
  // LubeLogger instance currency (USD by default). en-US locale renders as `$39.42`.
  await pinClock(page, '2026-05-10T15:00:00');
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/10\.8 Gal · \$39\.42/)).toBeVisible();
});
