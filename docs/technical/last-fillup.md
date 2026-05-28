# Last-fillup offline resolver

## Overview

`src/lib/client/last-fillup.ts` resolves the "last fillup" record the home
page renders — pulling from the per-vehicle localStorage cache
(`quicklogger.lastFuelup.<id>`) and the IDB queue, picking the freshest, and
returning a single `LastFillupRecord`. The cache writer is `+page.ts`'s
`load`, which writes the upstream snapshot verbatim after each successful
`/api/vehicle/last-fuelup` fetch.

Related: [`offline-queue.md`](./offline-queue.md) for the IDB layer,
[`idb-and-api.md`](./idb-and-api.md) for the upstream wire shape,
[`format.md`](./format.md) for the rendering helpers.

## `LastFillupRecord` shape

```ts
interface LastFillupRecord {
  date: string;          // ISO YYYY-MM-DD (post-locale-invariant-parsing)
  odometer: string;      // raw integer-string of miles
  fuelConsumed: string;  // gallons (always — queue L is converted)
  cost: string | null;   // 2-decimal stringified number
  costCurrency: string | null; // null for upstream rows; entered currency for queue rows
  notes: string | null;
}
```

## Tolerant-read migration

Cache entries are written verbatim from the wire. Post-this-branch the wire
shape is typed-ISO. Entries written BEFORE this branch hold LubeLogger's
instance-locale date string (e.g. `4/7/2024` for en-US). The resolver
migrates these in place using cached `/api/info` `dateFormat`:

- Fast path: `^\d{4}-\d{2}-\d{2}$` → parse directly.
- Slow path: `cachedDateFormat` (from `loadServerInfo()?.dateFormat`) maps
  the raw string. Handles `M/d/yyyy`, `d/M/yyyy`, `yyyy-MM-dd`, `d.M.yyyy`.
- Unknown pattern or empty server-info cache → returns null → caller treats
  as cache miss → next upstream fetch repopulates with the new shape.

No explicit "rewrite-on-read" — the cache repopulates naturally on the next
successful `/api/vehicle/last-fuelup` call.

## Lifecycle

1. `+page.ts` load fetches `/api/vehicle/last-fuelup` and writes the raw
   GasRecord into `quicklogger.lastFuelup.<id>` on success.
2. Home page mounts; if upstream succeeded, `LastFillupRecord` is built
   from the fresh response. If upstream failed, the page falls back to
   `resolveOfflineLastFillup` (which reads cache + queue).
3. Cache reads pass through `parseDateForCache` (fast or slow path).
4. Queue entries are typed `FuelSubmissionInput` with ISO date — no
   parsing needed.

## Edge cases & invariants

- **`status === 'failed'` queue entries are excluded.** Failed offline
  submissions don't represent a real recorded fillup.
- **Tie-break on identical dates favors the most recently enqueued.**
  Enqueue order is the only reliable signal at day-resolution.
- **SSR safe.** `typeof localStorage === 'undefined'` returns null from
  `readCacheCandidate` and from `loadServerInfo`.
- **Empty server-info cache + legacy entry = ~200ms strip flicker.** The
  legacy entry parses to null → cache miss → upstream fetch repopulates.
  Acceptable; same outcome as strict-discard.
