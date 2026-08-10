# Last-fillup offline resolver

## Overview

`src/lib/client/last-fillup.ts` resolves the "last fillup" record the home
page renders — pulling from the per-vehicle localStorage cache
(`quicklogger.lastFuelup.<id>`) and the IDB queue, picking the freshest, and
returning a single `LastFillupRecord`. The cache writer is `+page.ts`'s
`load`, which writes a five-field projection of the upstream response
(`date`, `odometer`, `fuelConsumed`, `cost`, `notes`) — not the raw
`GasRecord` — after each successful `/api/vehicle/last-fuelup` fetch. See
§ _Writer_ for why.

Related: [`offline-queue.md`](./offline-queue.md) for the IDB layer,
[`idb-and-api.md`](./idb-and-api.md) for the upstream wire shape,
[`format.md`](./format.md) for the rendering helpers.

## `LastFillupRecord` shape

```ts
interface LastFillupRecord {
  date: string; // ISO YYYY-MM-DD (post-locale-invariant-parsing)
  odometer: string; // raw integer-string, in the instance distance unit
  fuelConsumed: string; // instance unit (queue entries converted; upstream snapshots already are)
  cost: string | null; // stringified number: 2-decimal from queue rows, verbatim from the cache
  costCurrency: string | null; // null for upstream rows; entered currency for queue rows
  notes: string | null;
}
```

`fuelConsumed` basis: upstream snapshots (cache reads) are already in the
instance volume unit — LubeLogger stores them that way and quicklogger's
converter (`docs/technical/instance-units.md`) writes them that way. Queue
entries are entered-unit and get converted at read-time in
`readQueueCandidates` via `effectiveVolumeUnit()` (`$lib/client/format.ts`),
so both sources compare 1:1 regardless of which unit the user typed in.
`effectiveVolumeUnit()` falls back to `'gal'` on a cold `quicklogger-server-info`
cache (SSR, first load, pre-v0.3.2 cache) — worst case a queue row briefly
renders in gallons on a liters instance until the layout's boot refresh
populates the cache; self-corrects on the next read, no user action needed.

## `LastFillupSource`

`last-fillup.ts` also exports `LastFillupSource` (`'upstream' | 'offline' | null`).
`+page.ts`'s `load` returns it as `lastFuelupSource` alongside the record:
`'upstream'` when the live `/api/vehicle/last-fuelup` fetch succeeded, `'offline'`
when the page fell back to `resolveOfflineLastFillup`, and `null` when there is no
record at all. The home page reads it to render the amber **offline copy** badge on
the strip only for `'offline'` rows.

## Writer

`+page.ts` writes ONLY the fields the resolver reads (`date`, `odometer`,
`fuelConsumed`, `cost`, `notes`) to keep localStorage quota usage minimal.
The full upstream `GasRecord` includes `extraFields`, `files`, `tags`, etc.
which can be arbitrarily large; persisting them verbatim would risk silent
quota truncation.

## Tolerant-read migration

Cache entries are written verbatim from the wire. Post-this-branch the wire
shape is typed-ISO. Entries written BEFORE this branch hold LubeLogger's
instance-locale date string (e.g. `4/7/2024` for en-US). The resolver
migrates these in place using cached `/api/info` `dateFormat`:

- Fast path: `^\d{4}-\d{2}-\d{2}$` → parse directly.
- Slow path: `cachedDateFormat` (from `loadServerInfo()?.dateFormat`) selects
  one of four closed-set parsers: `M/d/yyyy`, `d/M/yyyy`, `yyyy-MM-dd`,
  `d.M.yyyy`. Any format string outside this set returns null.
- Unknown pattern or empty server-info cache → returns null → caller treats
  as cache miss → next upstream fetch repopulates with the new shape.

No explicit "rewrite-on-read" — the cache repopulates naturally on the next
successful `/api/vehicle/last-fuelup` call.

## Lifecycle

1. `+page.ts` load fetches `/api/vehicle/last-fuelup` and writes the
   five-field projection (`date`, `odometer`, `fuelConsumed`, `cost`,
   `notes` — see § _Writer_) into `quicklogger.lastFuelup.<id>` on success.
2. Home page mounts; if upstream succeeded, `LastFillupRecord` is built
   from the fresh response. If upstream failed, the fallback to
   `resolveOfflineLastFillup` (cache + queue) is `browser`-gated
   (`+page.ts:51`) — during SSR there is no fallback and `lastFuelup`
   resolves to `null`, which is why the strip can flash empty on a cold
   SSR load.
3. Cache reads pass through `parseDateForCache` (fast or slow path).
4. Queue entries are typed `FuelSubmissionInput` with ISO date — no
   parsing needed.

## Edge cases & invariants

- **`status === 'failed'` queue entries are excluded.** Failed offline
  submissions don't represent a real recorded fillup.
- **Tie-break on identical dates favors the most recently enqueued.**
  Enqueue order is the only reliable signal at day-resolution. The
  asymmetry: the cache candidate is stamped `tiebreak: 0`, while queue
  candidates use their `enqueuedAt` timestamp, and the sort is `b.ts - a.ts
|| b.tiebreak - a.tiebreak`. Consequence: on an identical date a queued
  row always beats the upstream cache snapshot, since any real
  `enqueuedAt` is greater than `0`.
- **SSR safe.** `typeof localStorage === 'undefined'` returns null from
  `readCacheCandidate` and from `loadServerInfo`.
- **Empty server-info cache + legacy entry = ~200ms strip flicker.** The
  legacy entry parses to null → cache miss → upstream fetch repopulates.
  Acceptable; same outcome as strict-discard.
- **A corrupt queue entry is skipped, not fatal.** `readQueueCandidates`'s
  unit conversion (`toLiters`/`toGallons`) throws on a negative volume or an
  unrecognized `volumeUnit`; the caller (`+page.ts`) does not catch, so an
  uncaught throw would fail the whole offline resolve. The per-entry
  conversion is wrapped and skips (`continue`) that one entry instead —
  a bad row is dropped from consideration, not a crash.
