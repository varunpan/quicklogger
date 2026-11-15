import { test, expect, type Page } from '@playwright/test';
import { seedOdometerEntry, seedPrefs, seedQueueEntry } from './fixtures';

test.use({ serviceWorkers: 'block' });

const VEHICLE = { id: 1, year: 2021, make: 'Toyota', model: 'Tacoma' };

const EQUIPMENT = [
  { id: 7, description: 'Off-road trailer', isEquipped: true, distanceTraveled: 1240 },
  { id: 8, description: 'Roof tent', isEquipped: false, distanceTraveled: 310 }
];

async function baseStubs(page: Page, opts: { equipment?: unknown[] } = {}) {
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [VEHICLE] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/vehicle/reminders**', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/vehicle/equipment**', (route) =>
    route.fulfill({ json: opts.equipment ?? EQUIPMENT })
  );
  await page.route('**/api/vehicle/info**', (route) =>
    route.fulfill({ json: { vehicleData: VEHICLE, lastReportedOdometer: 45100 } })
  );
}

// +page.ts load runs server-side during SSR; page.route() mocks don't intercept
// those in-process fetches. Visit /settings first, then click through the drawer
// so the loader re-runs client-side where the mocks apply.
async function gotoOdometerViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page).toHaveURL('/odometer');
}

test('prefills the odometer and shows each item as Equipped or not', async ({ page }) => {
  await baseStubs(page);
  await gotoOdometerViaDrawer(page);

  await expect(page.locator('#odo-only')).toHaveValue('45100');
  await expect(page.getByText('prefilled')).toBeVisible();
  await expect(page.getByTestId('equipment-7')).toHaveAttribute('data-equipped', 'true');
  await expect(page.getByTestId('equip-7')).toHaveText('Unequip');
  await expect(page.getByTestId('equipment-8')).toHaveAttribute('data-equipped', 'false');
  await expect(page.getByTestId('equip-8')).toHaveText('Equip');
  // An untouched prefill would log 0 distance — nothing can be logged yet.
  await expect(page.getByRole('button', { name: 'Log odometer' })).toBeDisabled();
  await expect(page.getByTestId('equip-8')).toBeDisabled();
});

test('a reading credits the Equipped items', async ({ page }) => {
  await baseStubs(page);
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/odometer', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await expect(page.getByText('+220 mi')).toBeVisible();
  await page.getByRole('button', { name: 'Log odometer' }).click();

  // Same landing as a logged fill-up.
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posted).toMatchObject({ vehicleId: 1, odometer: 45320, equipmentIds: [7] });
});

test('a reading lower than the last one needs Submit anyway', async ({ page }) => {
  await baseStubs(page);
  let posts = 0;
  await page.route('**/api/odometer', async (route) => {
    posts++;
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45000');
  await expect(page.getByTestId('smart-check-chip')).toContainText('lower than the last reading');
  await expect(page.getByRole('button', { name: 'Log odometer' })).toBeDisabled();

  await page.getByRole('button', { name: 'Submit anyway' }).click();
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posts).toBe(1);
});

test('shows a hint when the vehicle has no equipment', async ({ page }) => {
  await baseStubs(page, { equipment: [] });
  await gotoOdometerViaDrawer(page);
  await expect(page.getByText('No equipment on this vehicle.')).toBeVisible();
});

test('surfaces a 4xx rejection as an error toast without queueing', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/odometer', (route) =>
    route.fulfill({ status: 400, json: { error: 'Could not add odometer record to LubeLogger' } })
  );
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();
  await expect(page.getByRole('alert')).toContainText('Submission rejected');
  await expect(page).toHaveURL('/odometer');
});

/**
 * Offline path. Aborting /api/odometer produces the same network-error
 * rejection real offline does and exercises the identical catch branch —
 * WebKit can't drive the real offline / service-worker path (same approach as
 * queued-submit-redirect.spec.ts).
 */
test('a failed submit queues the reading and lands on History', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/odometer', (route) => route.abort('failed'));
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();

  await page.waitForURL(/\/history\?vehicleId=1$/);
  const card = page.getByTestId('odometer-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Queued', { exact: true })).toBeVisible();
  await expect(card.getByText('45,320 mi')).toBeVisible();
  await expect(card.getByText('with Off-road trailer')).toBeVisible();
});

test('falls back to the cached equipment + odometer when LubeLogger is unreachable', async ({
  page
}) => {
  await baseStubs(page);
  // Prime the snapshot with one online visit, then cut the two upstream reads.
  await gotoOdometerViaDrawer(page);
  await expect(page.getByTestId('equipment-7')).toBeVisible();
  await page.unroute('**/api/vehicle/equipment**');
  await page.unroute('**/api/vehicle/info**');
  await page.route('**/api/vehicle/equipment**', (route) => route.abort('failed'));
  await page.route('**/api/vehicle/info**', (route) => route.abort('failed'));

  await page.getByRole('link', { name: '← Back to Log Fuel' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page).toHaveURL('/odometer');

  await expect(page.getByText('readings will be saved and synced later')).toBeVisible();
  await expect(page.getByTestId('equipment-7')).toHaveAttribute('data-equipped', 'true');
  await expect(page.locator('#odo-only')).toHaveValue('45100');
});

test('a mistyped reading does not stick in the prefill (review #1)', async ({ page }) => {
  await baseStubs(page);
  // The pre-fix code ratcheted the snapshot up to the typo (1,234,560 instead
  // of 123,456) and preferred it over LubeLogger's figure even online. Seed
  // that state, plus the refused (4xx) queue row, and expect LubeLogger's
  // 45,100 to win.
  await page.addInitScript(() =>
    localStorage.setItem(
      'quicklogger.odometerSnapshot.1',
      JSON.stringify({ lastOdometer: 1234560 })
    )
  );
  await seedOdometerEntry(page, {
    input: { vehicleId: 1, date: '2026-11-10', odometer: 1234560, clientSubmissionId: 'bad' },
    status: 'failed',
    lastError: '400'
  });
  await gotoOdometerViaDrawer(page);
  await expect(page.locator('#odo-only')).toHaveValue('45100');
});

test('offline, readings already logged from this device raise the prefill (N3)', async ({
  page
}) => {
  await baseStubs(page);
  await page.unroute('**/api/vehicle/info**');
  await page.route('**/api/vehicle/info**', (route) => route.abort('failed'));
  await page.addInitScript(() =>
    localStorage.setItem('quicklogger.odometerSnapshot.1', JSON.stringify({ lastOdometer: 45100 }))
  );
  await seedOdometerEntry(page, {
    input: { vehicleId: 1, date: '2026-11-12', odometer: 45320, clientSubmissionId: 's' },
    status: 'synced'
  });
  await gotoOdometerViaDrawer(page);
  await expect(page.locator('#odo-only')).toHaveValue('45320');
});

test("online, LubeLogger's figure wins over local synced rows", async ({ page }) => {
  await baseStubs(page);
  // e.g. the 45,320 record was corrected in LubeLogger after it synced.
  await seedOdometerEntry(page, {
    input: { vehicleId: 1, date: '2026-11-12', odometer: 45320, clientSubmissionId: 's' },
    status: 'synced'
  });
  await gotoOdometerViaDrawer(page);
  await expect(page.locator('#odo-only')).toHaveValue('45100');
});

test('a reading still waiting to sync raises the prefill', async ({ page }) => {
  await baseStubs(page);
  await seedOdometerEntry(page, {
    input: { vehicleId: 1, date: '2026-11-12', odometer: 45320, clientSubmissionId: 'q' },
    status: 'queued'
  });
  await gotoOdometerViaDrawer(page);
  await expect(page.locator('#odo-only')).toHaveValue('45320');
});

test('switching vehicle on the reused page re-seeds the form (review #6)', async ({ page }) => {
  const TRUCK = { id: 1, year: 2021, make: 'Toyota', model: 'Tacoma' };
  const JEEP = { id: 2, year: 2019, make: 'Jeep', model: 'Wrangler' };
  await page.route('**/api/vehicles', (route) => route.fulfill({ json: [TRUCK, JEEP] }));
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/vehicle/equipment**', (route) => {
    const vid = new URL(route.request().url()).searchParams.get('vehicleId');
    return route.fulfill({
      json:
        vid === '2'
          ? [{ id: 20, description: 'Jeep rack', isEquipped: true, distanceTraveled: 0 }]
          : EQUIPMENT
    });
  });
  await page.route('**/api/vehicle/info**', (route) => {
    const vid = new URL(route.request().url()).searchParams.get('vehicleId');
    return route.fulfill({ json: { lastReportedOdometer: vid === '2' ? 88000 : 45100 } });
  });
  await seedPrefs(page, { lastVehicleId: 1 });

  // Land on /odometer?vehicleId=2 client-side, via the picker.
  await gotoOdometerViaDrawer(page);
  await page.getByRole('link', { name: /Tacoma/ }).click();
  await page.getByRole('button', { name: /Wrangler/ }).click();
  await expect(page).toHaveURL('/odometer?vehicleId=2');
  await expect(page.locator('#odo-only')).toHaveValue('88000');
  await expect(page.getByTestId('equipment-20')).toHaveAttribute('data-equipped', 'true');

  // Saved last vehicle back to 1, then "Log Odometer" reuses the page for it.
  await page.evaluate(() =>
    localStorage.setItem('quicklogger.prefs', JSON.stringify({ lastVehicleId: 1 }))
  );
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page).toHaveURL('/odometer');

  await expect(page.locator('#odo-only')).toHaveValue('45100');
  await expect(page.getByTestId('equipment-7')).toHaveAttribute('data-equipped', 'true');
  await expect(page.getByTestId('equipment-20')).toHaveCount(0);

  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/odometer', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posted).toMatchObject({ vehicleId: 1, equipmentIds: [7] });
});

test('never-loaded equipment says so and asks the server to include equipped items (review #9)', async ({
  page
}) => {
  await baseStubs(page);
  await page.unroute('**/api/vehicle/equipment**');
  await page.route('**/api/vehicle/equipment**', (route) => route.abort('failed'));
  let posted: Record<string, unknown> | null = null;
  await page.route('**/api/odometer', async (route) => {
    posted = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  await gotoOdometerViaDrawer(page);

  await expect(page.getByTestId('equipment-unknown')).toBeVisible();
  await expect(page.getByText('No equipment on this vehicle.')).toHaveCount(0);
  await page.locator('#odo-only').fill('45320');
  await page.getByRole('button', { name: 'Log odometer' }).click();
  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posted).toMatchObject({ equipmentIds: [], includeEquipped: true });
});

test('History renders seeded odometer rows next to fill-ups (fixture, review #11)', async ({
  page
}) => {
  await baseStubs(page);
  await seedOdometerEntry(page, {
    input: { vehicleId: 1, date: '2026-11-12', odometer: 45320, clientSubmissionId: 'f' },
    status: 'failed',
    lastError: '403',
    attempts: 1,
    equipmentNames: ['Off-road trailer']
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'History' }).click();

  const card = page.getByTestId('odometer-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Failed', { exact: true })).toBeVisible();
  await expect(card.getByText('with Off-road trailer')).toBeVisible();
  await expect(card.getByText('error: 403')).toBeVisible();
});

test('History still shows fill-ups when the odometer store fails (review #10)', async ({
  page
}) => {
  await baseStubs(page);
  await seedQueueEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-11-12',
      odometer: 45320,
      volume: 12,
      volumeUnit: 'gal',
      cost: 40,
      currency: 'USD',
      isFillToFull: true,
      missedFuelup: false,
      clientSubmissionId: 'fuel-1'
    },
    status: 'synced'
  });
  // Make every read of the odometer store fail (whichever database holds it),
  // leaving the fill-up store working.
  await page.addInitScript(() => {
    const realTx = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (
      this: IDBDatabase,
      ...args: Parameters<IDBDatabase['transaction']>
    ) {
      const names = Array.isArray(args[0]) ? args[0] : [args[0]];
      if (names.includes('pendingOdometer')) throw new DOMException('broken', 'UnknownError');
      return realTx.apply(this, args);
    } as IDBDatabase['transaction'];
  });
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'History' }).click();

  await expect(page.getByTestId('fillup-card')).toHaveCount(1);
  await expect(page.getByTestId('odometer-card')).toHaveCount(0);
  await expect(page.getByText("Couldn't load local history")).toHaveCount(0);
});

/** Stateful stubs for Equip / Unequip: /api/odometer applies `setEquipped`
 *  (as the server does) and the equipment list reflects it. */
async function equipStubs(page: Page, opts: { odometer?: 'ok' | 'fail' } = {}) {
  await baseStubs(page);
  const state = EQUIPMENT.map((e) => ({ ...e }));
  const posts: Record<string, unknown>[] = [];
  await page.unroute('**/api/vehicle/equipment**');
  await page.route('**/api/vehicle/equipment**', (route) => route.fulfill({ json: state }));
  await page.route('**/api/odometer', async (route) => {
    const body = route.request().postDataJSON();
    posts.push(body);
    if (opts.odometer === 'fail') return route.abort('failed');
    const se = body.setEquipped as { equipmentId: number; equipped: boolean } | undefined;
    if (se) state.find((e) => e.id === se.equipmentId)!.isEquipped = se.equipped;
    return route.fulfill({ json: { ok: true, recordId: 5 } });
  });
  return posts;
}

test('Equip logs the reading without the item and marks it Equipped, then lands on Maintenance', async ({
  page
}) => {
  const posts = await equipStubs(page);
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45300');
  await page.getByTestId('equip-8').click();

  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  // One request carries both: the reading credits only what was already on
  // (the trailer), and the tent is marked Equipped.
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    odometer: 45300,
    equipmentIds: [7],
    notes: 'Equipped Roof tent',
    setEquipped: { equipmentId: 8, equipped: true }
  });

  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page.getByTestId('equipment-8')).toHaveAttribute('data-equipped', 'true');
  await expect(page.getByTestId('equip-8')).toHaveText('Unequip');
});

test('Unequip logs the reading with the item and marks it not Equipped', async ({ page }) => {
  const posts = await equipStubs(page);
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45550');
  await page.getByTestId('equip-7').click();

  await page.waitForURL(/\/maintenance\?vehicleId=1$/);
  expect(posts[0]).toMatchObject({
    odometer: 45550,
    equipmentIds: [7],
    notes: 'Unequipped Off-road trailer',
    setEquipped: { equipmentId: 7, equipped: false }
  });
});

test('offline, Equip queues reading + change together and shows it as waiting to sync', async ({
  page
}) => {
  const posts = await equipStubs(page, { odometer: 'fail' });
  await gotoOdometerViaDrawer(page);

  await page.locator('#odo-only').fill('45300');
  await page.getByTestId('equip-8').click();

  // Same landing as an offline fill-up: History, with one Queued row.
  await page.waitForURL(/\/history\?vehicleId=1$/);
  const card = page.getByTestId('odometer-card');
  await expect(card).toHaveCount(1);
  await expect(card.getByText('Queued', { exact: true })).toBeVisible();
  await expect(card.getByText('note: Equipped Roof tent')).toBeVisible();
  expect(posts[0]).toMatchObject({ setEquipped: { equipmentId: 8, equipped: true } });

  // Back on the page the tent already shows as Equipped, pending sync, so a
  // later offline reading counts toward it.
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();
  await expect(page.getByTestId('equipment-8')).toHaveAttribute('data-equipped', 'true');
  await expect(page.getByTestId('equipment-pending-8')).toBeVisible();
  await page.locator('#odo-only').fill('45400');
  await page.getByRole('button', { name: /Log odometer|Save offline/ }).click();
  await page.waitForURL(/\/history\?vehicleId=1$/);
  expect(posts[1]).toMatchObject({ odometer: 45400, equipmentIds: [7, 8] });
});

test('Equip and Unequip stay available when LubeLogger is unreachable', async ({ page }) => {
  await baseStubs(page);
  await gotoOdometerViaDrawer(page); // prime the snapshot
  await page.unroute('**/api/vehicle/equipment**');
  await page.route('**/api/vehicle/equipment**', (route) => route.abort('failed'));
  await page.getByRole('link', { name: '← Back to Log Fuel' }).click();
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'Log Odometer' }).click();

  await expect(page.getByTestId('equip-8')).toBeDisabled(); // no reading entered yet
  await expect(page.getByTestId('equip-hint')).toBeVisible();
  await page.locator('#odo-only').fill('45300');
  await expect(page.getByTestId('equip-8')).toBeEnabled();
  await expect(page.getByTestId('equip-hint')).toHaveCount(0);
});

test('offline, an Equip that already synced still shows as Equipped (phone UAT)', async ({
  page
}) => {
  // The phone's saved list is from before the Equip (trailer 8 not on); the
  // Equip was tapped later and has synced, but no online load has refreshed
  // the list since. The page must offer Unequip, not Equip.
  await baseStubs(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      'quicklogger.odometerSnapshot.1',
      JSON.stringify({
        equipment: [
          { id: 7, description: 'Off-road trailer', isEquipped: true, distanceTraveled: 1240 },
          { id: 8, description: 'Roof tent', isEquipped: false, distanceTraveled: 310 }
        ],
        equipmentSavedAt: 1000,
        lastOdometer: 45550
      })
    )
  );
  await seedOdometerEntry(page, {
    input: {
      vehicleId: 1,
      date: '2026-11-15',
      odometer: 45600,
      notes: 'Equipped Roof tent',
      setEquipped: { equipmentId: 8, equipped: true },
      clientSubmissionId: 'e'
    },
    status: 'synced',
    enqueuedAt: 2000
  });
  await page.unroute('**/api/vehicle/equipment**');
  await page.route('**/api/vehicle/equipment**', (route) => route.abort('failed'));
  await gotoOdometerViaDrawer(page);

  await expect(page.getByTestId('equipment-8')).toHaveAttribute('data-equipped', 'true');
  await expect(page.getByTestId('equip-8')).toHaveText('Unequip');
  await expect(page.getByTestId('equipment-pending-8')).toHaveCount(0);
});

const FILLUP = {
  vehicleId: 1,
  date: '2026-11-15',
  odometer: 45420,
  volume: 11.2,
  volumeUnit: 'gal',
  cost: 42,
  currency: 'USD',
  isFillToFull: true,
  missedFuelup: false,
  clientSubmissionId: 'f1'
};

async function gotoHistoryViaDrawer(page: Page) {
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('link', { name: 'History' }).click();
  await expect(page).toHaveURL('/history');
}

test('History labels a fill-up with the equipment LubeLogger credited it to', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/odometer-records**', (route) =>
    route.fulfill({ json: [{ date: '2026-11-15', odometer: 45420, equipmentIds: [7] }] })
  );
  await seedQueueEntry(page, { input: FILLUP, status: 'synced' });
  await gotoHistoryViaDrawer(page);

  await expect(page.getByTestId('fillup-equipment')).toHaveText('with Off-road trailer');
});

test('offline, History keeps the last labels it got from LubeLogger', async ({ page }) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/odometer-records**', (route) => route.abort('failed'));
  await page.addInitScript(() =>
    localStorage.setItem(
      'quicklogger.historyEquipment.1',
      JSON.stringify({ '2026-11-15|45420': ['Off-road trailer'] })
    )
  );
  await seedQueueEntry(page, { input: FILLUP, status: 'synced' });
  await gotoHistoryViaDrawer(page);

  await expect(page.getByTestId('fillup-equipment')).toHaveText('with Off-road trailer');
});

test('a fill-up still queued gets no equipment label (LubeLogger has not credited it yet)', async ({
  page
}) => {
  await baseStubs(page);
  await page.route('**/api/vehicle/odometer-records**', (route) =>
    route.fulfill({ json: [{ date: '2026-11-15', odometer: 45420, equipmentIds: [7] }] })
  );
  await seedQueueEntry(page, { input: FILLUP, status: 'queued' });
  await gotoHistoryViaDrawer(page);

  await expect(page.getByTestId('fillup-card')).toHaveCount(1);
  await expect(page.getByTestId('fillup-equipment')).toHaveCount(0);
});
