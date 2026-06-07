# Offline app shell — internals

## Overview

An offline cold-start — launching the installed PWA or hard-navigating with no
network — used to return a bare `504 "offline"` because nothing HTML-shaped was
ever cached (every route is SSR-only; `prerender = false`). This feature
precaches a single route-agnostic SPA shell and serves it as the navigation
fallback, so the client router boots offline and renders the requested route.
The home loader's one offline-fatal data dependency — the vehicle list — is now
SW-cached, so the log-fuel form is usable offline.

Navigations stay **network-first**: an online cold-start still gets the live
SSR'd page with fresh data. The precached shell is served **only** when the
network fails.

## Files touched

| File | Role |
|---|---|
| `src/routes/offline/+page.ts` | `prerender=true; ssr=false` — emits the route-agnostic shell at build time. |
| `src/routes/offline/+page.svelte` | Minimal carrier copy; shown only on a direct `/offline` visit. |
| `src/hooks.server.ts` | `building` guard short-circuits `handle` during prerender (no env, no boot). |
| `svelte.config.js` | `paths.relative = false` — absolute `/_app/…` asset URLs. |
| `src/service-worker.ts` | Precaches `...prerendered`; navigation + `/api/vehicles` branches; `API_CACHE` whitelist. |
| `src/lib/client/sw-cache.ts` | Pure, unit-tested `navigationFallback` + `vehiclesNetworkFirst`. |
| `src/routes/+page.svelte` | Reactive `online` flag → offline banner + `Save offline` button label. |

## Data model

Two SW Cache Storage buckets are involved (no IndexedDB change):

- `quicklogger-shell-${version}` (existing) — now also holds the `/offline`
  HTML via `...prerendered`. Per-version: pruned and rebuilt on every deploy, so
  the shell HTML always matches the chunks it references (atomic consistency).
- `quicklogger-api-cache-v1` (new, fixed name) — holds the last good
  `GET /api/vehicles` JSON. Fixed name so it **survives deploys** (vehicle data
  must outlive a per-version shell cache) and is whitelisted in `activate`.

`pendingSubmissions` (IndexedDB) is untouched — an offline submit queues exactly
as before.

## Lifecycle / control flow

```text
OFFLINE cold-start
  PWA launch / hard nav to /
    └─► SW fetch handler, req.mode === 'navigate'
          └─► navigationFallback: fetch() throws (offline)
                └─► caches.match('/offline') → precached shell HTML
                      └─► browser loads it AT url "/"
                            └─► kit.start() reads location "/" → renders home route client-side
                                  └─► home loader runs in the browser:
                                        • listVehicles(fetch) → SW /api/vehicles branch
                                              → vehiclesNetworkFirst: fetch throws → API_CACHE hit ✓
                                        • lastFuelup     → /api/* 504 → offline resolver (localStorage/IDB)
                                        • getOcrStatus   → /api/* 504 → catch → camera hidden
                                        • FX             → currency===target → no fetch
                                  └─► form populated; offline banner shown; button = "Save offline"
                                        └─► submit → POST /api/fuelup (SW ignores non-GET) → fetch throws
                                              └─► Queue.enqueue(pendingSubmissions) → "Saved locally" toast
                                                    └─► replays on reconnect (existing sync-queue path)
```

Online navigations skip all of this: `navigationFallback`'s `fetch(req)`
resolves and the SSR'd page is returned unchanged.

## Edge cases & invariants

- **Cold cache offline** (installed but never opened online): `API_CACHE` empty →
  `vehiclesNetworkFirst` returns 504 → `listVehicles().catch(() => [])` → empty
  form (same as today). First online open fills the cache.
- **Build with no env:** `handle` returns early on `building`, so prerendering
  `/offline` never calls `loadEnv()`. Mandatory — Docker/CI build has no runtime env.
- **Branch ordering invariant:** `/api/vehicles` is matched before the generic
  `/api/*` branch; the navigation branch sits after `/api/*` (a navigation
  pathname is never `/api/…`) and before the generic cache-first branch (so
  precached assets keep being served cache-first).
- **Non-ok responses are not cached:** `vehiclesNetworkFirst` only `cache.put`s
  on `res.ok`, so a 500/502 from upstream never poisons `API_CACHE`.
- **Banner is connectivity-driven:** `online` tracks the live `online`/`offline`
  events, so a warm tab that drops its connection also shows the banner — not
  just cold starts. Only the home route renders it.

## Non-obvious decisions

- **`ssr = false` on the shell route** keeps the prerendered HTML data-free, so
  it can boot any route from `location` (SPA-fallback semantics) and the build
  needs no env.
- **`API_CACHE` is a new fixed-name bucket**, not the per-version shell cache and
  not `IMG_CACHE`: shell caches are pruned every deploy (vehicle data must
  survive), and `IMG_CACHE` is image-bytes/SWR-specific (wrong boundary).
- **SW-cache over localStorage** for the vehicle list keeps all offline logic in
  the worker and leaves `+page.ts` / `listVehicles()` untouched — the SW
  intercepts the existing fetch transparently.
- **No `controllerchange` reload handshake.** The shell + chunks are precached
  atomically per version, so a fresh offline cold-start is internally consistent.
  The pre-existing stale-chunk-across-deploy risk (whole-app review #7) is
  neither improved nor worsened here and is a separate fix.

## Cross-references

- [`service-worker.md`](./service-worker.md) — full fetch-handler decision tree.
- [`idb-and-api.md`](./idb-and-api.md) — cache inventory, `/api/vehicles`.
- [`offline-queue.md`](./offline-queue.md) — the queue the offline submit lands in.
- [`docs/user/offline-queue.md`](../user/offline-queue.md) — user view.
