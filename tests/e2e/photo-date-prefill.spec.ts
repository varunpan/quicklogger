import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { gotoHomeViaClientRouter, pinClock } from './fixtures';

test.use({ serviceWorkers: 'block' });

const FIXTURE = path.resolve('tests/e2e/sample.jpg');
const CUE = '[data-testid="photo-date-cue"]';

async function commonRoutes(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ json: null })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    // Hang OCR so the preview modal stays mounted and doesn't race the
    // date-cue assertions. The e2e is about EXIF, not OCR.
    return new Promise(() => {});
  });
}

test('missing cue: sample.jpg has no DateTimeOriginal → amber chip appears', async ({ page }) => {
  await commonRoutes(page);
  await pinClock(page, '2026-05-15T12:00:00');
  await gotoHomeViaClientRouter(page);

  // Pump file input is the first file input on the page.
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);

  await expect(page.locator(CUE)).toBeVisible();
  await expect(page.locator(CUE)).toContainText('no date in photo');
  // Date stays at today (May 15)
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-05-15');
});

test('cue clears when user manually edits the date', async ({ page }) => {
  await commonRoutes(page);
  await pinClock(page, '2026-05-15T12:00:00');
  await gotoHomeViaClientRouter(page);

  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.locator(CUE)).toBeVisible();

  // Manually edit the date.
  await page.locator('input[type="date"]').fill('2026-05-10');
  await expect(page.locator(CUE)).not.toBeVisible();
});

test('cue persists when user dismisses the OCR preview', async ({ page }) => {
  await commonRoutes(page);
  await pinClock(page, '2026-05-15T12:00:00');
  await gotoHomeViaClientRouter(page);

  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.locator(CUE)).toBeVisible();

  // Cancel the OCR preview.
  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();
  // Cue should still be visible.
  await expect(page.locator(CUE)).toBeVisible();
});

test('picking a second photo replaces the cue', async ({ page }) => {
  await commonRoutes(page);
  await pinClock(page, '2026-05-15T12:00:00');
  await gotoHomeViaClientRouter(page);

  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.locator(CUE)).toBeVisible();

  // Dismiss preview, then pick the same fixture again.
  const cancelButton = page.getByRole('button', { name: 'Cancel', exact: true });
  await expect(cancelButton).toBeVisible();
  await cancelButton.click();

  // Re-open and re-pick.
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  // Cue is still 'missing' (same fixture). Assertion: chip exists, single instance.
  await expect(page.locator(CUE)).toHaveCount(1);
});

test('cue persists when user clicks Retake in the preview', async ({ page }) => {
  await commonRoutes(page);
  await pinClock(page, '2026-05-15T12:00:00');
  await gotoHomeViaClientRouter(page);

  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await expect(page.locator(CUE)).toBeVisible();

  // Click the Retake button inside the OCR preview. This re-fires the file
  // input and re-runs handlePumpCamera → prefillDateFromPhoto.
  const retakeButton = page.getByRole('button', { name: 'Retake', exact: true });
  await expect(retakeButton).toBeVisible();
  await retakeButton.click();

  // Re-pick the same fixture so the new readPhotoDate resolves.
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);

  // The cue should still be 'missing' (same fixture). Assert it's visible
  // and there's a single instance.
  await expect(page.locator(CUE)).toBeVisible();
  await expect(page.locator(CUE)).toHaveCount(1);
});
