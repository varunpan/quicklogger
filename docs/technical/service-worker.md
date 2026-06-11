# Service worker — internals

## Overview

The service worker (`src/service-worker.ts`) has three responsibilities:

1. Precache the app shell — including the prerendered `/offline` SPA shell — so
   the PWA launches instantly and an offline cold-start renders the real app
   (see [`offline-app-shell.md`](./offline-app-shell.md)).
2. Route runtime requests with a network-first policy for `/api/*` and
   a cache-first policy for everything else.
3. Replay the offline submission queue on demand, triggered by a
   `sync-queue` message from the layout.

There is no built-in BackgroundSync — see
[No BackgroundSync](#no-backgroundsync).

Registration happens in `src/routes/+layout.svelte`'s `onMount`:

```ts
navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
```

## Shell cache contents

The cache name follows a per-build pattern:

```ts
const CACHE = `quicklogger-shell-${version}`;
```

where `version` comes from the `$service-worker` virtual module (Vite
plugin: SvelteKit). A new build cuts a new version, which is how the
activate handler knows what to prune.

On install, every entry in `[...build, ...files, ...prerendered]` is added to the cache:

- `build` — emitted JavaScript and CSS bundles for the app.
- `files` — anything in `static/` (manifest, icons, etc.).
- `prerendered` — the `/offline` SPA shell HTML (the navigation fallback target).

The cache is opaque to the rest of the app — it's only consumed by the
fetch handler below.

## Vehicle image cache

Separate from the shell cache, fixed name, version baked into the constant:

```ts
const IMG_CACHE = 'quicklogger-vehicle-images-v1';
```

- Written exclusively by the `staleWhileRevalidate` helper for `GET /api/vehicle/image` responses (200 only — 404 "no image" never enters the cache).
- Survives shell upgrades: the activate handler whitelists `IMG_CACHE` alongside the current shell `CACHE` so a new release doesn't wipe images.
- No size budget enforcement in this version — observed bytes are ~40 KB per vehicle and the fleet size is tiny. A future eviction policy is out of scope.

The cache name version suffix (`-v1`) is the rollback escape hatch: if the storage shape ever needs to change in a way that breaks consumers, bumping the suffix forces a clean rebuild on the next activation.

## Vehicle-list API cache

Separate from the shell cache, fixed name:

```ts
const API_CACHE = 'quicklogger-api-cache-v1';
```

- Written exclusively by the `/api/vehicles` fetch branch (`vehiclesNetworkFirst`
  in `src/lib/client/sw-cache.ts`), and only on a `res.ok` response.
- Survives deploys: the `activate` handler whitelists `API_CACHE` alongside the
  current shell `CACHE` and `IMG_CACHE`. Unlike the per-version shell cache, the
  vehicle list must outlive a deploy so an offline cold-start right after an
  update still has a vehicle to log against.
- Network-first: a fresh online load always refreshes it; the cached copy is
  served only when the network is unreachable. A cold cache offline returns 504,
  which the loader treats as "no vehicles".

## Install / activate lifecycle

### Install

```ts
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) =>
      precacheShell(c, SHELL, (err) => sendSwLog('error', 'sw install failed', { message: err.message }))
    )
  );
  void self.skipWaiting();
});
```

- Opens the new versioned cache and adds every shell URL via
  `precacheShell` (`src/lib/client/sw-cache.ts`).
- **Precache failure aborts the install.** `precacheShell` logs the error
  to `/api/log` and then rethrows, so the `waitUntil` promise rejects and
  the new worker never activates — the previous worker (with its intact
  versioned cache) keeps serving. Swallowing the error here would let a
  flaky mid-install network produce a worker with a partial/empty shell,
  and the activate handler would then delete the previous version's
  complete cache (whole-app review #22).
- Calls `skipWaiting()` so the new worker activates immediately
  instead of waiting for all clients to close.

### Activate

```ts
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== IMG_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});
```

- Lists every cache key, deletes any that isn't the current
  `quicklogger-shell-${version}`, the fixed `quicklogger-vehicle-images-v1`, or
  the fixed `quicklogger-api-cache-v1`. Old shell caches don't accumulate; the
  image and vehicle-list caches survive the upgrade.
- `clients.claim()` lets the new worker control already-open pages
  without a reload (paired with `skipWaiting`).

## Fetch handler decision tree

```ts
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  ...
});
```

Two early exits short-circuit the handler:

- **Non-GET requests** (POST/PUT/etc.) — the worker doesn't respond.
  The browser handles them normally. This is why `POST /api/fuelup`
  flows straight through to the network without SW involvement.
- **Cross-origin requests** — same: the worker doesn't respond.
  Examples include the upstream FX provider URLs (when invoked
  client-side — currently they aren't, but the guard is defensive).

For same-origin GETs the handler branches by pathname:

### `/api/vehicle/image` — stale-while-revalidate

```ts
if (url.pathname === '/api/vehicle/image') {
  event.respondWith(staleWhileRevalidate(req));
  return;
}
```

Vehicle images are fetched once per vehicle per device and then near-immutable in normal use, so SWR is the right strategy: serve the cached copy synchronously, kick off a background refresh, and store the new bytes when (if) they arrive. Only 2xx responses are cached — a 404 "no image" is never persisted so a vehicle that gets a photo added in LubeLogger picks it up on the next render (after the server-side vehicles-cache 5-min TTL).

Implementation:

```ts
async function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  const req = event.request;
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  const networkFetch = fetch(req)
    .then(async (res) => {
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    event.waitUntil(networkFetch);  // background refresh; SW kept alive until the write lands
    return cached;
  }
  return (await networkFetch) ?? new Response(null, { status: 504 });
}
```

The background refresh is handed to `event.waitUntil` rather than left
fire-and-forget: once `respondWith`'s promise settles, the browser may
terminate the worker (iOS does so aggressively), killing a detached fetch
or an un-awaited `cache.put` mid-write (whole-app review #23). `waitUntil`
extends the worker's lifetime until the refreshed bytes have actually
landed in the cache. The same applies to the `/api/vehicles` write below.

This branch is inserted *before* the generic `/api/` branch so the image path doesn't fall through to network-first. The `cache-control: no-store` header on the server response is what keeps the browser's HTTP cache out of the picture — `IMG_CACHE` is the only persistence layer for these bytes.

### `/api/vehicles` — network-first with a survives-deploys cache

```ts
if (url.pathname === '/api/vehicles') {
  event.respondWith(
    (async () => {
      const cache = await caches.open(API_CACHE);
      return vehiclesNetworkFirst(req, (r) => fetch(r), cache, (p) => event.waitUntil(p));
    })()
  );
  return;
}
```

Placed before the generic `/api/` branch. `vehiclesNetworkFirst`
(`src/lib/client/sw-cache.ts`) returns the live response and refreshes
`API_CACHE` on every 2xx; on a network failure it serves the cached copy, or a
bare 504 if the cache is cold. This is the one data dependency the offline
cold-start form needs. The cache write goes through `event.waitUntil` (the
fourth argument) so the worker isn't terminated before the "last good
response" actually persists — see the SWR note above.

### `/api/*` — network-first

```ts
if (url.pathname.startsWith('/api/')) {
  event.respondWith(fetch(req).catch(() => new Response(null, { status: 504 })));
  return;
}
```

API calls are never served from cache (data freshness wins). On a
network error, the SW returns an empty `504` so the page can decide
how to fall back (the loader for the form page treats this as
"upstream unavailable" and consults the offline-prefill resolver).

### Navigations — network-first with the `/offline` shell fallback

```ts
if (req.mode === 'navigate') {
  event.respondWith(
    navigationFallback(req, (r) => fetch(r), (k) => caches.match(k))
  );
  return;
}
```

Top-level navigations (`req.mode === 'navigate'`) are network-first so an online
cold-start gets the live SSR'd page. When the network is down, `navigationFallback`
(`src/lib/client/sw-cache.ts`) serves the precached `/offline` shell, which boots
the client router at the requested URL. This branch sits after the `/api/`
branches (a navigation pathname is never `/api/…`) and before the generic
cache-first branch (assets must keep being served from the shell cache). See
[`offline-app-shell.md`](./offline-app-shell.md).

### Everything else — cache-first

```ts
event.respondWith(
  (async () => {
    const cached = await caches.match(req);
    if (cached) return cached;
    try {
      return await fetch(req);
    } catch {
      return cached ?? new Response('offline', { status: 504 });
    }
  })()
);
```

- `caches.match(req)` against any cache (the shell cache covers
  precached entries).
- Network fetch on miss.
- On network failure, return a `504` with body `'offline'`. The
  `cached ?? new Response(...)` fallback in the catch branch is dead —
  by the time control reaches that catch, `cached` was always
  `undefined` (we'd have returned earlier on a cache hit). The `??` is
  defensive only; the synthesized `Response` body `'offline'` with
  status 504 is what the user actually gets when both cache and
  network fail.

There is no runtime caching of fetched-but-not-precached assets —
the cache is fixed by what install put in it.

## Queue replay

The replay glue is a `message` handler:

```ts
self.addEventListener('message', (event) => {
  const data = event.data as SyncQueueMessage | undefined;
  if (data?.type === 'sync-queue') event.waitUntil(syncQueue());
});
```

`syncQueue()` lives in `src/lib/client/sync-queue.ts` (extracted from the
worker so it's unit-testable); the worker just imports and invokes it. It
opens the IndexedDB queue, walks every `'queued'` row, and POSTs each one to
`/api/fuelup` until the per-entry attempt cap (`5`) is hit. A module-level
in-flight guard makes a second concurrent call a no-op, so the back-to-back
`focus` + `visibilitychange` triggers below can't drain the queue twice at
once.

The trigger wiring lives in `registerSyncTriggers()`
(`src/lib/client/sync-trigger.ts`), called from `src/routes/+layout.svelte`'s
`onMount` (extracted from the layout so the wiring is unit-testable):

- A `trigger` function calls
  `navigator.serviceWorker.controller?.postMessage({ type: 'sync-queue' })`.
- It runs once after `navigator.serviceWorker.ready` resolves — gated on
  `ready` so the initial drain isn't a no-op against a still-`null` controller.
- It re-runs on every `window` `focus` event.
- It re-runs on every `window` `online` event — connectivity returning while
  the tab stays foregrounded, with no focus/visibility transition to ride on.
- It also re-runs on `document` `visibilitychange` when the page
  becomes visible — belt-and-suspenders for desktop / Android
  multi-window where a tab can become visible without firing focus.
- The returned cleanup function removes every listener on unmount.

For the full per-entry state machine, response-code branching, and
attempt-cap semantics, see
[`docs/technical/offline-queue.md`](./offline-queue.md#replay-path).
This doc covers only the SW-side glue.

## No BackgroundSync

The service worker does **not** register for the BackgroundSync API:

- No `self.addEventListener('sync', ...)` listener.
- No `registration.sync.register('...')` call anywhere in the codebase
  (verified in `src/service-worker.ts`, `src/routes/+layout.svelte`, and
  `src/lib/client/sync-trigger.ts`).

Why: iOS doesn't fire BackgroundSync events reliably. The
focus / visibility / online + `ready` trigger set is the drain path. A
reconnect flushes the queue on its own via the `online` event; otherwise the
user brings the app back to the foreground and `focus` / `visibilitychange`
flush it. That's the realistic UX on iOS Safari.

Implication: a queued entry will not sync in the background while the
tab is hidden. It syncs when the user comes back.

## `/api/ocr` pass-through (v0.2.0+)

The OCR endpoint is intentionally **not cached and not queued for replay**:

- POST requests are already excluded by the SW's `req.method !== 'GET'`
  guard — image POSTs go straight to the network with no SW involvement.
- GET probes (`getOcrStatus`) fall through the network-first `/api/`
  branch; on failure the loader catches the rejection and treats it as
  `enabled: false`, hiding the camera affordances. No retry, no cached
  status.
- Image blobs are deliberately **not** stored in IndexedDB for offline
  replay. Reasons: (a) ~300 KB per image bloats IDB fast; (b) by the
  time network returns, the user has typically typed values manually;
  (c) an OCR result arriving minutes later out-of-context is worse UX
  than no OCR at all.

No code change required in `src/service-worker.ts` — the existing
network-first `/api/` branch is already correct for OCR's needs.

## Cross-references

- [`docs/technical/offline-queue.md`](./offline-queue.md) — full
  queue replay loop, state machine, schema.
- [`docs/user/offline-queue.md`](../user/offline-queue.md) — user
  view of the offline experience.
- [`docs/technical/idb-and-api.md`](./idb-and-api.md) — combined
  IDB + HTTP API reference.
