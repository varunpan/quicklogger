import { test, expect } from '@playwright/test';
import { mockLubelogger } from './fixtures';

// Block the SvelteKit service worker so Playwright's page.route() interceptors
// see the API requests (the SW intercepts /api/* GETs by default).
test.use({ serviceWorkers: 'block' });

// All four fields (odometer, volume, cost, date) must be present with
// strictly positive numerics before the submit button enables. Mirrors the
// server-side validator in `/api/fuelup`'s `validate()`.

test.describe('submit gate — required fields', () => {
  test('button is disabled with empty form', async ({ page }) => {
    await mockLubelogger(page);
    await page.goto('/');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeDisabled();
  });

  test('button stays disabled when date is cleared even if other fields are valid', async ({ page }) => {
    await mockLubelogger(page);
    await page.goto('/');

    await page.getByPlaceholder('87,432').fill('87432');
    await page.getByPlaceholder('11.2').fill('11.2');
    await page.getByPlaceholder('42.18').fill('42.18');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeEnabled();

    // Clearing the date input should re-disable the button.
    await page.locator('input[type="date"]').fill('');
    await expect(button).toBeDisabled();
  });

  test('button enables when all four fields are valid', async ({ page }) => {
    await mockLubelogger(page);
    await page.goto('/');

    // Date prefills to today, so we just need the three numeric fields.
    await page.getByPlaceholder('87,432').fill('87432');
    await page.getByPlaceholder('11.2').fill('11.2');
    await page.getByPlaceholder('42.18').fill('42.18');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeEnabled();
  });

  test('button stays disabled when volume is 0', async ({ page }) => {
    await mockLubelogger(page);
    await page.goto('/');

    await page.getByPlaceholder('87,432').fill('87432');
    await page.getByPlaceholder('11.2').fill('0');
    await page.getByPlaceholder('42.18').fill('42.18');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeDisabled();
  });
});
