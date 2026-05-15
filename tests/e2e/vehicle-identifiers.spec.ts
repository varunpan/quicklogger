import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

// Stub navigator.clipboard.writeText and capture writes into
// window.__copies — WebKit headless restricts the Async Clipboard
// API even with permission grants. This is reliable across both
// chromium and webkit Playwright projects.
async function installClipboardStub(page: Page) {
  await page.addInitScript(() => {
    const copies: string[] = [];
    Object.defineProperty(window, '__copies', {
      value: copies,
      writable: false,
      configurable: true
    });
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async (value: string) => {
          copies.push(value);
        }
      }
    });
  });
}

async function readCopies(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as { __copies: string[] }).__copies.slice());
}

async function gotoMaintenanceViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Maintenance' }).click();
  await expect(page).toHaveURL('/maintenance');
}

async function baseStubs(
  page: Page,
  vehicle: Record<string, unknown>
) {
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [vehicle] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
}

const PLATE = 'MBL4635';
const VIN = '1HGCR2F80EA00735';
const VEHICLE_BOTH = {
  id: 1,
  year: 2014,
  make: 'Honda',
  model: 'Accord',
  licensePlate: PLATE,
  vin: VIN
};

test('both plate and VIN: card renders both rows; tap copies + flashes', async ({ page }) => {
  await installClipboardStub(page);
  await baseStubs(page, VEHICLE_BOTH);
  await gotoMaintenanceViaDrawer(page);

  const card = page.locator('[data-testid="vehicle-identifiers-card"]');
  await expect(card).toBeVisible();

  const plateRow = page.locator('[data-testid="vehicle-identifiers-plate"]');
  const vinRow = page.locator('[data-testid="vehicle-identifiers-vin"]');
  await expect(plateRow).toContainText('Plate');
  await expect(plateRow).toContainText(PLATE);
  await expect(vinRow).toContainText('VIN');
  await expect(vinRow).toContainText(VIN);

  // Tap plate row → clipboard captures PLATE + label flashes.
  await plateRow.click();
  expect(await readCopies(page)).toEqual([PLATE]);
  await expect(plateRow).toContainText('Copied ✓');
  await expect(plateRow).toContainText(PLATE);

  // After ~1.5s the label reverts. Give Playwright generous slack.
  await expect(plateRow).toContainText('Plate', { timeout: 3000 });

  // Tap VIN row → clipboard captures VIN, VIN row flashes.
  await vinRow.click();
  expect(await readCopies(page)).toEqual([PLATE, VIN]);
  await expect(vinRow).toContainText('Copied ✓');
  await expect(vinRow).toContainText(VIN);
});

test('only plate: VIN row absent', async ({ page }) => {
  await installClipboardStub(page);
  await baseStubs(page, { id: 1, year: 2014, make: 'Honda', model: 'Accord', licensePlate: PLATE });
  await gotoMaintenanceViaDrawer(page);

  await expect(page.locator('[data-testid="vehicle-identifiers-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-identifiers-plate"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-identifiers-vin"]')).toHaveCount(0);
});

test('only VIN: plate row absent', async ({ page }) => {
  await installClipboardStub(page);
  await baseStubs(page, { id: 1, year: 2014, make: 'Honda', model: 'Accord', vin: VIN });
  await gotoMaintenanceViaDrawer(page);

  await expect(page.locator('[data-testid="vehicle-identifiers-card"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-identifiers-vin"]')).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-identifiers-plate"]')).toHaveCount(0);
});

test('neither plate nor VIN: card not rendered', async ({ page }) => {
  await installClipboardStub(page);
  await baseStubs(page, { id: 1, year: 2014, make: 'Honda', model: 'Accord' });
  await gotoMaintenanceViaDrawer(page);

  // The page heading still renders; only the new card is absent.
  await expect(page.getByRole('heading', { name: 'Upcoming maintenance' })).toBeVisible();
  await expect(page.locator('[data-testid="vehicle-identifiers-card"]')).toHaveCount(0);
});
