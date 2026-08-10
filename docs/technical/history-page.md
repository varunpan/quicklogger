# History page — internals

The `/history` route shows a card list of every fillup logged through
this PWA, pulled from the local IndexedDB `pendingSubmissions` store.
This doc covers the page's lifecycle, data flow, and edge-case
handling. The IDB row shape, `Queue` API, and HTTP API surface live
in [`idb-and-api.md`](./idb-and-api.md).

## Overview

Read-only, client-side-only. The page itself only fetches via the
loader's `listVehicles` call to populate the picker; the rendered
`<VehicleCard>` additionally loads the vehicle photo through
`GET /api/vehicle/image?vehicleId=N` (`$lib/client/VehicleImage.svelte`).
All card content comes from `Queue.list()` in `onMount`. User-facing copy:
[`docs/user/app-pages.md` § History](../user/app-pages.md#history-history).

## Files touched

- `src/routes/history/+page.ts` — vehicle resolution via the shared `resolveSelectedVehicle()` (`$lib/client/vehicle-resolve.ts`, URL → prefs → vehicles[0]); returns `{ vehicle, vehicles }`.
- `src/routes/history/+page.svelte` — single-file page: state, derivation, render.
- `src/lib/client/format.ts` — seven helpers: `formatIsoDate`, `formatOdometer`, `formatCost`, `effectiveCurrencyCode`, `effectiveVolumeUnit`, `effectiveDistanceUnit`, `parseIsoLocal` — used across the card date, odometer, and unit-price lines.
- `src/lib/client/unit-price.ts` — `unitPriceDisplay()`, the per-card unit-price line (see § _Locale-dynamic rendering_ and [`fillup-unit-price.md`](./fillup-unit-price.md)).
- `src/lib/client/VehicleCard.svelte` — the shared vehicle picker card rendered at the top of the page.
- `src/routes/vehicles/+page.svelte` — `RETURN_TO` allowlist entry so the picker round-trips back.

## Data model

No new types, no new IDB store, no new localStorage key. The page
reads existing `QueueEntry` rows from `pendingSubmissions`:

```ts
interface QueueEntry {
  id: number;
  input: FuelSubmissionInput; // date, odometer, volume, cost, etc.
  status: 'queued' | 'failed' | 'synced';
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
  converted?: ConvertedSnapshot; // converted-cost snapshot, see fillup-unit-price.md
}
```

Source of truth: `src/lib/client/idb.ts`. Field-by-field render map
lives in the spec
([`docs/superpowers/specs/2026-05-13-history-ui-redesign-design.md`](../superpowers/specs/2026-05-13-history-ui-redesign-design.md)
§ _Per-card content & formatting_).

Page-local state:

| Variable           | Type                     | Role                                                                                                                           |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `instanceCurrency` | `string`                 | Read once via `effectiveCurrencyCode()`; feeds the unit-price line's conversion comparison.                                    |
| `instanceUnit`     | `'gal' \| 'L'`           | Read once via `effectiveVolumeUnit()`; passed into `unitPriceDisplay()`.                                                       |
| `distUnit`         | `'mi' \| 'km'`           | Read once via `effectiveDistanceUnit()`; suffixes the odometer line.                                                           |
| `allEntries`       | `QueueEntry[]`           | Set once on mount from `Queue.list()`.                                                                                         |
| `loading`          | `boolean`                | True until `onMount` finishes.                                                                                                 |
| `error`            | `string \| null`         | Set if `Queue.open()` or `Queue.list()` throws.                                                                                |
| `visible`          | `QueueEntry[]` (derived) | `allEntries` filtered by active vehicle + sorted.                                                                              |
| (picker card)      | —                        | Rendered by the shared `<VehicleCard>` (`$lib/client/VehicleCard.svelte`), which labels via `vehicleLabel()` from `format.ts`. |
| `emptyCopy`        | `string` (derived)       | Picks between two empty-state strings.                                                                                         |

## Lifecycle / control flow

1. **Loader (`+page.ts`)** runs SSR and CSR. Resolves
   `vehicle` via the shared `resolveSelectedVehicle()` helper
   (URL→prefs→`vehicles[0]` chain, same helper as `/maintenance`
   and `/stats`).
2. **Component mount.** `onMount` opens IDB, reads the full store
   into `allEntries`, flips `loading` to `false`. Errors during
   open or list set `error` and the page renders the rose notice.
3. **Reactive derivation.** `visible` re-runs whenever `data.vehicle`
   or `allEntries` changes — sufficient for the picker round-trip
   (URL change → new loader run → new `data.vehicle` → re-derive).
4. **No teardown.** The page does not subscribe to IDB events or
   poll. Switching vehicles re-uses the in-memory `allEntries` array;
   only a hard reload (or the picker round-trip URL change) refreshes
   the IDB read.

## Edge cases & invariants

| Scenario                                    | Behaviour                                                                                                                     | Why                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty IDB                                   | Empty-state string: "No fillups logged on this device yet."                                                                   | Distinct from per-vehicle empty so the user knows there's nothing anywhere.                                                                                                                                                                                                                                                   |
| Rows exist but none for the active vehicle  | "No fillups logged for this vehicle yet."                                                                                     | Distinct copy clarifies the picker is the lever, not the absence of data.                                                                                                                                                                                                                                                     |
| Same date, two rows                         | Both render; later `enqueuedAt` first.                                                                                        | Real case — two stops in one day.                                                                                                                                                                                                                                                                                             |
| `notes` is whitespace-only                  | "note:" line is suppressed.                                                                                                   | `notes.trim().length > 0` guard. Avoids an empty `note:` line.                                                                                                                                                                                                                                                                |
| `tags` is `"costco,,shell"`                 | Renders `#costco` and `#shell`.                                                                                               | Inline split / trim / filter drops empties.                                                                                                                                                                                                                                                                                   |
| `entry.input.isFillToFull === true`         | Card shows a "Fill-to-full" line.                                                                                             | Echoes the toggle set on the log-fuel form (`+page.svelte:1141-1150`); no other page renders it.                                                                                                                                                                                                                              |
| `entry.input.missedFuelup === true`         | Card shows a "Missed fillup" line.                                                                                            | Echoes the toggle set on the log-fuel form (`+page.svelte:1151-1161`); no other page renders it.                                                                                                                                                                                                                              |
| `status === 'failed'` but `attempts === 0`  | Error line renders; attempts line doesn't.                                                                                    | The two are independent — `attempts > 0` gate is on the attempts line only.                                                                                                                                                                                                                                                   |
| Notes contain HTML tags                     | Rendered as literal text.                                                                                                     | Svelte's `{}` escapes by default; no `{@html}` anywhere on this page.                                                                                                                                                                                                                                                         |
| IDB unavailable (private browsing, quota)   | Rose notice; picker still tappable.                                                                                           | Page degrades gracefully — the picker doesn't depend on IDB.                                                                                                                                                                                                                                                                  |
| More synced fill-ups than the retention cap | Only the newest `historyKeepPerVehicle` (Settings → "Fill-ups kept per vehicle", default 200) synced rows per vehicle remain. | The queue drain ends with `pruneSynced(keep)` — synced rows (and their converted-cost snapshots) older than the cap are deleted from the device. Was a hardcoded 5 before v0.3.1, which silently capped History. `'queued'`/`'failed'` rows are never pruned. See [`offline-queue.md` § Pruning](./offline-queue.md#pruning). |
| Pre-v0.1.3 submissions                      | Don't appear.                                                                                                                 | They never landed in IDB — footer disclaimer sets expectation.                                                                                                                                                                                                                                                                |
| LubeLogger-direct submissions               | Don't appear.                                                                                                                 | Same disclaimer. Merging with upstream `GasRecord[]` is an explicit non-goal.                                                                                                                                                                                                                                                 |
| Failed rows with no retry UI                | The card surfaces `lastError` and `attempts`; user must dismiss via dev tools.                                                | Retry / dismiss controls are an explicit out-of-scope follow-up.                                                                                                                                                                                                                                                              |
| Cross-currency row, not yet synced          | Actual unit price only; converted half appears after sync.                                                                    | The snapshot is written at sync time; a queued row has none yet.                                                                                                                                                                                                                                                              |

## Non-obvious decisions

1. **Single IDB read on mount, not per vehicle switch.** The picker
   round-trip causes a full page reload from SvelteKit's perspective
   (URL change with a `+page.ts` loader rerun), so the page mounts
   again and `onMount` reads IDB again. Within a single page life
   we keep `allEntries` and just re-derive `visible`. Reading on every
   `data.vehicle` change would be wasted work for the same store.
2. **`parseIsoLocal` for the sort key, not `new Date(iso)`.** `dateKey`
   runs the `YYYY-MM-DD` string through the shared `parseIsoLocal()`
   helper — the local-midnight `new Date(y, m - 1, d)` constructor path —
   and takes `.getTime()`. Local-midnight ms order calendar dates
   identically to UTC ms, and we only need ordering, not absolute
   display, so reusing the app's one strict date parser wins over a
   bespoke sort key. Unparseable input collapses to `0` and sorts oldest.
3. **Reuse `daysAgo` instead of writing a fresh relative-date helper.**
   `daysAgo` takes the strict `YYYY-MM-DD` string (parsed via
   `parseIsoLocal`), so `formatIsoDate` passes the ISO date straight
   through. One canonical definition of "today" / "yesterday" /
   "N days ago" across the app — the home-page strip
   (`formatLastFillupDate`) and the card date line share it.
4. **No status badge for `synced`.** The mockup intentionally drops the
   badge for synced entries so the eye reaches the date and odometer
   first. The synced state is the default; only deviations are flagged.

## Locale-dynamic rendering

Cost and date strings render through [`format.ts`](./format.md), which reads
the cached LubeLogger locale. For the en-US/USD instance the rendered output
is byte-identical to the pre-branch behaviour. Non-en-US users see locale-
correct thousands separators, currency symbols / placement, and abbreviated
month names.

Three instance consts are resolved once at module top —
`effectiveCurrencyCode()`, `effectiveVolumeUnit()`, and
`effectiveDistanceUnit()` (`+page.svelte:21-23`, `instanceCurrency` /
`instanceUnit` / `distUnit`). The odometer line appends the instance
distance unit — `` `${formatOdometer(String(entry.input.odometer))}
${distUnit}` `` (`:116`) — same instance-unit source as the log page's
`DIST_UNIT`, maintenance's due-distance lines, and stats' odometer line
(#69). The unit-price line (`unitPriceDisplay()`, `$lib/client/unit-price.ts`)
compares each entry's own volume unit and currency against
`instanceUnit` / `instanceCurrency` to decide whether a converted half
renders alongside the actual figure.

## Future considerations

- Retry / dismiss controls for `failed` entries (currently the only
  way out is dev tools).
- Per-card fuel-economy line — the home page now computes a unit-aware
  last-fill delta (MPG on a `mi`+`gal` instance, L/100km on a `km`+`L`
  instance; mixed unit combos hide the figure), but History itself still
  has no per-card figure — that would need fill-to-full chain tracking
  across cards, not yet implemented.
- Merging IDB rows with LubeLogger's `GasRecord[]` for a complete
  history view across devices and the web UI.
- Smarter relative wording — `"36 days ago"` → `"5 weeks ago"`,
  `"~6 months ago"`, `"over a year ago"`.

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — IDB store + `QueueEntry` shape.
- [`offline-queue.md`](./offline-queue.md) — how entries reach the store and what triggers status changes.
- [`maintenance-page.md`](./maintenance-page.md) — the page this one mirrors structurally.
- [`fillup-unit-price.md`](./fillup-unit-price.md) — the unit-price line, snapshot, and conditional rule.
