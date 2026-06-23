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
   `q.enqueue(input, 'synced', { cost: submitted.cost, currency: submitted.currency })`.
   Both halves come from the response body — the page does not read its own
   instance-currency copy for the snapshot.
2. **Submit (offline).** `q.enqueue(input)` as `'queued'` — no snapshot yet.
3. **Replay (service worker).** `sync-queue.ts` POSTs each queued row; on 2xx it
   parses `submitted.cost` and `submitted.currency` from the body and
   `q.markSynced(id, { cost, currency })`. The currency comes from the response
   because the SW has no `localStorage` (issue #57); both fields are required or
   no snapshot is saved.
4. **Render.** `/history` reads `effectiveCurrencyCode()` (page context), calls
   `unitPriceDisplay(entry.input, entry.converted, instanceCurrency)`.

## Edge cases & invariants

| Case | Behaviour |
|---|---|
| Logged in instance basis (e.g. USD·gal on a USD instance) | Actual only; single `$x/gal`. |
| Currency matches, unit differs (USD·L on USD) | Converted half from pure math; **no** `≈`. |
| Currency differs, snapshot present (CAD·L on USD) | `CA$x/L · ≈ $y/gal`. |
| Currency differs, snapshot absent (queued, pre-sync) | Actual only; converted half appears once synced. |
| `submitted.cost`/`currency` missing/invalid in replay body | Row still `'synced'`; converted half stays absent (no throw — both fields required). |
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
4. **Currency is server-authoritative (issue #57).** Both write sites take the
   instance currency from the `/api/fuelup` response (`submitted.currency`), not
   from client config. The replay loop runs in the **service worker**, which has
   no `localStorage`, so carrying the currency in the response body is the only
   SW-safe source; the online path uses the same field for symmetry. (Earlier the
   offline path fell back to `'USD'` via `loadServerInfo()` — correct only on a
   USD instance.)

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — `QueueEntry` + `Queue` API + `/api/fuelup`.
- [`offline-queue.md`](./offline-queue.md) — replay path / snapshot write.
- [`history-page.md`](./history-page.md) — the page render.
- [`fx-chain.md`](./fx-chain.md) — the server-side conversion this snapshot captures.
