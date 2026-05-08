import type { Page } from '@playwright/test';

export async function mockLubelogger(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) =>
    route.fulfill({ json: null })
  );
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 0.73, source: 'frankfurter', fetchedAt: Date.now(), stale: false, ageHours: 1 } })
  );
  await page.route('**/api/fuelup', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    return route.fulfill({
      json: {
        ok: true,
        submitted: {
          gallons: body.volume * (body.volumeUnit === 'L' ? 1 / 3.785411784 : 1),
          cost: body.cost * (body.currency === 'CAD' ? 0.73 : 1),
          fxRate: body.currency === 'CAD' ? 0.73 : 1,
          fxSource: 'frankfurter',
          fxStale: false
        }
      }
    });
  });
}
