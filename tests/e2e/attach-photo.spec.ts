import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

const FIXTURE = path.resolve('tests/e2e/sample.jpg');

const FUELUP_OK = {
  ok: true,
  submitted: {
    volume: 11.2,
    volumeUnit: 'gal',
    cost: 42.18,
    currency: 'USD',
    fxRate: 1,
    fxSource: 'identity',
    fxStale: false
  }
};

async function baseMocks(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({
      json: { date: '2026-05-08', odometer: 87000, fuelConsumed: 11.2, cost: 42.18, notes: '' }
    })
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
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });
}

async function captureAndApplyPump(page: Page) {
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  await page.locator('input#odometer').fill('87500');
}

test('attach on (default): submits multipart with a pumpImage part', async ({ page }) => {
  await baseMocks(page);
  let ct = '';
  let post: string | null = null;
  await page.route('**/api/fuelup', async (route) => {
    ct = route.request().headers()['content-type'] ?? '';
    post = route.request().postData();
    await route.fulfill({ json: FUELUP_OK });
  });

  await gotoHomeViaClientRouter(page);
  await captureAndApplyPump(page);
  await expect(
    page.getByRole('button', { name: /Attach photo(s)? to this record/i })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Log fillup', exact: true }).click();

  await expect.poll(() => ct).toContain('multipart/form-data');
  expect(post).toContain('pumpImage');
});

test('attach off: submits JSON without image parts', async ({ page }) => {
  await baseMocks(page);
  let ct = '';
  await page.route('**/api/fuelup', async (route) => {
    ct = route.request().headers()['content-type'] ?? '';
    await route.fulfill({ json: FUELUP_OK });
  });

  await gotoHomeViaClientRouter(page);
  await captureAndApplyPump(page);
  await page.getByRole('button', { name: /Attach photo(s)? to this record/i }).click();
  await page.getByRole('button', { name: 'Log fillup', exact: true }).click();

  await expect.poll(() => ct).toContain('application/json');
});

test('reopening the camera then cancelling keeps the retained photo attached', async ({ page }) => {
  await baseMocks(page);
  let post: string | null = null;
  await page.route('**/api/fuelup', async (route) => {
    post = route.request().postData();
    await route.fulfill({ json: FUELUP_OK });
  });

  await gotoHomeViaClientRouter(page);
  await captureAndApplyPump(page);
  const attachRow = page.getByRole('button', { name: /Attach photo(s)? to this record/i });
  await expect(attachRow).toBeVisible();

  // Reopen the pump camera (Playwright intercepts the chooser; we never pick)…
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Read pump display from photo' }).click();
  await chooser;
  // …and cancel: some browsers fire a change event with an empty file list.
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', []);

  // The retained blob must survive the cancel — row still visible, bytes still sent.
  await expect(attachRow).toBeVisible();
  await page.getByRole('button', { name: 'Log fillup', exact: true }).click();
  await expect.poll(() => post).toContain('pumpImage');
});

test('offline + attach: queues text-only and shows the "photo not attached" toast', async ({
  page
}) => {
  await baseMocks(page);
  await page.route('**/api/fuelup', (route) => route.abort('failed'));

  await gotoHomeViaClientRouter(page);
  await captureAndApplyPump(page);
  await page.getByRole('button', { name: 'Log fillup', exact: true }).click();

  // Locate by ARIA role: the queued toast must be announced to screen
  // readers (role="status" — review Q5), not just painted.
  await expect(
    page.getByRole('status').filter({ hasText: 'Saved locally — photo not attached.' })
  ).toBeVisible();

  // Photos are online-only — a queued entry can never carry them. The
  // staged attach row must not survive a queued save into the next entry.
  await expect(page.getByRole('button', { name: /Attach photo(s)? to this record/i })).toHaveCount(
    0
  );
});
