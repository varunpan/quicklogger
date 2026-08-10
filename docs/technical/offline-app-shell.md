# Offline app shell — internals

## Overview

An offline cold-start — launching the installed PWA or hard-navigating with no
network — used to return a bare `504 "offline"` because nothing HTML-shaped was
ever cached (every route is SSR-only; `prerender = false`). This feature
precaches a single route-agnostic SPA shell and serves it as the navigation
fallback, so the client router boots offline and renders the requested route.
The home loader has two offline-fatal data dependencies — the vehicle list and
the server-info blob (instance units/currency/locale) — and both are now
SW-cached, so the log-fuel form is usable offline and labeled correctly.

Navigations stay **network-first**: an online cold-start still gets the live
SSR'd page with fresh data. The precached shell is served **only** when the
network fails.

## Files touched

| File                              | Role                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `src/routes/offline/+page.ts`     | `prerender=true; ssr=false` — emits the route-agnostic shell at build time.                                    |
| `src/routes/offline/+page.svelte` | Minimal carrier copy; shown only on a direct `/offline` visit.                                                 |
| `src/hooks.server.ts`             | `building` guard short-circuits `handle` during prerender (no env, no boot).                                   |
| `svelte.config.js`                | `paths.relative = false` — absolute `/_app/…` asset URLs.                                                      |
| `src/service-worker.ts`           | Precaches `...prerendered`; navigation + `/api/vehicles` + `/api/server-info` branches; `API_CACHE` whitelist. |
| `src/lib/client/sw-cache.ts`      | Pure, unit-tested `navigationFallback` + `networkFirst`.                                                       |
| `src/lib/client/cache-warm.ts`    | Post-`ready` one-shot `GET /api/vehicles` so SSR'd page loads still warm `API_CACHE`.                          |
| `src/routes/+page.svelte`         | Reactive `online` flag → offline banner + `Save offline` button label.                                         |

## Data model

Two SW Cache Storage buckets are involved (no IndexedDB change):

- `quicklogger-shell-${version}` (existing) — now also holds the `/offline`
  HTML via `...prerendered`. Per-version: pruned and rebuilt on every deploy, so
  the shell HTML always matches the chunks it references (atomic consistency).
- `quicklogger-api-cache-v1` (new, fixed name) — holds the last good
  `GET /api/vehicles` JSON **and** the last good `GET /api/server-info` JSON,
  each written by its own fetch branch through the same shared `networkFirst`
  policy. Fixed name so both entries **survive deploys** (this data must
  outlive a per-version shell cache) and the cache is whitelisted in
  `activate`.

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
                                              → networkFirst: fetch throws → API_CACHE hit ✓
                                        • lastFuelup     → /api/* 504 → offline resolver (localStorage/IDB)
                                        • getOcrStatus   → /api/* 504 → catch → camera hidden
                                        • FX             → currency===target → no fetch
                                  └─► layout onMount also re-fetches /api/server-info → SW branch
                                        → networkFirst: fetch throws → API_CACHE hit ✓ → saveServerInfo()
                                        refreshes the localStorage blob effectiveVolumeUnit() etc. read
                                  └─► form populated; offline banner shown; button = "Save offline"
                                        └─► submit → POST /api/fuelup (SW ignores non-GET) → fetch throws
                                              └─► Queue.enqueue(pendingSubmissions) → "Saved locally" toast
                                                    └─► replays on reconnect (existing sync-queue path)
```

Online navigations skip all of this: `navigationFallback`'s `fetch(req)`
resolves and the SSR'd page is returned unchanged.

## Edge cases & invariants

- **Cold cache offline** (installed but never opened online): `API_CACHE` empty →
  `networkFirst` returns 504 for both `/api/vehicles` and `/api/server-info` →
  `listVehicles().catch(() => [])` gives an empty form, and
  `effectiveVolumeUnit()`/`effectiveDistanceUnit()`/`effectiveCurrencyCode()`/
  `effectiveLocale()` fall back to their gal/mi/USD/en-US defaults (same as
  today for a device that's never talked to the server — see
  [`instance-units.md`](./instance-units.md)). The first online open fills
  both entries: `/api/vehicles` via the layout's warming fetch (`cache-warm.ts`)
  — SSR serializes the vehicle list into the HTML, so a full navigation never
  issues a browser `GET /api/vehicles` the SW could see, and without the
  warming fetch a user whose every session is "launch → log → quit" (full
  navigations only) would keep that entry cold indefinitely (whole-app review
  #24); `/api/server-info` via the layout's unconditional boot-refresh fetch,
  which runs on every load regardless of SSR/CSR, so it needs no equivalent
  warming helper. Residual: on the very first install the warming fetch can
  bypass the still-uncontrolled page; the next launch covers it. A first-ever
  load that happens to be offline therefore still has **no** server-info to
  serve — this cold-start degradation is unavoidable without shipping
  defaults baked into the precached shell, which was rejected (a wrong-unit
  default masquerading as real data is worse than an honest gal/mi fallback).
- **Build with no env:** `handle` returns early on `building`, so prerendering
  `/offline` never calls `loadEnv()`. Mandatory — Docker/CI build has no runtime env.
- **Branch ordering invariant:** `/api/vehicles` and `/api/server-info` are
  both matched before the generic `/api/*` branch; the navigation branch sits
  after `/api/*` (a navigation pathname is never `/api/…`) and before the
  generic cache-first branch (so precached assets keep being served
  cache-first).
- **Non-ok responses are not cached:** `networkFirst` only `cache.put`s
  on `res.ok`, so a 500/502 from upstream never poisons `API_CACHE` — for
  either entry. The reverse also holds: with a warm cache, a non-ok response
  is _masked_ by the cached last-good value (the form stays usable while
  LubeLogger is down); the error only reaches the caller when the cache is
  cold.
- **Banner is connectivity-driven:** `online` tracks the live `online`/`offline`
  events, so a warm tab that drops its connection also shows the banner — not
  just cold starts. Only the home route renders it.

## Non-obvious decisions

- **`ssr = false` on the shell route** keeps the prerendered HTML data-free, so
  it can boot any route from `location` (SPA-fallback semantics) and the build
  needs no env.
- **`API_CACHE` is a fixed-name bucket**, not the per-version shell cache and
  not `IMG_CACHE`: shell caches are pruned every deploy (vehicle list and
  server-info must survive), and `IMG_CACHE` is image-bytes/SWR-specific
  (wrong boundary). `/api/server-info` reuses the same bucket the vehicle list
  already established rather than introducing a second one — one fixed-name
  cache, one whitelist entry, one policy.
- **SW-cache over localStorage** for the vehicle list keeps all offline logic in
  the worker and leaves `+page.ts` / `listVehicles()` untouched — the SW
  intercepts the existing fetch transparently. `/api/server-info` already had a
  localStorage cache (`saveServerInfo`/`loadServerInfo`) written by the
  layout's boot-refresh; the SW cache is a second, independent layer underneath
  it — it makes the boot-refresh's own `fetch('/api/server-info')` succeed
  offline (serving the last-known blob) so `saveServerInfo` still runs and
  localStorage stays warm, rather than replacing localStorage as the read-side
  source of truth.
- **`controllerchange` reload handshake** (added by whole-app review #7's fix,
  hardened by #39's): the shell + chunks are precached atomically per version,
  so a fresh offline cold-start is internally consistent — but a tab already
  open across a deploy keeps running the old build's JS while the new SW
  claims it and prunes the old shell cache. `registerControllerReload`
  (`src/lib/client/sw-update.ts`) reloads the page only when the controlling
  worker's build version actually differs from the page's (queried over a
  MessageChannel), capped at one reload per build per tab session — a bare
  `controllerchange` is not a reliable "new deploy" signal on WebKit, and
  reloading on every one made the installed PWA reload-loop (#39, v0.2.7
  regression, fixed in v0.2.8). Full decision flow:
  [`service-worker.md`](./service-worker.md).
- **`paths.relative = false` is load-bearing — and version-fragile.** Root-relative
  asset URLs are what let the single `/offline` shell resolve `/_app/…` chunks at
  any route depth; a `./`-relative URL served under e.g. `/maintenance` would
  resolve against the wrong base. SvelteKit **2.65.0 silently regressed this**
  ([kit #16039](https://github.com/sveltejs/kit/issues/16039) / #16013, a
  side-effect of #15936): with `relative: false` it emitted `./`-prefixed CSS
  preload deps resolved against the entry chunk's `import.meta.url`, yielding a
  doubled `/_app/immutable/entry/_app/immutable/…` 404 plus an "Unable to preload
  CSS" rejection on first load. v0.3.0 pinned kit to **2.64.0** (the last release
  honoring the setting) as a stopgap; the upstream fix (#16026) shipped in
  **2.65.1**, so v0.3.1 dropped the pin and re-bumped to **2.68.0** (caret range
  restored). The regression stays guarded by `tests/e2e/css-preload.spec.ts`.

## Testing

- **Unit** — the two cache policies are pure and fully unit-tested in
  `src/lib/client/sw-cache.test.ts`: navigation fallback (online passthrough,
  offline `/offline`-shell fallback, cold-cache 504) and the shared
  `networkFirst` policy (refresh on 2xx, no-cache on non-2xx, cached serve
  offline, cold-cache 504), exercised against both `/api/vehicles` and
  `/api/server-info` requests to confirm it carries no endpoint-specific
  knowledge.
- **No Playwright e2e.** The offline cold-start can't be exercised through the
  project's only e2e browser (WebKit / `mobile-safari`): `context.setOffline(true)`
  makes WebKit fail every navigation with an internal error before the SW can
  serve, and a SW `cache.put` that clones a response the loader is concurrently
  consuming doesn't persist in Playwright's WebKit (synthetic puts and the
  install-time shell precache do persist). Both are Playwright-WebKit automation
  artifacts — real iOS Safari runs this standard PWA pattern fine. The end-to-end
  offline path (boot from shell → cached vehicle list → queued submit) is
  validated by manual UAT on a device instead.

## Cross-references

- [`service-worker.md`](./service-worker.md) — full fetch-handler decision tree.
- [`idb-and-api.md`](./idb-and-api.md) — cache inventory, `/api/vehicles`.
- [`offline-queue.md`](./offline-queue.md) — the queue the offline submit lands in.
- [`docs/user/offline-queue.md`](../user/offline-queue.md) — user view.
