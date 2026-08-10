# Odometer prefill & last-fillup strip — internals

## Overview

Pre-fills the odometer field with the previous reading and renders a one-tap
`+N mi` chip beneath it, plus a two-line snapshot strip above the form. User
guide: [`docs/user/odometer-prefill.md`](../user/odometer-prefill.md). Where it
sits in the bigger picture: see the `/` page section in
[`docs/architecture.md`](../architecture.md#--main-form).

## Files

- [`src/lib/client/format.ts`](../../src/lib/client/format.ts) — pure
  `formatOdometer` (thousands-separator render), `daysAgo` (calendar-day
  diff against local clock), and `formatLastFillupDate` (combined
  `Mon D, YYYY (N days ago)` for the strip). Unit-tested in
  `format.test.ts`.
- [`src/lib/client/prefs.ts`](../../src/lib/client/prefs.ts) — adds the two
  new prefs to `Prefs` and `DEFAULT_PREFS`. Migration is free via the
  existing spread-merge in `loadPrefs()`.
- [`src/routes/+page.svelte`](../../src/routes/+page.svelte) — strip block,
  `initialOdometer()`, `bumpOdometer()`, `odometerEdited` state, the
  `prefilled` pill, the chip, and the `odometerDelta` helper text.
- [`src/routes/settings/+page.svelte`](../../src/routes/settings/+page.svelte)
  — new "Odometer prefill" card: on/off toggle and clamped numeric input for
  the increment.

## Data model

`Prefs` gains two fields, both with safe defaults:

```ts
odometerPrefillEnabled: boolean; // default true
odometerIncrementMi: number; // default 300
```

No backend, no schema, no explicit migration. `loadPrefs()` returns
`{ ...DEFAULT_PREFS, ...parsed }`, so an existing localStorage entry written
before v0.1.3 picks up the new defaults the next time the page loads. Users
upgrading in-place see the feature on with a 300 mi chip on first open.

## Lifecycle

1. `+page.ts` `load` picks the active vehicle via the shared
   `resolveSelectedVehicle` (`$lib/client/vehicle-resolve`) — the same
   `?vehicleId=` → `prefs.lastVehicleId` → `vehicles[0]` chain `/history`,
   `/maintenance` and `/stats` use — then fetches that vehicle's last
   fillup and returns it as `data.lastFuelup`, a snapshot taken at the
   server-side load, never mutated client-side.
2. `+page.svelte` calls `loadPrefs()` once at mount; `prefs` is a plain
   constant from then on (not reactive).
3. `odometer` is initialized via `initialOdometer()`:
   - returns `''` when prefill is off, or when `data.lastFuelup` is absent,
     or when the parsed reading isn't finite;
   - otherwise returns `String(Math.round(Number(...)))` — raw digits so the
     `type="number"` input accepts them without complaint.

   The input's `placeholder` comes from the sibling `placeholderOdometer()`:
   the last reading's rounded digits, or the literal `No last fuel up` when
   `data.lastFuelup` is absent — so an empty field still says what the
   baseline is (or that there isn't one).

4. `odometerEdited` starts `false`. It flips to `true` on the input's
   `oninput` handler **or** when `bumpOdometer()` runs (chip tap).
5. `odometerDelta` is `$derived.by(...)`: returns `null` until
   `odometerEdited` is true and `data.lastFuelup` exists, then renders
   `current - last` (signed).
6. After a successful submit, `odometer = initialOdometer()` and
   `odometerEdited = false` run first (on the still-live component), then
   the success path navigates away via
   `goto('/maintenance?vehicleId=…')`. Returning to `/` re-runs the
   loader, so the strip and prefill pick up the just-submitted fillup on
   the next visit.

`data.lastFuelup` snapshot semantics are documented in the strip paragraph
of `docs/architecture.md` — they apply equally to the field prefill.

## Edge cases & invariants

| Scenario                                | Behaviour                                                      | Why                                                                                                                                                      |
| --------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `odometerIncrementMi === 0`             | Chip hidden, prefill still applies                             | `0`-as-disable matches the user-guide contract; hides the chip without affecting prefill                                                                 |
| No last fillup (`data.lastFuelup` null) | Strip hidden, field empty; chip still renders                  | Chip is gated only on `odometerPrefillEnabled && odometerIncrementMi > 0`, not on the snapshot — tapping it on the empty field yields the bare increment |
| `odometerPrefillEnabled === false`      | Strip still shows (independent), field empty, chip hidden      | Strip is informational and orthogonal to the prefill toggle                                                                                              |
| Empty field + chip tap                  | Field becomes the increment value                              | `Number('' \|\| 0) = 0`; `0 + 300 = 300`. Edge but harmless                                                                                              |
| Multi-tap chip                          | Each tap stacks (`+300, +600, +900, …`)                        | Operates on the _current_ field value, not on a one-shot baseline                                                                                        |
| Manual edit then chip                   | Chip adds to the typed value                                   | Same code path; the chip never re-reads the snapshot                                                                                                     |
| Submit with prefill                     | Field resets re-run, then the app navigates to `/maintenance`  | The form isn't visible post-submit; coming back to `/` re-runs the loader                                                                                |
| Non-finite parse (`Number('abc')`)      | `formatOdometer` returns the raw string                        | Better than rendering `NaN`                                                                                                                              |
| `daysAgo` against today                 | Returns `'today'`; `1` → `'yesterday'`; otherwise `N days ago` | Diff is local-calendar-day, not UTC                                                                                                                      |

## Non-obvious decisions

**Field is `type="number"`; strip uses `formatOdometer`.** The input can't
render thousands separators (HTML `<input type="number">` strips them),
so the field shows `87234` while the strip shows `87,234`. Asymmetric on
purpose — `type="number"` gets the numeric keypad on iOS, which matters
more at the pump than visual polish. The same digits land in the
submission either way.

**Prefill = "last reading only", never "last + offset".** The chip is the
explicit `+offset` action. Auto-adding the offset on load would surprise
the user ("did I tap something already?") and remove the most useful
escape hatch for the long-trip case (where they'd have to subtract back
out). Field starts at the truth (the last reading); the user opts into
the bump. Locked decision 2.

**Helper text only after edit.** Pre-edit, the field _is_ the prefill;
showing "0 mi this tank" would be noise. Post-edit, the delta is
informative. Same affordance the form already uses for the live MPG
preview — only renders when there's something to say.

**No optimistic update of the strip post-submit.** `data.lastFuelup`
stays as the page-load snapshot for the lifetime of the page. A
successful submit resets the form fields and then immediately navigates
to `/maintenance?vehicleId=…`, so there is no post-submit moment where
the strip is glanced at stale. Returning to `/` re-runs the loader and
the strip renders the just-submitted fillup. Mutating the snapshot
client-side to save that loader round-trip isn't worth the staleness
risk, and the at-pump flow doesn't need it.

**Odometer cell is a `<div>`, not a `<label>`.** Other form cells wrap
their input in `<label class="field">`, but the odometer cell now
contains an input _plus_ the chip button _plus_ a helper line. Wrapping
all three in a `<label>` would route taps on the chip into focus on the
input. The cell switches to `<div>` and label-tap-to-focus is preserved
explicitly via `<label for="odometer">` + `<input id="odometer">`.

**Increment input clamping.** `updateIncrement()` in
`settings/+page.svelte` coerces via `Number(value)` then `Math.floor` and
`>= 0`, falling back to `0` on any non-finite or negative value. The
field accepts `min="0"` `step="1"` in HTML, but those are advisory —
clamping in the handler is what actually keeps localStorage clean.

**`GasRecord` keys are camelCase to match the upstream contract.**
LubeLogger returns gas records as JSON with camelCase keys
(`fuelConsumed`, `isFillToFull`, `missedFuelUp`). Earlier versions of this
type used lowercase (`fuelconsumed`, etc.) which silently produced
`undefined` reads against real data — the strip rendered ` Gal` (no
number) until v0.1.3 UAT caught it. Mocks at `tests/e2e/fixtures.ts`,
`src/lib/server/lubelogger.test.ts`, and `tests/integration/api-*.test.ts`
must mirror the real shape so the test suite actually catches contract
drift. The asymmetric write path (`AddGasRecordPayload` stays lowercase
because LubeLogger's POST is case-insensitive on form-data) is documented
in [`docs/technical/idb-and-api.md`](./idb-and-api.md) § _LubeLogger
upstream calls_.

**Strip date locale is instance-driven, not browser-driven.**
`formatLastFillupDate` calls `toLocaleDateString(effectiveLocale(), {
month: 'short', day: 'numeric', year: 'numeric' })`, where
`effectiveLocale()` is `loadServerInfo()?.locale ?? 'en-US'` — the cached
LubeLogger instance locale with an `en-US` fallback. The strip therefore
matches the instance's own date rendering (an en-GB instance shows `5 May
2026`, en-US shows `May 5, 2026`) instead of silently changing shape with
each browser's default locale, and stays deterministic when the
server-info cache is empty (SSR, first boot). The `formatLastFillupDate`
suite in `format.test.ts` asserts both halves: the en-US fallback output
and that seeding a cached locale (en-GB) changes the absolute-date shape.

## Future considerations

- **Per-vehicle increments.** Single global setting for v1; per-vehicle is
  meaningful (commuter vs road-trip vehicle) but a UX redesign for the
  Settings page. Deferred.
- **Toggle pills missing `aria-pressed`.** Pre-existing pattern gap across
  every toggle in the app, not specific to this feature. Worth a holistic
  a11y pass rather than a one-off fix.
- **`daysAgo` DST edge case.** The diff uses `(todayStart - then) / 86_400_000`
  rounded to the nearest integer. On year-spanning boundaries that cross a
  DST transition, the calendar-day count can drift by one. Acceptable for
  "days since last fill" copy; a `Temporal`-based diff would be the proper
  fix when `Temporal` ships everywhere.
- **Helper text shows `0 mi this tank` post-submit until next interaction.**
  After a successful submit the field re-prefills and `odometerEdited`
  resets to `false`, so the helper line clears. But if the user types
  before re-prefill (race), or after an external state restore, they can
  briefly see the zero-delta message. Cosmetic; the next keystroke
  resolves it.
