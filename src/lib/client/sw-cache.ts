/**
 * Pure, unit-testable cache policies for the service worker. Each depends only
 * on the `fetch`-shaped function and `Cache`/`caches` handles passed in, so a
 * vitest fake can exercise every branch without a real worker. Mirrors the
 * `sync-queue.ts` extraction that made the queue orchestration testable
 * (whole-app review #11: untested SW orchestration).
 */

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
    return (await matchCache('/offline')) ?? new Response('offline', { status: 504 });
  }
}

/**
 * Vehicle-list policy: network-first, refreshing `cache` on every successful
 * (`res.ok`) response and serving the cached copy when the network fails. A
 * cold cache offline yields a bare 504, which the home loader treats as "no
 * vehicles" (same as a live upstream failure).
 */
export async function vehiclesNetworkFirst(
  req: Request,
  cache: Cache,
  fetcher: (req: Request) => Promise<Response>
): Promise<Response> {
  try {
    const res = await fetcher(req);
    if (res.ok) void cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req)) ?? new Response(null, { status: 504 });
  }
}
