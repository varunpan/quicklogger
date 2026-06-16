import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

// Regression for #50: entering volume/cost (manually or via OCR) and then
// changing the vehicle wiped every field, forcing a re-entry / re-run of OCR.
// The vehicle picker is a separate route, so the change is a navigation
// round-trip that unmounts the form; the entered values must now ride through
// the picker on the URL and re-seed on return. The odometer is the one field
// that SHOULD reset — to the newly-picked vehicle's last fillup.
test('changing vehicle preserves entered values and resets the odometer (#50)', async ({ page }) => {
  // Two vehicles with distinct last-fuelup odometers so we can prove the
  // odometer re-prefills from the *newly picked* vehicle, not the old one.
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({
      json: [
        { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
        { id: 2, year: 2019, make: 'VW', model: 'Atlas' }
      ]
    })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => {
    const id = new URL(route.request().url()).searchParams.get('vehicleId');
    const odometer = id === '2' ? 55000 : 87234;
    route.fulfill({
      json: {
        id: 999,
        vehicleId: Number(id),
        date: '2026-05-03',
        odometer,
        fuelConsumed: 10.8,
        cost: 39.42
      }
    });
  });
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );

  // Enter the home form via the client router so the route mocks apply
  // (SSR-side fetches bypass page.route — see fixtures.gotoHomeViaClientRouter).
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Fuel' }).click();
  await expect(page).toHaveURL('/');

  // Vehicle 1 (Honda Accord) is selected; odometer prefilled from its last fillup.
  await expect(page.getByPlaceholder('87,432')).toHaveValue('87234');

  // Enter pump values, a custom date, and a note.
  await page.getByPlaceholder('11.2').fill('9.42');
  await page.getByPlaceholder('42.18').fill('33.17');
  await page.locator('input[type="date"]').fill('2026-05-20');
  await page.getByPlaceholder('Costco Pump 4, regular grade').fill('Shell premium');

  // Change the vehicle: open the picker, pick the other vehicle.
  await page.getByRole('button', { name: /Honda Accord/ }).click();
  await expect(page).toHaveURL(/\/vehicles/);
  await page.getByRole('button', { name: /VW Atlas/ }).click();
  await expect(page).toHaveURL(/vehicleId=2/);

  // The entered values survived the round-trip.
  await expect(page.getByPlaceholder('11.2')).toHaveValue('9.42');
  await expect(page.getByPlaceholder('42.18')).toHaveValue('33.17');
  await expect(page.locator('input[type="date"]')).toHaveValue('2026-05-20');
  await expect(page.getByPlaceholder('Costco Pump 4, regular grade')).toHaveValue('Shell premium');

  // The odometer reset to the newly-picked vehicle's last fillup (NOT carried).
  await expect(page.getByPlaceholder('87,432')).toHaveValue('55000');
});
