/**
 * Pure, unit-testable cache policies for the service worker. Each depends only
 * on the `fetch`-shaped function and `Cache`/`caches` handles passed in, so a
 * vitest fake can exercise every branch without a real worker. Mirrors the
 * `sync-queue.ts` extraction that made the queue orchestration testable
 * (whole-app review #11: untested SW orchestration).
 */

/**
 * Install-time shell precache. Failure must propagate: `install`'s contract
 * is that a rejected `waitUntil` aborts the new worker, so the previous one
 * (with its intact versioned cache) keeps serving. Swallowing the error would
 * activate a worker with a partial or empty shell — and the activate handler
 * would then delete the previous version's complete cache, downgrading the
 * device from "fully precached offline shell" to "nothing cached".
 */
export async function precacheShell(
  cache: Cache,
  shell: string[],
  logError: (err: Error) => Promise<unknown>
): Promise<void> {
  try {
    await cache.addAll(shell);
  } catch (err) {
    await logError(err as Error);
    throw err;
  }
}

/**
 * Navigation fallback: network-first, falling back to the precached `/offline`
 * shell when the network is unreachable, and finally to a bare 504 if the shell
 * was never cached (shouldn't happen — it is precached on install).
 */
export async function navigationFallback(
  req: Request,
  fetcher: (req: Request) => Promise<Response>,
  matchCache: (key: string) => Promise<Response | undefined>
): Promise<Response> {
  try {
    return await fetcher(req);
  } catch {
    // Body is the literal string 'offline' (not null) to preserve the pre-existing
    // 504 'offline' contract the generic fetch handler also returns.
    return (await matchCache('/offline')) ?? new Response('offline', { status: 504 });
  }
}

/**
 * Vehicle-list policy: network-first, refreshing `cache` on every successful
 * (`res.ok`) response and serving the cached copy when the network fails or
 * the server answers non-ok. A cold cache offline yields a bare 504, which
 * the home loader treats as "no vehicles" (same as a live upstream failure).
 * `fetcher` is the second arg to match `navigationFallback` — the shared
 * dependency sits in the same slot.
 */
export async function vehiclesNetworkFirst(
  req: Request,
  fetcher: (req: Request) => Promise<Response>,
  cache: Cache,
  waitUntil: (p: Promise<unknown>) => void
): Promise<Response> {
  try {
    const res = await fetcher(req);
    if (res.ok) {
      // Background write — must not delay returning the response, but once
      // respondWith settles the browser may terminate the worker (iOS does so
      // aggressively), killing an un-awaited put mid-write. Handing the put to
      // event.waitUntil keeps the worker alive until the write lands.
      waitUntil(cache.put(req, res.clone()));
      return res;
    }
    // Non-ok (e.g. a 502 because LubeLogger is down) is strictly worse than
    // the last good list — serve the cached copy when one exists; otherwise
    // pass the error through so the loader sees the real status.
    return (await cache.match(req)) ?? res;
  } catch {
    return (await cache.match(req)) ?? new Response(null, { status: 504 });
  }
}
