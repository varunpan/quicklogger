import { test, expect, type Page } from '@playwright/test';
import { mockWithLastFuelup, gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

function appUpdateInfo(overrides: Record<string, unknown> = {}) {
  return {
    reachable: true, status: 'ok',
    currentVersion: '1.6.5', latestVersion: '1.6.5', updateAvailable: false,
    locale: null, currencySymbol: null, decimalSeparator: null, dateFormat: null,
    lubeloggerCurrency: null,
    appCurrentVersion: '0.2.3',
    appLatestVersion: '0.2.4',
    appUpdateAvailable: true,
    appReleaseUrl: 'https://github.com/varunpan/quicklogger/releases/tag/v0.2.4',
    ...overrides
  };
}

async function seedCache(page: Page, body: Record<string, unknown>) {
  await page.addInitScript((payload) => {
    localStorage.setItem('quicklogger-server-info', JSON.stringify(payload));
  }, body);
}
async function mockServerInfo(page: Page, body: Record<string, unknown>) {
  await page.route('**/api/server-info', (route) => route.fulfill({ json: body }));
}

test('Settings: update available shows badge, version arrow, release-notes link', async ({ page }) => {
  const info = appUpdateInfo();
  await seedCache(page, info);
  await mockServerInfo(page, info);
  await page.goto('/settings');
  const block = page.getByTestId('app-info');
  await expect(block.getByText('Update available')).toBeVisible();
  await expect(page.getByTestId('app-version')).toContainText('v0.2.3 → v0.2.4');
  await expect(page.getByTestId('app-release-notes')).toHaveAttribute('href', info.appReleaseUrl as string);
});

test('Settings: up to date shows emerald + version only, no release link', async ({ page }) => {
  const info = appUpdateInfo({ appLatestVersion: '0.2.3', appUpdateAvailable: false });
  await seedCache(page, info);
  await mockServerInfo(page, info);
  await page.goto('/settings');
  const block = page.getByTestId('app-info');
  await expect(block.getByText('Up to date')).toBeVisible();
  await expect(page.getByTestId('app-version')).toHaveText('v0.2.3');
  await expect(page.getByTestId('app-release-notes')).toHaveCount(0);
});

test('Drawer footer: amber dot present when update available', async ({ page }) => {
  const info = appUpdateInfo();
  await seedCache(page, info);
  await mockServerInfo(page, info);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('drawer-update-dot')).toBeVisible();
});

test('Drawer footer: no dot when up to date', async ({ page }) => {
  const info = appUpdateInfo({ appLatestVersion: '0.2.3', appUpdateAvailable: false });
  await seedCache(page, info);
  await mockServerInfo(page, info);
  await page.goto('/settings');
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByTestId('drawer-update-dot')).toHaveCount(0);
});

test('Home banner: shows + links, dismiss persists across navigation', async ({ page }) => {
  const info = appUpdateInfo();
  await seedCache(page, info);
  await mockServerInfo(page, info);
  await mockWithLastFuelup(page);

  await gotoHomeViaClientRouter(page);
  const banner = page.getByTestId('update-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('quicklogger v0.2.4 available');
  await expect(page.getByTestId('banner-release-notes')).toHaveAttribute('href', info.appReleaseUrl as string);

  await page.getByTestId('banner-dismiss').click();
  await expect(banner).toHaveCount(0);

  await gotoHomeViaClientRouter(page);
  await expect(page.getByTestId('update-banner')).toHaveCount(0);
});
