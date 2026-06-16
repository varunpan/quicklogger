import { test, expect } from '@playwright/test';
import { mockLubelogger } from './fixtures';

// iOS Safari auto-zooms when a focused input's computed font-size is < 16px,
// and it does NOT zoom back out on blur. So every text-entry field on the log
// form must render at >= 16px. Regression guard for #51: the notes field was
// `field-input text-sm` (14px — the text-sm utility wins over .field-input's
// text-lg) and zoomed the whole page on focus. The fix is per-element (notes →
// text-base = 16px); this test guards the whole class of bug across every
// .field-input, so any future sub-16px field is caught too.

// Block the SW so the form's API GETs hit the page.route mocks (mirrors the
// other form specs).
test.use({ serviceWorkers: 'block' });

test('every form input renders at >= 16px (no iOS focus-zoom)', async ({ page }) => {
  await mockLubelogger(page);
  await page.goto('/');

  const inputs = page.locator('input.field-input');
  await expect(inputs.first()).toBeVisible();
  const count = await inputs.count();
  expect(count).toBeGreaterThan(0);

  for (let i = 0; i < count; i++) {
    const input = inputs.nth(i);
    const px = await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    const label =
      (await input.getAttribute('placeholder')) ??
      (await input.getAttribute('type')) ??
      `input[${i}]`;
    expect(px, `${label} font-size must be >= 16px`).toBeGreaterThanOrEqual(16);
  }
});
