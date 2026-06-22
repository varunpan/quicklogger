import { test, expect, type Page } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

const VEHICLE = { id: 1, year: 2014, make: 'Honda', model: 'Accord' };

const INFO = {
  vehicleData: VEHICLE,
  gasRecordCount: 22, gasRecordCost: 707.39,
  serviceRecordCount: 44, serviceRecordCost: 4164.2,
  repairRecordCount: 9, repairRecordCost: 1018.24,
  upgradeRecordCount: 1, upgradeRecordCost: 595,
  taxRecordCount: 0, taxRecordCost: 0,
  lastReportedOdometer: 111180,
  pastDueReminderCount: 2, veryUrgentReminderCount: 0,
  urgentReminderCount: 0, notUrgentReminderCount: 7,
  nextReminder: {
    vehicleId: 1, id: 12, description: 'Engine Oil change',
    urgency: 'NotUrgent', metric: 'Both', userMetric: 'Both',
    notes: null, dueDate: '2026-11-30',
    dueOdometer: 116124, dueDays: 166, dueDistance: 4944, tags: ''
  }
};

async function baseStubs(page: Page) {
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [VEHICLE] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({
      json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 }
    })
  );
}

// +page.ts load runs server-side during SSR; page.route() mocks don't intercept
// those in-process fetches. Visit /settings first, then click through the drawer
// so the loader re-runs client-side where the mocks apply.
async function gotoStatsViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Stats' }).click();
  await expect(page).toHaveURL('/stats');
}

test('renders the TCO headline, cost breakdown, odometer, and reminder line', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/info**', (route) => route.fulfill({ json: INFO }));

  await gotoStatsViaDrawer(page);

  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(page.getByText('2014 Honda Accord')).toBeVisible();

  // TCO headline = 707.39 + 4164.20 + 1018.24 + 595 = 6484.83
  await expect(page.getByText('$6,484.83')).toBeVisible();
  await expect(page.getByText('76 records')).toBeVisible();

  // Cost breakdown rows; Tax (count 0) is hidden. `exact: true` keeps the Fuel
  // breakdown-row span distinct from the "Log Fuel" nav link and "Back to Log
  // Fuel" footer link (both contain "Fuel" as a substring).
  await expect(page.getByText('Fuel', { exact: true })).toBeVisible();
  await expect(page.getByText('22 fill-ups')).toBeVisible();
  await expect(page.getByText('$707.39')).toBeVisible();
  await expect(page.getByText('Tax', { exact: true })).not.toBeVisible();

  // Last odometer.
  await expect(page.getByText('111,180 mi')).toBeVisible();

  // Reminder summary line — counts only. The named "Next:" reminder was removed:
  // LubeLogger's nextReminder is the next *upcoming* item and skips past-due
  // ones, so showing it beside the "Past Due" badge read as "that reminder is
  // past due" when it wasn't. The card shows counts + a Maintenance link.
  await expect(page.getByText('2 Past Due')).toBeVisible();
  await expect(page.getByText('7 upcoming')).toBeVisible();
  await expect(page.getByText('View in Maintenance')).toBeVisible();
  await expect(page.getByText(/Next:/)).not.toBeVisible();

  await expect(page.getByRole('link', { name: /Back to Log Fuel/i })).toBeVisible();
});

test('shows the no-records empty state when every category count is 0', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/info**', (route) =>
    route.fulfill({
      json: {
        ...INFO,
        gasRecordCount: 0, gasRecordCost: 0,
        serviceRecordCount: 0, serviceRecordCost: 0,
        repairRecordCount: 0, repairRecordCost: 0,
        upgradeRecordCount: 0, upgradeRecordCost: 0,
        taxRecordCount: 0, taxRecordCost: 0,
        pastDueReminderCount: 0, notUrgentReminderCount: 0, nextReminder: null
      }
    })
  );

  await gotoStatsViaDrawer(page);

  await expect(page.getByText(/No records logged for this vehicle yet/i)).toBeVisible();
  await expect(page.getByText('Total cost of ownership')).not.toBeVisible();
});

test('shows the error banner when the vehicle-info endpoint fails', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/info**', (route) =>
    route.fulfill({ status: 502, json: { error: 'Could not fetch vehicle info from LubeLogger' } })
  );

  await gotoStatsViaDrawer(page);

  await expect(page.getByText(/Couldn't reach LubeLogger right now/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stats' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Back to Log Fuel/i })).toBeVisible();
});
