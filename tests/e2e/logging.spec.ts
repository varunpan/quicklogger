import { test, expect } from '@playwright/test';

test('home page response carries X-Request-ID header', async ({ page }) => {
  const res = await page.goto('/');
  expect(res).not.toBeNull();
  expect(res!.headers()['x-request-id']).toMatch(/^[0-9a-z]{6,14}$/);
});

test('api response carries X-Request-ID header', async ({ request }) => {
  const res = await request.get('/api/vehicles');
  expect(res.headers()['x-request-id']).toMatch(/^[0-9a-z]{6,14}$/);
});
