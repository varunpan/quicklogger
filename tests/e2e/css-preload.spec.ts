import { test, expect } from '@playwright/test';

// Regression guard for the SvelteKit 2.65.0 asset-path regression
// (sveltejs/kit #16039, dup of #16013; introduced by #15936, fixed by the
// unreleased #16026). With `kit.paths.relative = false`, kit 2.65.0 emitted CSS
// preload dependencies as "./_app/immutable/assets/<hash>.css" and resolved them
// against the entry chunk's `import.meta.url`, producing a doubled-path request
//   /_app/immutable/entry/_app/immutable/assets/<hash>.css  -> 404
// plus an "Unable to preload CSS" unhandledrejection on first load. The
// documented contract for `relative: false` is root-relative asset URLs, so the
// fix pins kit to 2.64.0. This test fails on any kit build that reintroduces the
// doubled path, guarding the eventual re-bump to a fixed release.
test.use({ serviceWorkers: 'block' });

test('first load: no doubled-path asset 404s or CSS-preload rejections', async ({ page }) => {
  const notFound: string[] = [];
  page.on('response', (r) => {
    if (r.status() === 404) notFound.push(r.url());
  });

  await page.addInitScript(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__preloadRejections = [];
    addEventListener('unhandledrejection', (e) => {
      const msg = (e.reason && (e.reason.message || String(e.reason))) || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (/preload/i.test(msg)) (window as any).__preloadRejections.push(msg);
    });
  });

  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);

  const doubled = notFound.filter((u) => u.includes('/_app/immutable/entry/_app/immutable/'));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rejections: string[] = await page.evaluate(() => (window as any).__preloadRejections ?? []);

  expect(doubled, `doubled-path asset 404s on first load:\n${doubled.join('\n')}`).toEqual([]);
  expect(
    rejections,
    `CSS-preload unhandledrejections on first load:\n${rejections.join('\n')}`
  ).toEqual([]);
});
