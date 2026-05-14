import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

const FIXTURE = path.resolve('tests/e2e/sample.jpg');

async function commonRoutes(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });
}

test('preview: opens between picker and OCR call', async ({ page }) => {
  await commonRoutes(page);
  await gotoHomeViaClientRouter(page);
  // Pump file input is nth=0 in the new top capture row.
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  const dialog = page.getByRole('dialog', { name: /Photo preview/i });
  await expect(dialog).toBeVisible();
  // Header reads "Preview · Pump display" — scope the text assertions to
  // the dialog so they don't collide with the "Pump display photo" pill
  // sitting underneath in the form.
  await expect(dialog.getByText(/Preview/i)).toBeVisible();
  await expect(dialog.getByText('Pump display', { exact: true })).toBeVisible();
});

test('preview: Send for OCR dismisses preview and OCR chip appears', async ({ page }) => {
  await commonRoutes(page);
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Photo preview/i })).toHaveCount(0);
  await expect(page.getByText(/11\.2 gal · \$42\.18/)).toBeVisible();
});

test('preview: Cancel returns to form, no OCR call, no chip', async ({ page }) => {
  await commonRoutes(page);
  let ocrPostFired = false;
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    ocrPostFired = true;
    return route.fulfill({ status: 500, json: { error: 'should not have been called' } });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: /Photo preview/i })).toHaveCount(0);
  await expect(page.getByText(/Detected:/)).toHaveCount(0);
  expect(ocrPostFired).toBe(false);
});

test('preview: rotate then send POSTs rotation form field', async ({ page }) => {
  await commonRoutes(page);
  let postedRotation: string | null = null;
  await page.route('**/api/ocr', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    const body = route.request().postData() ?? '';
    // Multipart body — look for the rotation form field name.
    const match = body.match(/name="rotation"\r?\n\r?\n(\d+)/);
    postedRotation = match ? match[1] : null;
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: /Rotate right/i }).click();
  await page.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByText(/11\.2 gal · \$42\.18/)).toBeVisible();
  expect(postedRotation).toBe('90');
});

test('preview: Send without rotating omits the rotation form field (wire-compat)', async ({ page }) => {
  await commonRoutes(page);
  let bodySaw = '';
  await page.route('**/api/ocr', async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    bodySaw = route.request().postData() ?? '';
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByText(/Detected:/)).toBeVisible();
  expect(bodySaw).not.toMatch(/name="rotation"/);
});
