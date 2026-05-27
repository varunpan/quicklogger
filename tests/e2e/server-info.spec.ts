import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

// The Settings route has no +page.ts loader — the server-info fetch is a
// client-side onMount call, so page.route() intercepts it on a direct goto.
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
    ...overrides
  };
}

async function mockServerInfo(page: import('@playwright/test').Page, body: Record<string, unknown>) {
  await page.route('**/api/server-info', (route) => route.fulfill({ json: body }));
}

test('connected + up to date: shows Connected and the version, no update badge', async ({ page }) => {
  await mockServerInfo(page, fullInfo());
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText('Connected')).toBeVisible();
  await expect(page.getByTestId('server-version')).toHaveText('v1.6.5');
  await expect(page.getByTestId('update-available')).toHaveCount(0);
});

test('update available: shows the badge and the version arrow', async ({ page }) => {
  await mockServerInfo(page, fullInfo({ latestVersion: '1.7.0', updateAvailable: true }));
  await page.goto('/settings');
  const badge = page.getByTestId('update-available');
  await expect(badge).toBeVisible();
  await expect(badge).toContainText('Update available');
  await expect(badge).toContainText('v1.6.5 → v1.7.0');
});

test('unauthorized: shows API key rejected', async ({ page }) => {
  await mockServerInfo(page, fullInfo({
    reachable: false, status: 'unauthorized', currentVersion: null, latestVersion: null, updateAvailable: false
  }));
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText('API key rejected')).toBeVisible();
  await expect(block.getByText('LUBELOGGER_API_KEY')).toBeVisible();
});

test('unreachable: shows Can\'t reach LubeLogger', async ({ page }) => {
  await mockServerInfo(page, fullInfo({
    reachable: false, status: 'unreachable', currentVersion: null, latestVersion: null, updateAvailable: false
  }));
  await page.goto('/settings');
  const block = page.getByTestId('server-info');
  await expect(block.getByText("Can't reach LubeLogger")).toBeVisible();
});

test('SWR: paints the cached value, then updates from the live fetch', async ({ page }) => {
  // Seed a stale cached "unreachable" before scripts run; live fetch returns ok.
  await page.addInitScript(() => {
    localStorage.setItem('quicklogger-server-info', JSON.stringify({
      reachable: false, status: 'unreachable', currentVersion: null, latestVersion: null,
      updateAvailable: false, locale: null, currencySymbol: null, decimalSeparator: null, dateFormat: null
    }));
  });
  await mockServerInfo(page, fullInfo({ currentVersion: '1.6.5' }));
  await page.goto('/settings');
  // Live fetch resolves and the block flips to Connected.
  await expect(page.getByTestId('server-info').getByText('Connected')).toBeVisible();
  await expect(page.getByTestId('server-version')).toHaveText('v1.6.5');
});
