# History page — internals

The `/history` route shows a card list of every fillup logged through
this PWA, pulled from the local IndexedDB `pendingSubmissions` store.
This doc covers the page's lifecycle, data flow, and edge-case
handling. The IDB row shape, `Queue` API, and HTTP API surface live
in [`idb-and-api.md`](./idb-and-api.md).

## Overview

Read-only, client-side-only. The page never calls a server endpoint
itself; the only `fetch` happens inside the loader's `listVehicles`
call to populate the picker. All card content comes from
`Queue.list()` in `onMount`. User-facing copy:
[`docs/user/app-pages.md` § History](../user/app-pages.md#history-history).

## Files touched

- `src/routes/history/+page.ts` — vehicle resolution chain (URL → prefs → vehicles[0]).
- `src/routes/history/+page.svelte` — single-file page: state, derivation, render.
- `src/lib/client/format.ts` — `formatIsoDate(iso)` helper used for the card date line.
- `src/routes/vehicles/+page.svelte` — `RETURN_TO` allowlist entry so the picker round-trips back.

## Data model

No new types, no new IDB store, no new localStorage key. The page
reads existing `QueueEntry` rows from `pendingSubmissions`:

```ts
interface QueueEntry {
  id: number;
  input: FuelSubmissionInput;  // date, odometer, volume, cost, etc.
  status: 'queued' | 'failed' | 'synced';
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
}
```

Source of truth: `src/lib/client/idb.ts`. Field-by-field render map
lives in the spec
([`docs/superpowers/specs/2026-05-13-history-ui-redesign-design.md`](../superpowers/specs/2026-05-13-history-ui-redesign-design.md)
§ *Per-card content & formatting*).

Page-local state:

| Variable | Type | Role |
|---|---|---|
| `allEntries` | `QueueEntry[]` | Set once on mount from `Queue.list()`. |
| `loading` | `boolean` | True until `onMount` finishes. |
| `error` | `string \| null` | Set if `Queue.open()` or `Queue.list()` throws. |
| `visible` | `QueueEntry[]` (derived) | `allEntries` filtered by active vehicle + sorted. |
| `vehicleLabel` | `string` (derived) | Year/make/model joined for the picker card. |
| `emptyCopy` | `string` (derived) | Picks between two empty-state strings. |

## Lifecycle / control flow

1. **Loader (`+page.ts`)** runs SSR and CSR. Resolves
   `vehicle` via the URL→prefs→`vehicles[0]` chain (same shape as
   `/maintenance`).
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

| Scenario | Behaviour | Why |
| --- | --- | --- |
| Empty IDB | Empty-state string: "No fillups logged on this device yet." | Distinct from per-vehicle empty so the user knows there's nothing anywhere. |
| Rows exist but none for the active vehicle | "No fillups logged for this vehicle yet." | Distinct copy clarifies the picker is the lever, not the absence of data. |
| Same date, two rows | Both render; later `enqueuedAt` first. | Real case — two stops in one day. |
| `notes` is whitespace-only | "note:" line is suppressed. | `notes.trim().length > 0` guard. Avoids an empty `note:` line. |
| `tags` is `"costco,,shell"` | Renders `#costco` and `#shell`. | Inline split / trim / filter drops empties. |
| `status === 'failed'` but `attempts === 0` | Error line renders; attempts line doesn't. | The two are independent — `attempts > 0` gate is on the attempts line only. |
| Notes contain HTML tags | Rendered as literal text. | Svelte's `{}` escapes by default; no `{@html}` anywhere on this page. |
| IDB unavailable (private browsing, quota) | Rose notice; picker still tappable. | Page degrades gracefully — the picker doesn't depend on IDB. |
| Pre-v0.1.3 submissions | Don't appear. | They never landed in IDB — footer disclaimer sets expectation. |
| LubeLogger-direct submissions | Don't appear. | Same disclaimer. Merging with upstream `GasRecord[]` is an explicit non-goal. |
| Failed rows with no retry UI | The card surfaces `lastError` and `attempts`; user must dismiss via dev tools. | Retry / dismiss controls are an explicit out-of-scope follow-up. |

## Non-obvious decisions

1. **Single IDB read on mount, not per vehicle switch.** The picker
   round-trip causes a full page reload from SvelteKit's perspective
   (URL change with a `+page.ts` loader rerun), so the page mounts
   again and `onMount` reads IDB again. Within a single page life
   we keep `allEntries` and just re-derive `visible`. Reading on every
   `data.vehicle` change would be wasted work for the same store.
2. **`Date.UTC` for the sort key.** We split `YYYY-MM-DD` and feed
   integers into `Date.UTC`, not `new Date(iso)`. Reason: the constructor
   path applies the local timezone offset which would shift midnight
   boundaries during DST transitions. We only need ordering, not display,
   so UTC is the stable choice.
3. **Reuse `daysAgo` instead of writing a fresh relative-date helper.**
   `daysAgo` already takes `M/D/YYYY`; we synthesize that shape in
   `formatIsoDate` and reuse. One canonical definition of "today" /
   "yesterday" / "N days ago" across the app — the home-page strip,
   reminders countdown, and the new card date line all share it.
4. **No status badge for `synced`.** The mockup intentionally drops the
   badge for synced entries so the eye reaches the date and odometer
   first. The synced state is the default; only deviations are flagged.

## Locale-dynamic rendering

Cost and date strings render through [`format.ts`](./format.md), which reads
the cached LubeLogger locale. For the en-US/USD instance the rendered output
is byte-identical to the pre-branch behaviour. Non-en-US users see locale-
correct thousands separators, currency symbols / placement, and abbreviated
month names.

## Future considerations

- Retry / dismiss controls for `failed` entries (currently the only
  way out is dev tools).
- MPG / fuel-economy line — would require fill-to-full chain tracking
  and unit-aware computation. Out of scope for v0.1.4.
- Merging IDB rows with LubeLogger's `GasRecord[]` for a complete
  history view across devices and the web UI.
- Extracting the shared vehicle-row pattern into a component; today
  it's hand-duplicated between `/maintenance` and `/history`.
- Smarter relative wording — `"36 days ago"` → `"5 weeks ago"`,
  `"~6 months ago"`, `"over a year ago"`.

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — IDB store + `QueueEntry` shape.
- [`offline-queue.md`](./offline-queue.md) — how entries reach the store and what triggers status changes.
- [`maintenance-page.md`](./maintenance-page.md) — the page this one mirrors structurally.
