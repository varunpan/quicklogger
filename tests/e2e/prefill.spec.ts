import { test, expect } from '@playwright/test';
import { mockQuickloggerApi } from './fixtures';

test('Apple Shortcut deep-link pre-fills the form', async ({ page }) => {
  await mockQuickloggerApi(page);
  await page.goto('/?vehicleId=1&volume=11.2&volumeUnit=gal&cost=42.18&currency=USD&fillToFull=true');

  await expect(page.getByLabel('Volume', { exact: true })).toHaveValue('11.2');
  await expect(page.getByLabel('Cost', { exact: true })).toHaveValue('42.18');
  await expect(page.locator('select').first()).toHaveValue('USD');
});
