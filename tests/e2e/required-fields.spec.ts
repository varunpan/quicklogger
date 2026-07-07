import { test, expect } from '@playwright/test';
import { mockLubelogger, seedPrefs } from './fixtures';

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

    await page.locator('#odometer').fill('87432');
    await page.getByLabel('Volume', { exact: true }).fill('11.2');
    await page.getByLabel('Cost', { exact: true }).fill('42.18');

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
    await page.locator('#odometer').fill('87432');
    await page.getByLabel('Volume', { exact: true }).fill('11.2');
    await page.getByLabel('Cost', { exact: true }).fill('42.18');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeEnabled();
  });

  test('a pasted decimal odometer is rounded to a whole number on submit', async ({ page }) => {
    // Typing '.' is blocked at the keydown level, but paste/autofill bypasses
    // it — the submit path must round whatever landed in the field.
    await seedPrefs(page, { smartChecksEnabled: false });
    await mockLubelogger(page);
    await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
    let posted: Record<string, unknown> | null = null;
    // Registered after mockLubelogger so it takes precedence for /api/fuelup.
    await page.route('**/api/fuelup', async (route) => {
      posted = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        json: {
          ok: true,
          submitted: { gallons: 11.2, cost: 42.18, currency: 'USD', fxRate: 1, fxSource: 'identity', fxStale: false }
        }
      });
    });
    await page.goto('/');

    await page.locator('#odometer').fill('50123.4');
    await page.getByLabel('Volume', { exact: true }).fill('11.2');
    await page.getByLabel('Cost', { exact: true }).fill('42.18');
    await page.getByRole('button', { name: /^log fillup$/i }).click();

    await expect.poll(() => posted).not.toBeNull();
    expect(posted!.odometer).toBe(50123);
  });

  test('button stays disabled when volume is 0', async ({ page }) => {
    await mockLubelogger(page);
    await page.goto('/');

    await page.locator('#odometer').fill('87432');
    await page.getByLabel('Volume', { exact: true }).fill('0');
    await page.getByLabel('Cost', { exact: true }).fill('42.18');

    const button = page.getByRole('button', { name: /^log fillup$/i });
    await expect(button).toBeDisabled();
  });
});
