import { test, expect } from '@playwright/test';
import { pinClock, mockWithLastFuelup, gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

test('renders last-fillup strip with both lines', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockWithLastFuelup(page);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill: 87,234 mi · 7 days ago/)).toBeVisible();
  await expect(page.getByText(/10\.8 Gal · \$39\.42 · Costco Pump 4/)).toBeVisible();
});

test('omits the strip when no last-fuelup exists', async ({ page }) => {
  await mockWithLastFuelup(page, null);
  await gotoHomeViaClientRouter(page);
  await expect(page.getByText(/Last fill:/)).toHaveCount(0);
});

test('strip omits volume when fuelconsumed is empty', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockWithLastFuelup(page, {
    id: 999,
    date: '5/3/2026',
    odometer: '109139',
    fuelconsumed: '',
    cost: '38.15',
    notes: ''
  });
  await gotoHomeViaClientRouter(page);
  // Scope to the strip container — it's the wrapper around the "Last fill:" line.
  const strip = page.locator('div.text-xs.text-zinc-500.mb-3.leading-relaxed');
  await expect(strip.getByText(/Last fill: 109,139 mi · 7 days ago/)).toBeVisible();
  // Second line shows only cost (no leading " Gal" from an empty volume)
  await expect(strip.getByText('$38.15')).toBeVisible();
  await expect(strip.getByText(/Gal/)).toHaveCount(0);
});

test('strip omits the second line entirely when volume, cost, and notes are all empty', async ({ page }) => {
  await pinClock(page, '2026-05-10T15:00:00');
  await mockWithLastFuelup(page, {
    id: 999,
    date: '5/3/2026',
    odometer: '109139',
    fuelconsumed: '',
    cost: '',
    notes: ''
  });
  await gotoHomeViaClientRouter(page);
  const strip = page.locator('div.text-xs.text-zinc-500.mb-3.leading-relaxed');
  await expect(strip.getByText(/Last fill: 109,139 mi · 7 days ago/)).toBeVisible();
  // The strip contains exactly one inner div (the odometer line) — no second line
  await expect(strip.locator('> div')).toHaveCount(1);
});
