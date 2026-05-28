import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

function fullInfo(overrides: Record<string, unknown> = {}) {
  return {
    reachable: true,
    status: 'ok',
    currentVersion: '1.6.5',
    latestVersion: '1.6.5',
    updateAvailable: false,
    locale: null,
    currencySymbol: null,
    decimalSeparator: null,
    dateFormat: null,
    lubeloggerCurrency: null,
    ...overrides
  };
}

async function mockServerInfo(page: import('@playwright/test').Page, body: Record<string, unknown>) {
  await page.route('**/api/server-info', (route) => route.fulfill({ json: body }));
}

async function seedCache(page: import('@playwright/test').Page, body: Record<string, unknown>) {
  await page.addInitScript((payload) => {
    localStorage.setItem('quicklogger-server-info', JSON.stringify(payload));
  }, body);
}

test('connected + up to date: shows Connected and the version, no update badge', async ({ page }) => {
  const payload = fullInfo();
  await seedCache(page, payload);
  await mockServerInfo(page, payload);
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText('Connected')).toBeVisible();
  await expect(page.getByTestId('server-version')).toHaveText('v1.6.5');
  await expect(page.getByTestId('update-available')).toHaveCount(0);
});

test('update available: shows the badge and the version arrow', async ({ page }) => {
  const payload = fullInfo({ latestVersion: '1.7.0', updateAvailable: true });
  await seedCache(page, payload);
  await mockServerInfo(page, payload);
  await page.goto('/settings');
  const badge = page.getByTestId('update-available');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Update available');
  await expect(badge).toContainText('v1.6.5 → v1.7.0');
});

test('unauthorized: shows API key rejected', async ({ page }) => {
  const payload = fullInfo({
    reachable: false, status: 'unauthorized', currentVersion: null, latestVersion: null, updateAvailable: false
  });
  await seedCache(page, payload);
  await mockServerInfo(page, payload);
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText('API key rejected')).toBeVisible();
  await expect(block.getByText('LUBELOGGER_API_KEY')).toBeVisible();
});

test("unreachable: shows Can't reach LubeLogger", async ({ page }) => {
  const payload = fullInfo({
    reachable: false, status: 'unreachable', currentVersion: null, latestVersion: null, updateAvailable: false
  });
  await seedCache(page, payload);
  await mockServerInfo(page, payload);
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText("Can't reach LubeLogger")).toBeVisible();
});

test('layout boot refresh updates cache from live fetch (Settings does not re-render in place)', async ({ page }) => {
  // Seed a stale cached "unreachable" before scripts run.
  await seedCache(page, {
    reachable: false, status: 'unreachable', currentVersion: null, latestVersion: null,
    updateAvailable: false, locale: null, currencySymbol: null,
    decimalSeparator: null, dateFormat: null, lubeloggerCurrency: null
  });
  // Delay the live response so the stale cache is observably painted first.
  await page.route('**/api/server-info', async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.fulfill({ json: fullInfo({ currentVersion: '1.6.5' }) });
  });
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  // Stale cache paints immediately (before the delayed live response resolves).
  await expect(block.getByText("Can't reach LubeLogger")).toBeVisible();
  // Layout's boot refresh writes the new value to the cache. Settings does
  // NOT re-render in place — by design. Reloading would surface the new value;
  // this test only asserts the cache moves, since that's the explicit contract.
  await page.waitForFunction(() => {
    const raw = localStorage.getItem('quicklogger-server-info');
    if (!raw) return false;
    try { return JSON.parse(raw).currentVersion === '1.6.5'; } catch { return false; }
  });
});
