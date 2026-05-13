import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const VEHICLE = { id: 1, year: 2014, make: 'Honda', model: 'Accord' };

async function baseStubs(page: Page) {
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [VEHICLE] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );
}

/**
 * Navigate to /maintenance via the in-page SvelteKit router instead of a hard
 * load. Reason: `+page.ts` load runs server-side during SSR, and Playwright's
 * `page.route()` mocks don't intercept those in-process SvelteKit fetches.
 * Visiting `/settings` first then clicking through the drawer re-runs the
 * loader in the browser, where the mocks apply. Mirrors
 * `gotoHomeViaClientRouter` in fixtures.ts.
 */
async function gotoMaintenanceViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Maintenance' }).click();
  await expect(page).toHaveURL('/maintenance');
}

test('renders three PastDue reminders sorted most-overdue first', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/reminders**', (route) =>
    route.fulfill({
      json: [
        // NotUrgent — should be filtered out
        {
          vehicleId: '1',
          id: '2',
          description: 'Tire Rotation',
          urgency: 'NotUrgent',
          metric: 'Odometer',
          userMetric: 'Odometer',
          notes: '',
          dueDate: '10/3/2026',
          dueOdometer: '112552',
          dueDays: '0',
          dueDistance: '3000',
          tags: ''
        },
        // PastDue, -31 days
        {
          vehicleId: '1',
          id: '12',
          description: 'Engine Oil change',
          urgency: 'PastDue',
          metric: 'Date',
          userMetric: 'Both',
          notes: '',
          dueDate: '4/12/2026',
          dueOdometer: '115316',
          dueDays: '-31',
          dueDistance: '5764',
          tags: ''
        },
        // PastDue, -44 days — most overdue, sorts first
        {
          vehicleId: '1',
          id: '5',
          description: 'Brake Fluid',
          urgency: 'PastDue',
          metric: 'Date',
          userMetric: 'Date',
          notes: '',
          dueDate: '3/30/2026',
          dueOdometer: '0',
          dueDays: '-44',
          dueDistance: '0',
          tags: ''
        },
        // PastDue, -42 days
        {
          vehicleId: '1',
          id: '13',
          description: 'Windshield Wipers',
          urgency: 'PastDue',
          metric: 'Date',
          userMetric: 'Date',
          notes: '',
          dueDate: '4/1/2026',
          dueOdometer: '0',
          dueDays: '-42',
          dueDistance: '0',
          tags: ''
        }
      ]
    })
  );

  await gotoMaintenanceViaDrawer(page);

  await expect(page.getByRole('heading', { name: 'Upcoming maintenance' })).toBeVisible();
  await expect(page.getByText('2014 Honda Accord')).toBeVisible();

  // The three PastDue items render; NotUrgent ("Tire Rotation") does not.
  const cards = page.locator('main div.bg-zinc-800.rounded-xl');
  await expect(cards).toHaveCount(3);

  // Sort order: Brake Fluid (-44) → Windshield Wipers (-42) → Engine Oil change (-31)
  await expect(cards.nth(0)).toContainText('Brake Fluid');
  await expect(cards.nth(1)).toContainText('Windshield Wipers');
  await expect(cards.nth(2)).toContainText('Engine Oil change');

  await expect(page.getByText('Tire Rotation')).not.toBeVisible();

  // Past Due chip on each.
  await expect(page.getByText('Past Due', { exact: true }).first()).toBeVisible();

  // Engine Oil change is userMetric=Both → renders both lines.
  await expect(cards.nth(2)).toContainText('Due Apr 12, 2026');
  await expect(cards.nth(2)).toContainText('31 days overdue');
  await expect(cards.nth(2)).toContainText('Due at 115,316 mi');
  await expect(cards.nth(2)).toContainText('5,764 mi to go');

  // Back link present.
  await expect(page.getByRole('link', { name: /Back to Log Fuel/i })).toBeVisible();
});

test('shows the empty state when no items are not-OK', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/reminders**', (route) =>
    route.fulfill({
      json: [
        {
          vehicleId: '1',
          id: '2',
          description: 'Tire Rotation',
          urgency: 'NotUrgent',
          metric: 'Odometer',
          userMetric: 'Odometer',
          notes: '',
          dueDate: '10/3/2026',
          dueOdometer: '112552',
          dueDays: '0',
          dueDistance: '3000',
          tags: ''
        }
      ]
    })
  );

  await gotoMaintenanceViaDrawer(page);

  await expect(page.getByText(/Looks good — no upcoming maintenance/i)).toBeVisible();
  await expect(page.getByText('Tire Rotation')).not.toBeVisible();
});

test('vehicle picker card switches the active vehicle and returns to /maintenance', async ({ page }) => {
  // Two vehicles so picking actually has somewhere to go.
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({
      json: [
        { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
        { id: 2, year: 2021, make: 'Toyota', model: 'Sienna' }
      ]
    })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );

  // Reminder payload differs by vehicle so we can prove vehicle 2 actually loaded.
  await page.route('**/api/vehicle/reminders**', (route) => {
    const url = new URL(route.request().url());
    const vid = url.searchParams.get('vehicleId');
    const description = vid === '2' ? 'Sienna Brake Fluid' : 'Accord Engine Oil';
    return route.fulfill({
      json: [
        {
          vehicleId: vid ?? '1',
          id: '1',
          description,
          urgency: 'PastDue',
          metric: 'Date',
          userMetric: 'Date',
          notes: '',
          dueDate: '4/1/2026',
          dueOdometer: '0',
          dueDays: '-10',
          dueDistance: '0',
          tags: ''
        }
      ]
    });
  });

  await gotoMaintenanceViaDrawer(page);

  // Picker card shows the current vehicle and is the gateway to switching.
  const picker = page.getByRole('link', { name: /Vehicle\s*2014 Honda Accord/i });
  await expect(picker).toBeVisible();
  await expect(page.getByText('Accord Engine Oil')).toBeVisible();

  // Tap → /vehicles?from=maintenance (so the picker knows where to return us).
  await picker.click();
  await expect(page).toHaveURL('/vehicles?from=maintenance');

  // Pick the other vehicle → land back on /maintenance, not /.
  await page.getByRole('button', { name: /2021 Toyota Sienna/i }).click();
  await expect(page).toHaveURL(/\/maintenance\?vehicleId=2/);

  // Vehicle 2's reminders rendered, not Accord's.
  await expect(page.getByText('Sienna Brake Fluid')).toBeVisible();
  await expect(page.getByText('Accord Engine Oil')).not.toBeVisible();
});

test('shows the error banner when the reminders endpoint fails', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/reminders**', (route) =>
    route.fulfill({ status: 502, json: { error: 'LubeLogger 503: ' } })
  );

  await gotoMaintenanceViaDrawer(page);

  await expect(page.getByText(/Couldn't reach LubeLogger right now/i)).toBeVisible();
  // Header still renders.
  await expect(page.getByRole('heading', { name: 'Upcoming maintenance' })).toBeVisible();
  // Back link still present.
  await expect(page.getByRole('link', { name: /Back to Log Fuel/i })).toBeVisible();
});
