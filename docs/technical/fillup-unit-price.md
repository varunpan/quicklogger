# Fillup unit price (`/history`)

## Overview

Each `/history` fillup card shows a unit-price line beneath the volume·cost
line: the **actual** price per logged unit (always), and — when the row differs
from the LubeLogger instance basis — a **converted** price per gallon. The actual
and unit-only values are pure arithmetic from the row; the cross-currency
converted value is rendered from a small snapshot persisted onto the row at sync
time, so `/history` stays fully offline.

## Files touched

- `src/lib/client/unit-price.ts` — pure `unitPriceDisplay()` formatter.
- `src/routes/history/+page.svelte` — reads instance currency, renders the line.
- `src/lib/client/idb.ts` — `ConvertedSnapshot` + `QueueEntry.converted` + write params.
- `src/lib/client/sync-queue.ts` / `src/routes/+page.svelte` — the two snapshot write sites.
- `src/lib/shared/units.ts` — shared `toGallons` (used for the per-gallon basis).

## Data model

One optional field on the existing `pendingSubmissions` row — no IDB version bump
(IndexedDB is schemaless on values):

```ts
interface ConvertedSnapshot { cost: number; currency: string }
// QueueEntry.converted?: ConvertedSnapshot
```

- `cost` — converted total in instance currency (server `submitted.cost`).
- `currency` — instance currency at sync time.
- Gallons is **not** stored — re-derived via `toGallons(input.volume, input.volumeUnit)`.
  Converted unit price = `converted.cost / toGallons(...)`.

## Lifecycle / control flow

1. **Submit (online).** `+page.svelte` POSTs, then
   `q.enqueue(input, 'synced', { cost: submitted.cost, currency: TARGET_CURRENCY })`.
   `TARGET_CURRENCY` is the instance currency read on the page.
2. **Submit (offline).** `q.enqueue(input)` as `'queued'` — no snapshot yet.
3. **Replay (service worker).** `sync-queue.ts` POSTs each queued row; on 2xx it
   parses `submitted.cost` from the body and `q.markSynced(id, { cost, currency })`.
4. **Render.** `/history` reads `effectiveCurrencyCode()` (page context), calls
   `unitPriceDisplay(entry.input, entry.converted, instanceCurrency)`.

## Edge cases & invariants

| Case | Behaviour |
|---|---|
| Logged in instance basis (e.g. USD·gal on a USD instance) | Actual only; single `$x/gal`. |
| Currency matches, unit differs (USD·L on USD) | Converted half from pure math; **no** `≈`. |
| Currency differs, snapshot present (CAD·L on USD) | `CA$x/L · ≈ $y/gal`. |
| Currency differs, snapshot absent (queued, pre-sync) | Actual only; converted half appears once synced. |
| `submitted.cost` missing/invalid in replay body | Row still `'synced'`; converted half stays absent (no throw). |
| `volume <= 0` | `formatCost` returns `''` (finite guard); unit price reads as `/unit`. Not reachable from the form (volume > 0 enforced). |

## Non-obvious decisions

1. **Snapshot, not live FX (approach B).** The converted total is what the
   server already computed at submit time; persisting it keeps `/history`
   offline and uses the **fillup-day** rate, not today's.
2. **Converted unit is the `'gal'` constant, not config.** The instance unit is
   never sent to the client and the server only supports `gallons_us`; the whole
   app already assumes gallons. This feature matches that assumption.
3. **`≈` marks a currency conversion only.** Unit-only conversions are exact, so
   they render without `≈`.

## Known limitation — offline-replay currency (issue #57)

The two write sites resolve the snapshot currency differently:

- **Online** (`+page.svelte`, runs on the page): reads the real instance
  currency from `localStorage` (`TARGET_CURRENCY` / `effectiveCurrencyCode()`).
- **Offline replay** (`sync-queue.ts`, runs in the **service worker**): the SW
  has no `localStorage`, so `loadServerInfo()` returns `null` and the currency
  falls back to `'USD'`.

Correct for the current USD instance; for a non-USD instance an offline-then-
replayed cross-currency fillup would be mis-labelled. The fix — carry the
instance currency in the `/api/fuelup` response body — is tracked in
[#57](https://github.com/varunpan/quicklogger/issues/57).

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — `QueueEntry` + `Queue` API + `/api/fuelup`.
- [`offline-queue.md`](./offline-queue.md) — replay path / snapshot write.
- [`history-page.md`](./history-page.md) — the page render.
- [`fx-chain.md`](./fx-chain.md) — the server-side conversion this snapshot captures.
