import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { gotoHomeViaClientRouter } from './fixtures';

test.use({ serviceWorkers: 'block' });

const FIXTURE = path.resolve('tests/e2e/sample.jpg');

async function commonRoutes(page: Page) {
  await page.route('**/api/vehicles', (route) =>
    route.fulfill({ json: [{ id: 1, year: 2019, make: 'Honda', model: 'Civic Si' }] })
  );
  await page.route('**/api/vehicle/last-fuelup**', (route) => route.fulfill({ json: null }));
  await page.route('**/api/fx**', (route) =>
    route.fulfill({ json: { rate: 1, source: 'identity', fetchedAt: Date.now(), stale: false, ageHours: 0 } })
  );
}

test('crop: drag → Done → Send POSTs cropX/Y/W/H form fields', async ({ page }) => {
  await commonRoutes(page);
  let postedBody = '';
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    postedBody = route.request().postData() ?? '';
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });

  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);

  // Open crop sub-flow
  const dialog = page.getByRole('dialog', { name: /Photo preview/i });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: /Crop image/i }).click();

  // Drag the rect via synthetic PointerEvents on the interior handle.
  // We don't use a corner here because the 200 source-px floor in the
  // CropOverlay (`floorDisplayPx = max(1, 200 * (imageDisplayRect.w /
  // sourceSize.w))`) can pin a corner drag negative on the 32x18 test
  // fixture — interior drag has no floor, just clampToBounds. Playwright's
  // `page.mouse.*` doesn't synthesize PointerEvents reliably on
  // touch-emulating device profiles (e.g. iPhone 14), so dispatch them
  // directly. Delta of (+2, +2) viewport-px is comfortably above the 1 px
  // isDefault tolerance and well within clampToBounds for any image size.
  const interior = dialog.locator('[data-handle="interior"]');
  await expect(interior).toBeVisible();
  await interior.evaluate((handle) => {
    const box = handle.getBoundingClientRect();
    const startX = box.left + box.width / 2;
    const startY = box.top + box.height / 2;
    const endX = startX + 2;
    const endY = startY + 2;
    const opts = (x: number, y: number): PointerEventInit => ({
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1
    });
    handle.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY)));
    const overlay = handle.parentElement as HTMLElement;
    overlay.dispatchEvent(new PointerEvent('pointermove', opts(startX + 1, startY + 1)));
    overlay.dispatchEvent(new PointerEvent('pointermove', opts(endX, endY)));
    overlay.dispatchEvent(new PointerEvent('pointerup', opts(endX, endY)));
  });
  await page.waitForTimeout(50);

  // Commit + send
  await dialog.getByRole('button', { name: /^Done$/i }).click();
  // Cropped chip visible in header
  await expect(dialog.getByText(/^Cropped$/)).toBeVisible();
  // Preview now shows the cropped canvas — the original full-size <img>
  // is no longer in the DOM (replaced by <canvas aria-label="Cropped preview">).
  await expect(dialog.locator('canvas[aria-label="Cropped preview"]')).toBeVisible();
  await expect(dialog.locator('img[alt="Captured for OCR preview"]')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByText(/11\.2 gal · \$42\.18/)).toBeVisible();

  // All four crop fields present in the multipart body
  expect(postedBody).toMatch(/name="cropX"/);
  expect(postedBody).toMatch(/name="cropY"/);
  expect(postedBody).toMatch(/name="cropW"/);
  expect(postedBody).toMatch(/name="cropH"/);

  // Each is a finite decimal in [0, 1]
  for (const name of ['cropX', 'cropY', 'cropW', 'cropH']) {
    const re = new RegExp(`name="${name}"\\r?\\n\\r?\\n([\\d.eE+-]+)`);
    const match = postedBody.match(re);
    expect(match).not.toBeNull();
    if (match) {
      const v = Number(match[1]);
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  }
});

test('crop: skip-crop send omits all four crop form fields (wire-compat)', async ({ page }) => {
  await commonRoutes(page);
  let bodySaw = '';
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    bodySaw = route.request().postData() ?? '';
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });

  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  await page.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByText(/Detected:/)).toBeVisible();

  for (const name of ['cropX', 'cropY', 'cropW', 'cropH']) {
    expect(bodySaw).not.toMatch(new RegExp(`name="${name}"`));
  }
});

const PORTRAIT_FIXTURE = path.resolve('tests/e2e/sample-portrait.jpg');

test('crop: tall portrait image fits viewport — every handle is reachable', async ({ page }) => {
  // Regression: pre-fix, `max-h-full` on the <img> inside an inline-block
  // wrapper was a circular percentage reference (parent height = auto = img
  // content height) — tall portraits rendered at their natural pixel height
  // and overflowed the viewport, dragging the CropOverlay corner handles
  // out of reach. Fix moved the constraint to viewport units directly on the
  // img (max-h: calc(100dvh - 14rem)).
  await commonRoutes(page);
  await page.route('**/api/ocr', (route) =>
    route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } })
  );

  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', PORTRAIT_FIXTURE);

  const dialog = page.getByRole('dialog', { name: /Photo preview/i });
  await dialog.getByRole('button', { name: /Crop image/i }).click();
  // Wait for the overlay to mount — measureImg() needs the img bounding rect.
  await expect(dialog.locator('[data-handle="corner"][data-corner="tl"]')).toBeVisible();

  const result = await page.evaluate(() => {
    const img = document.querySelector('img[alt="Captured for OCR preview"]') as HTMLImageElement | null;
    if (!img) return { ok: false };
    const ir = img.getBoundingClientRect();
    const corners = ['tl', 'tr', 'bl', 'br'].map((c) => {
      const el = document.querySelector(`[data-corner="${c}"]`) as HTMLElement | null;
      if (!el) return { c, on: false };
      const b = el.getBoundingClientRect();
      return {
        c,
        on:
          b.x >= 0 &&
          b.y >= 0 &&
          b.x + b.width <= window.innerWidth &&
          b.y + b.height <= window.innerHeight
      };
    });
    return {
      ok: true,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      img_natural: { w: img.naturalWidth, h: img.naturalHeight },
      img_rect: { x: ir.x, y: ir.y, w: ir.width, h: ir.height },
      img_overflows:
        ir.x < 0 || ir.y < 0 || ir.x + ir.width > window.innerWidth || ir.y + ir.height > window.innerHeight,
      corners
    };
  });

  expect(result.ok).toBe(true);
  // Sanity: the fixture is tall enough that pre-fix it would overflow.
  expect(result.img_natural!.h).toBeGreaterThan(result.viewport!.h);
  // Image stays inside the viewport.
  expect(result.img_overflows).toBe(false);
  // All four corner handles reachable.
  for (const c of result.corners!) {
    expect(c.on, `corner ${c.c} should be on-screen`).toBe(true);
  }
});

test('crop: Cancel crop returns to preview with prior state, Send omits crop fields', async ({ page }) => {
  await commonRoutes(page);
  let bodySaw = '';
  await page.route('**/api/ocr', (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ json: { enabled: true, modes: ['pump', 'odometer'] } });
    }
    bodySaw = route.request().postData() ?? '';
    return route.fulfill({
      json: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 }
    });
  });
  await gotoHomeViaClientRouter(page);
  await page.setInputFiles('input[type="file"][accept="image/*"] >> nth=0', FIXTURE);
  const dialog = page.getByRole('dialog', { name: /Photo preview/i });
  await dialog.getByRole('button', { name: /Crop image/i }).click();
  await dialog.getByRole('button', { name: /Cancel crop/i }).click();
  // Back in preview, no chip
  await expect(dialog.getByText(/^Cropped$/)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Send for OCR', exact: true }).click();
  await expect(page.getByText(/Detected:/)).toBeVisible();
  for (const name of ['cropX', 'cropY', 'cropW', 'cropH']) {
    expect(bodySaw).not.toMatch(new RegExp(`name="${name}"`));
  }
});
