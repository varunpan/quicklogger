import { test, expect } from '@playwright/test';
import { mockLubelogger } from './fixtures';

test('Apple Shortcut deep-link pre-fills the form', async ({ page }) => {
  await mockLubelogger(page);
  await page.goto('/?vehicleId=1&volume=11.2&volumeUnit=gal&cost=42.18&currency=USD&fillToFull=true');

  await expect(page.getByPlaceholder('11.2')).toHaveValue('11.2');
  await expect(page.getByPlaceholder('42.18')).toHaveValue('42.18');
  await expect(page.locator('select').first()).toHaveValue('USD');
});
