# LubeLogger car images — internals

## Overview

Replaces the generic car SVG in every vehicle-row surface — the home Log Fuel button (`src/routes/+page.svelte`), the History vehicle card (`src/routes/history/+page.svelte`), the Maintenance vehicle card (`src/routes/maintenance/+page.svelte`), and each row of the vehicle picker (`src/routes/vehicles/+page.svelte`) — with the vehicle's actual photo stored in LubeLogger, proxied server-side via a new `/api/vehicle/image` endpoint and cached client-side in a dedicated service-worker cache. User view: see the "Vehicle" row in [`docs/user/app-pages.md`](../user/app-pages.md#log-fuel-). Architecture context: this is one extra entry in the `/api/*` surface — see [`docs/architecture.md`](../architecture.md).

## Files touched

- [`src/lib/server/lubelogger.ts`](../../src/lib/server/lubelogger.ts) — adds the `fetchImage(path)` method on `LubeLoggerClient`. First client method that returns a raw `Response` instead of parsed JSON.
- [`src/routes/api/vehicle/image/+server.ts`](../../src/routes/api/vehicle/image/+server.ts) — the new endpoint: parses `vehicleId`, looks up `imageLocation` via the shared vehicles cache (`vehicleCache.ts`), applies a defensive `/images/` path-guard, streams the upstream body with `cache-control: no-store`. Error matrix mirrors the rest of the `/api/vehicle/*` surface.
- [`src/lib/server/vehicleCache.ts`](../../src/lib/server/vehicleCache.ts) — the shared 5-minute normalized-vehicle cache. Both this endpoint and `/api/vehicles` go through `getCachedVehicles(client)`, so a cold load that fires both makes one upstream `listVehicles()` call, not two (review #36).
- [`src/service-worker.ts`](../../src/service-worker.ts) — adds the fixed-name `IMG_CACHE` constant, a `staleWhileRevalidate` helper, a fetch-handler branch for `/api/vehicle/image` placed *before* the generic `/api/` network-first branch, and a tweak to the activate handler so `IMG_CACHE` survives shell upgrades.
- [`src/lib/client/VehicleImage.svelte`](../../src/lib/client/VehicleImage.svelte) — shared icon-slot component. Encapsulates the `vehicleImageOk = $state(true)` flag, the `$effect` keyed on `vehicleId` that resets the flag on vehicle switch, and the `<img>` / SVG-fallback render branch. Accepts `vehicleId`, `class` (passed through to the outer wrapper so callers control sizing), and `svgSize` (defaults to 22; the picker passes 24).
- [`src/routes/+page.svelte`](../../src/routes/+page.svelte) — vehicle button consumes the shared `<VehicleImage>` component instead of inlining the pattern.
- [`src/routes/history/+page.svelte`](../../src/routes/history/+page.svelte) — vehicle card consumes `<VehicleImage>` instead of the static SVG slot.
- [`src/routes/maintenance/+page.svelte`](../../src/routes/maintenance/+page.svelte) — vehicle card consumes `<VehicleImage>` instead of the static SVG slot.
- [`src/routes/vehicles/+page.svelte`](../../src/routes/vehicles/+page.svelte) — each list row in the picker renders its own `<VehicleImage>` instance with `class="w-14 h-14"` and `svgSize={24}`. Per-row instances each own their own `vehicleImageOk` flag — no shared bookkeeping.

## Data model

No new types, no schema changes, no new prefs. The endpoint reads the existing `Vehicle.imageLocation` field (typed as `[key: string]: unknown` on the `Vehicle` interface in `src/lib/server/lubelogger.ts`; verified during design to be either `""` or a `/images/<uuid>.<ext>` path).

In-memory caches:

| Layer | Cache | Key | TTL | Reset |
|---|---|---|---|---|
| Server | `TtlCache<Vehicle[]>` in `src/lib/server/vehicleCache.ts` (shared with `/api/vehicles`) | `'vehicles'` | 5 min | Process restart; or `_resetCache()` (delegates to `_resetVehicleCache()`) in tests. One cache for both routes. |
| Service worker | `quicklogger-vehicle-images-v1` (`caches` API) | Full `Request` | Until evicted by quota or rollback (cache-name version bump) | `activate` handler whitelists this cache name so it survives shell upgrades. |

## Lifecycle / control flow

1. User opens any page that renders a vehicle row (`/`, `/history`, `/maintenance`, or the `/vehicles` picker list). Each rendered `<VehicleImage>` receives a `vehicleId` prop — either the active vehicle's id (single-vehicle surfaces) or the per-row id (picker).
2. Each `<VehicleImage>` instance initialises `vehicleImageOk = true`. The `<img>` is rendered first, with `src` pointing at `/api/vehicle/image?vehicleId=<id>`.
3. The browser fires a GET. The service worker fetch handler matches `/api/vehicle/image` (matched *before* the generic `/api/` branch) and routes through `staleWhileRevalidate`:
   - Open `IMG_CACHE`, look for an exact-`Request` match.
   - Kick off a network fetch in parallel; on a 2xx response, `cache.put(req, res.clone())`.
   - If there was a cache hit, return it immediately and let the network refresh complete in the background. If not, await the network fetch and return whatever it produces (or a `504` if the fetch threw).
4. The server endpoint runs only when the SW lets the request through:
   - Validate `vehicleId` (`Number.isFinite`).
   - `getCachedVehicles(client)` — the shared 5-min vehicles cache.
   - Find the vehicle. If missing → 404. Read `imageLocation`. If empty / not a string / doesn't start with `/images/` → 404.
   - `client.fetchImage(path)` returns a raw `Response`. Re-emit the body stream with the upstream `content-type` and `cache-control: no-store`.
5. The browser receives the image bytes (200) or a 404. On 200, the `<img>` renders and `vehicleImageOk` stays `true`. On 404 (or any other non-2xx — the SW's SWR helper falls through), the `<img>` element's `onerror` fires and flips `vehicleImageOk = false`, triggering Svelte to re-render the slot with the fallback SVG.
6. If the user switches vehicles on a single-vehicle surface (the parent's `vehicle` reassigns and a new `vehicleId` flows in as a prop), the component's `$effect(() => { void vehicleId; vehicleImageOk = true; })` re-runs and resets the flag, giving the new vehicle a fresh chance at loading its photo. The `void` prefix is purely cosmetic — it tells ESLint's `no-unused-expressions` rule that the read is intentional while still letting Svelte's reactivity tracker subscribe. The cycle repeats from step 2. On the picker, each row is a separate `<VehicleImage>` instance whose `vehicleId` never changes, so the effect runs once at mount and then only if the row remounts.

## Edge cases & invariants

| Scenario | Behaviour | Why |
|---|---|---|
| Vehicle has no image (`imageLocation === ''`) | Endpoint 404 → `<img>` `onerror` → SVG fallback | The "no image" case is the same UX as a fetch failure — the user sees the original generic icon |
| Upstream 5xx during image fetch | Endpoint 502 → SWR helper returns 502 to the browser → `<img>` `onerror` → SVG fallback | Same fallback path; user is never blocked |
| Network offline, image cached previously | SWR returns cached bytes immediately, background refresh fails silently | This is the SWR contract; cache survives until rollback or eviction |
| Network offline, image never cached | SWR helper awaits network fetch → throws → returns 504 → `<img>` `onerror` → SVG fallback | Graceful degradation, no UI hang |
| Vehicle switch to one without image | `$effect` resets `vehicleImageOk` to `true` → `<img>` re-attempts → 404 → fallback re-applies | Without this reset, every vehicle after a fall-back-once vehicle would show the SVG even if it had a photo |
| Photo added in LubeLogger for a previously-imageless vehicle | Picked up after server-side `TtlCache` TTL expires (≤5 min) — no SW invalidation needed because 404s aren't cached | The 404 was never persisted, so the next image-load attempt re-hits the server |
| Path-guard: upstream returns a non-`/images/` path | 404 with `{ error: 'no image' }` | Defense-in-depth in case a future LubeLogger version stores arbitrary paths in `imageLocation` |
| Vehicle id not in the upstream list | 404 with `{ error: 'no image' }` | Same code path as "no image" — both are user-invisible failures handled by the fallback |
| Browser HTTP cache attempting to interfere | `cache-control: no-store` on the 200 response keeps the HTTP cache out of the picture | SW's `IMG_CACHE` is the single source of cached bytes |

## Non-obvious decisions

**One shared vehicles cache module, not a `TtlCache` per endpoint.** `/api/vehicles` and `/api/vehicle/image` both go through `getCachedVehicles(client)` in `vehicleCache.ts`. The original v0.2.0 design gave each endpoint its own `TtlCache<Vehicle[]>` as the smallest diff, accepting "at most one extra `listVehicles()` call per 5-minute window when both run cold." A cold page load fires both routes together, so that double-call happened on essentially every cold load — on two independent TTL clocks. The shared module collapses it to one call, and `TtlCache`'s single-flight dedup (it caches the in-flight promise, evicting on rejection) means even simultaneous cold misses share one fetch rather than racing (review #36). The cache stores the **normalized** list, so `/api/vehicles` returns it directly and the image route reads `imageLocation` off the same objects (the normalizer spreads every upstream field through).

**Endpoint returns raw `Response.body` rather than buffering into a `Buffer`.** Streaming preserves the 40 KB-or-so per-vehicle payload size and keeps the endpoint's memory footprint flat. The downstream code (Node `fetch` Response on Node 22) hands a `ReadableStream` to the new `Response()` constructor; SvelteKit / `@sveltejs/adapter-node` then streams it to the client.

**`cache-control: no-store` on the 200 response is deliberate.** The service worker's `IMG_CACHE` is the authoritative client-side cache. Letting the browser's HTTP cache also store the bytes would create two staleness windows for the same resource and complicate the rollback story (a cache-name bump on `IMG_CACHE` wouldn't clear the HTTP cache).

**Fall-back trigger is `<img>` `onerror`, not pre-flight fetch.** A pre-flight `fetch('/api/vehicle/image?...')` to check the status would double the network cost and force the page to render with the SVG flicker, then swap. The `<img>` element's natural `onerror` event fires at the same point and lets the SVG render only on real failure.

**`$effect` keyed on `vehicleId`, not on a parent's `vehicle` object.** Reading the primitive id pins the effect's dependency to the value that actually determines which photo to load. A bare object read also works (Svelte 5 tracks deep), but the explicit id access is cheaper to reason about and makes the effect's trigger condition obvious to a future reader.

**Per-instance state, not a shared `Set<number>`.** The picker renders N rows, each with its own `<VehicleImage>` instance and therefore its own `vehicleImageOk` flag. A list-level `Set` of failed ids would centralize the bookkeeping but spread the lifecycle across the parent — keeping each row self-contained is simpler and matches the pattern used on the three single-vehicle surfaces.

**Path-guard refuses anything outside `/images/` even though we control the upstream.** Defensive: a future LubeLogger version could change what shows up in `imageLocation` (e.g. an external URL for off-site storage) and we don't want quicklogger to start proxying arbitrary URLs by accident.

**`alt=""` on the `<img>`.** The year/make/model renders next to the icon slot. Per WAI-ARIA decorative-image patterns, the image is informationally redundant — an empty alt is correct, not an oversight.

**No SW unit test.** The existing service worker has none; its fetch handler is verified manually in UAT. The SWR helper has straight-line control flow — adding a SW test harness for this one branch isn't worth the setup cost.

## Future considerations

- **Pre-warming `IMG_CACHE` during SW install.** Would require enumerating vehicle ids in install scope, which complicates the install handler for a marginal latency win on first vehicle view. Deferred.
- **Image upload from quicklogger.** Read-only is enough for now. Upload would need a new write endpoint and a UI surface that doesn't exist.
- **Multiple sizes / thumbnails.** Single 48×48 display, image bytes ~40 KB — no perf reason to vary. If `/history` and `/vehicles` start showing photos at different sizes a `?size=` query param could route through a server-side resize step.
- **`IMG_CACHE` size budget.** No eviction policy in v1. Fleet size and per-photo bytes keep this comfortably under quota; revisit if either grows materially.
