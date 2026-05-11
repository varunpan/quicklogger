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
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});
```

- Lists every cache key, deletes any that isn't the current
  `quicklogger-shell-${version}`. That's the pruning step — old shell
  caches don't accumulate across releases.
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
  precached entries; the second-tier `cached ?? ...` fallback is
  defensive — `cached` is already `undefined` here since we'd have
  returned early if it weren't).
- Network fetch on miss.
- On network failure, return the cached entry if one exists; otherwise
  a `504` with body `'offline'`.

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

`syncQueue()` opens the IndexedDB queue, walks every `'queued'` row,
and POSTs each one to `/api/fuelup` until the per-entry attempt cap
(`5`) is hit.

The trigger lives in `src/routes/+layout.svelte`'s `onMount`:

- A `trigger` function calls
  `navigator.serviceWorker.controller?.postMessage({ type: 'sync-queue' })`.
- It runs once on mount.
- It re-runs on every `window` `focus` event.
- The cleanup function removes the `focus` listener on unmount.

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

## Cross-references

- [`docs/technical/offline-queue.md`](./offline-queue.md) — full
  queue replay loop, state machine, schema.
- [`docs/user/offline-queue.md`](../user/offline-queue.md) — user
  view of the offline experience.
- [`docs/technical/idb-and-api.md`](./idb-and-api.md) — combined
  IDB + HTTP API reference.
