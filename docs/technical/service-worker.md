# Service worker — internals

## Overview

The service worker (`src/service-worker.ts`) has three responsibilities:

1. Precache the app shell so the PWA launches instantly and continues
   to render when offline.
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

On install, every entry in `[...build, ...files]` is added to the cache:

- `build` — emitted JavaScript and CSS bundles for the app.
- `files` — anything in `static/` (manifest, icons, etc.).

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

## Install / activate lifecycle

### Install

```ts
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  void self.skipWaiting();
});
```

- Opens the new versioned cache and adds every shell URL.
- Calls `skipWaiting()` so the new worker activates immediately
  instead of waiting for all clients to close.

### Activate

```ts
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});
```

- Lists every cache key, deletes any that isn't either the current
  `quicklogger-shell-${version}` or the fixed `quicklogger-vehicle-images-v1`.
  That's the pruning step — old shell caches don't accumulate across
  releases, and the vehicle-image cache survives the upgrade.
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
async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  const networkFetch = fetch(req)
    .then((res) => {
      if (res.ok) void cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    void networkFetch;  // fire-and-forget refresh
    return cached;
  }
  return (await networkFetch) ?? new Response(null, { status: 504 });
}
```

This branch is inserted *before* the generic `/api/` branch so the image path doesn't fall through to network-first. The `cache-control: no-store` header on the server response is what keeps the browser's HTTP cache out of the picture — `IMG_CACHE` is the only persistence layer for these bytes.

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

The trigger lives in `src/routes/+layout.svelte`'s `onMount`:

- A `trigger` function calls
  `navigator.serviceWorker.controller?.postMessage({ type: 'sync-queue' })`.
- It runs once on mount.
- It re-runs on every `window` `focus` event.
- It also re-runs on `document` `visibilitychange` when the page
  becomes visible — belt-and-suspenders for desktop / Android
  multi-window where a tab can become visible without firing focus.
- The cleanup function removes both listeners on unmount.

For the full per-entry state machine, response-code branching, and
attempt-cap semantics, see
[`docs/technical/offline-queue.md`](./offline-queue.md#replay-path).
This doc covers only the SW-side glue.

## No BackgroundSync

The service worker does **not** register for the BackgroundSync API:

- No `self.addEventListener('sync', ...)` listener.
- No `registration.sync.register('...')` call anywhere in the codebase
  (verified in `src/service-worker.ts` and `src/routes/+layout.svelte`).

Why: iOS doesn't fire BackgroundSync events reliably. The
focus-event + on-mount pattern is the primary trigger and the only
trigger today. The user has to reopen the app (or focus the
already-open tab) for queued submissions to flush. That's the
realistic UX on iOS Safari.

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
