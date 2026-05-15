# Vehicle identifiers — internals

## Overview

Tap-to-copy card on `/maintenance` showing the active vehicle's
license plate and VIN. Pulls both from `/api/vehicles`. User guide:
[`docs/user/app-pages.md`](../user/app-pages.md). Where it sits in
the bigger picture: see the `/maintenance` section of
[`docs/architecture.md`](../architecture.md).

## Files touched

- [`src/lib/server/vehicle-identifiers.ts`](../../src/lib/server/vehicle-identifiers.ts) —
  pure module: `extractVin` (extracts VIN from `extraFields[]`),
  `normalizeVehicleIdentifiers` (hoists VIN to a top-level `vin`
  field). Unit-tested in `vehicle-identifiers.test.ts`.
- [`src/lib/server/lubelogger.ts`](../../src/lib/server/lubelogger.ts) —
  `Vehicle` interface gains optional `licensePlate?: string` and
  `vin?: string` fields. Open-ended index signature preserved.
- [`src/routes/api/vehicles/+server.ts`](../../src/routes/api/vehicles/+server.ts) —
  applies `normalizeVehicleIdentifiers` inside the 5-minute TtlCache
  loader so cached payloads are shape-correct (cache hits cost zero
  extraction work).
- [`src/lib/client/VehicleIdentifiersCard.svelte`](../../src/lib/client/VehicleIdentifiersCard.svelte) —
  the UI component. Two `<button>` rows, one per present field. Calls
  `navigator.clipboard.writeText` and flashes `Copied ✓` for 1500 ms.
- [`src/routes/maintenance/+page.svelte`](../../src/routes/maintenance/+page.svelte) —
  mounts the card between the picker `<a>` and the error / reminders
  blocks. Guards `licensePlate` and `vin` with `typeof === 'string'`
  to satisfy the open-ended `Vehicle` index signature.

## Data model

Wire-additive only. `/api/vehicles` adds an optional top-level
`vin?: string` to each vehicle when extractable; `licensePlate`
remains exactly as upstream emits it. No client storage, no IDB,
no prefs.

```ts
// src/lib/server/lubelogger.ts
export interface Vehicle {
  id: number;
  year?: number;
  make?: string;
  model?: string;
  licensePlate?: string;
  vin?: string;
  [key: string]: unknown;
}
```

```ts
// src/lib/server/vehicle-identifiers.ts
export function extractVin(v: Vehicle): string | undefined;
export function normalizeVehicleIdentifiers(v: Vehicle): Vehicle;
```

Component surface:

```ts
interface Props {
  licensePlate?: string;
  vin?: string;
}
```

## Lifecycle / control flow

1. `/maintenance` `+page.ts` calls `listVehicles(fetch)`, which hits
   `/api/vehicles`.
2. The server route checks the 5-minute TtlCache. On a miss it calls
   `client.listVehicles()`, then maps each vehicle through
   `normalizeVehicleIdentifiers`. On a hit it returns the cached
   already-normalized array.
3. The resolved `data.vehicle` reaches the page component. The page
   passes `data.vehicle.licensePlate` and `data.vehicle.vin` to
   `<VehicleIdentifiersCard>` after a runtime `typeof === 'string'`
   guard.
4. The component computes `plateValue` / `vinValue` via `$derived`,
   trimming each. If both are empty, `showCard` is `false` and the
   wrapper `<div>` isn't rendered — the maintenance page visually
   reverts to picker → reminders.
5. User taps a row → `copy(field, value)` runs:
   `navigator.clipboard.writeText(value)` →
   `copiedField = field` → 1500 ms `setTimeout` resets
   `copiedField` to `null`.
6. While `copiedField === field`, that row's label swaps from
   `Plate` / `VIN` to `Copied ✓` and the trailing icon hides. The
   value text stays visible the whole time.
7. Tapping a different row while a flash is active resets the timer
   and switches `copiedField`, so only one row ever shows `Copied ✓`
   simultaneously.

## Edge cases & invariants

| Scenario | Behaviour | Why |
| --- | --- | --- |
| LubeLogger returns `licensePlate: ""` | Plate row hidden | Trim-then-truthy at the render boundary |
| `extraFields` missing entirely | VIN undefined, row hidden | `Array.isArray(v.extraFields) ? ... : []` |
| `extraFields` contains a `VIN` row with empty value | VIN undefined, row hidden | Extractor trims and rejects empties |
| Two `VIN` rows in `extraFields` | First non-empty wins | Defensive — upstream shouldn't emit this, but if it does, pick a deterministic answer |
| `VIN` name in mixed case (`Vin`, `vin`, `  VIN  `) | Still matches | `trim().toLowerCase() === 'vin'` |
| Non-string `name` or `value` in `extraFields` | Row skipped, no throws | Defensive against upstream type drift |
| Both plate and VIN empty | Component returns nothing (no wrapper) | `{#if showCard}` gate; layout reverts to picker → reminders |
| Clipboard write rejected (insecure context, denied permission) | Silent fallback, no flash | `try/catch` around `writeText`; iOS Safari long-press select-and-copy still works because no `user-select: none` |
| User taps plate, then VIN within 1.5 s | Plate flash ends immediately, VIN flash starts | Single `copiedField` state + timer reset |
| User navigates away mid-flash | No cleanup needed | Page unmount destroys the component; timer ref is GC'd |
| Cached `/api/vehicles` payload | Already normalized | Normalizer runs inside the TtlCache loader, not after |
| Vehicle has VIN but not plate (or vice versa) | Only the present row renders | Per-row `{#if plateValue}` / `{#if vinValue}` gates |
| Very long VIN / vanity plate | Truncates with ellipsis on narrow screens | `truncate` Tailwind class; long-press still selects full text |

## Non-obvious decisions

**Normalize on the server, not in the client component.** The component
could `.find(f => f.name === 'VIN')` itself. Centralizing the hoist on
the server means: (a) the wire shape is the contract for any future
consumer, not just this card; (b) the same logic doesn't need to be
re-implemented if a future surface wants the VIN; (c) the
case-insensitive / trimmed / defensive-against-type-drift behavior is
testable as a pure function rather than a Svelte component side-effect.

**`{ ...v, vin }` only when `vin` is defined.** A naïve
`{ ...v, vin: extractVin(v) }` would add a `vin: undefined` key, which
`JSON.stringify` then drops anyway — but the in-memory shape would
diverge from the wire shape and confuse anyone inspecting cached
payloads. Returning the original object reference when there's no VIN
keeps the cache cheap and the runtime shape honest.

**Component uses `<button>` semantics, not a `<div onclick>`.**
Keyboard support (Enter / Space) and screen-reader role both come for
free. The picker above renders as an `<a>` because tapping navigates;
this card's rows do not navigate, so they should not announce as
links.

**Trailing icon hides during the flash; value stays.** Spec calls out
that the value text must stay visible the whole time so the user can
verify what just hit the clipboard. Hiding only the icon (not the
whole row) keeps that promise. Layout shift is avoided on the value's
left edge because the value `<span>` is `flex-1` — when the icon
disappears, the value expands rightward into the freed space rather
than the label / value jumping.

**Render-boundary trim, not extractor-only trim.** The extractor
already trims, but `licensePlate` arrives directly from upstream
without normalization (we deliberately don't rewrite plates). Doing a
second `trim()` at the render boundary keeps the missing-value rule
("whitespace-only counts as missing") uniform between plate and VIN
without coupling the client component to the server extractor's
contract.

**Stub `navigator.clipboard.writeText` in e2e, don't request the
permission.** WebKit headless restricts the Async Clipboard API even
with `permissions: ['clipboard-write']`. A `page.addInitScript` stub
that captures writes into a window-attached array is simpler,
deterministic across browsers, and proves the value being passed to
the clipboard — which is the behavior under test.

## Future considerations

- **Tap-to-copy on other surfaces.** The component is reusable —
  drop it into `/vehicles` or `/history` if those surfaces ever need
  plate / VIN affordance. Out of scope for v0.2.0.
- **Mask VIN behind tap-to-reveal.** This app runs on the user's
  homelab, so no privacy concern. Revisit if quicklogger ever runs
  multi-tenant.
- **Edit plate / VIN from quicklogger.** LubeLogger remains source of
  truth. Adding edit affordance would mean POST'ing back to the
  LubeLogger vehicle endpoint and reasoning about who wins on
  collision — out of scope.
- **Copy history / "last copied" indicator.** Considered, deferred.
  The current flash is enough signal for the parts-counter use case.
