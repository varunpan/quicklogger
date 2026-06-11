/**
 * One-shot warming fetch for the SW's vehicles cache (`API_CACHE`).
 *
 * `+page.ts` is a universal load with SSR enabled: on a full navigation (PWA
 * launch, first visit) `listVehicles` runs on the server and SvelteKit
 * serializes the result into the HTML — the browser never issues a real
 * `GET /api/vehicles`, so the SW's network-first branch never sees one and
 * the cache the offline cold-start depends on stays cold. A user whose every
 * session is "launch → log → quit" could use the app for weeks and still
 * have no vehicle list the first time they cold-start offline.
 *
 * Fired from the layout once `serviceWorker.ready` resolves so the request
 * flows through the controlling worker and lands in the cache. On the very
 * first install the page may not yet be controlled when `ready` resolves
 * (claim() can land after); the fetch then bypasses the worker and the next
 * launch warms the cache instead — best-effort by design.
 */
export function warmVehiclesCache(
  serviceWorker: { ready: Promise<unknown> },
  fetcher: (url: string) => Promise<unknown>
): Promise<void> {
  return serviceWorker.ready
    .then(() => fetcher('/api/vehicles'))
    .then(() => undefined)
    .catch(() => undefined); // warming is best-effort; failures are silent
}
