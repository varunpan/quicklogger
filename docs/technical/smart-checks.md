# Smart checks — internals

## Overview

Catches logically-inconsistent or obviously-typo'd fillups before they POST
to `/api/fuelup`. Six pure checks (A, B, C, D, E, G) evaluated client-side
at submit time, gated by the `smartChecksEnabled` pref. User guide:
[`docs/user/smart-checks.md`](../user/smart-checks.md). Where it sits in
the bigger picture: see the `/` main-form section of
[`docs/architecture.md`](../architecture.md#---main-form).

## Files

- [`src/lib/client/smart-checks.ts`](../../src/lib/client/smart-checks.ts) —
  the pure module: `evaluateSmartChecks`, six per-check sub-functions, the
  `ODOMETER_MAX_DELTA_MI` constant (consumed by check E), and the formatting helpers
  (`formatOdo`, `formatShortDate`, `getToday`). Unit-tested in
  `smart-checks.test.ts`.
- [`src/lib/client/prefs.ts`](../../src/lib/client/prefs.ts) — adds
  `smartChecksEnabled: boolean` (default `true`) to `Prefs` /
  `DEFAULT_PREFS`. Migration is free via the existing spread-merge in
  `loadPrefs()`.
- [`src/routes/+page.svelte`](../../src/routes/+page.svelte) — submit-handler
  gate, consolidated amber chip rendering, Submit-disabled-while-chip-shown
  logic, clear-on-edit handlers on odometer/date/volume, and the
  `submitAnyway()` bypass. Also: the OCR-side `checkOdometerRelative`
  backwards-reading guard. (The OCR-side `> 2000` check that used to import
  and share `ODOMETER_MAX_DELTA_MI` was removed in #20b — that jump is now
  caught once, by smart-check E — so `+page.svelte` no longer imports the
  constant.)
- [`src/routes/settings/+page.svelte`](../../src/routes/settings/+page.svelte)
  — new "Smart checks" toggle card.

## Data model

Pure pref extension; no IDB, no localStorage key change, no server schema
change.

```ts
export interface Prefs {
  // ...existing fields...
  smartChecksEnabled: boolean; // default true
}
```

Helper module surface:

```ts
export type SmartCheckCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'G';

export interface SmartCheckIssue {
  code: SmartCheckCode;
  message: string;
}

export function evaluateSmartChecks(
  submission: SubmissionForCheck,
  lastFuelup: LastFuelupForCheck | null,
  prefs: Pick<Prefs, 'smartChecksEnabled'>,
  now?: Date
): { issues: SmartCheckIssue[] };
```

## Lifecycle / control flow

1. User taps the main **Log fillup** button → `submit()` runs with
   `skipSmartChecks = false` (default).
2. `submit()` builds the `FuelSubmissionInput`, derives the
   `LastFuelupForCheck` projection from `data.lastFuelup`
   (`M/D/YYYY` → `YYYY-MM-DD` via the local `lubeDateToIso` helper), and
   passes everything plus `{ smartChecksEnabled: prefs.smartChecksEnabled }`
   to `evaluateSmartChecks`.
3. If `result.issues.length > 0`, the function assigns
   `smartCheckIssues = result.issues` and returns early. The reactive
   template renders the amber chip and the main Submit button's
   `disabled={...|| smartCheckIssues.length > 0}` flips on.
4. If issues is empty, the existing POST → toast → queue path runs
   unchanged.
5. User edits **odometer**, **volume**, or **date** → the field's
   `oninput` calls `clearSmartCheckIssues()` which assigns `[]` (no-op
   when already empty). Next Submit tap re-evaluates.
6. User taps **[Submit anyway]** → `submitAnyway()` clears the chip and
   calls `submit(true)`, which skips the smart-check block and goes
   straight to POST.
7. On successful POST, the success-path cleanup explicitly resets
   `smartCheckIssues = []` alongside the field resets.

## Edge cases & invariants

| Scenario | Behaviour | Why |
| --- | --- | --- |
| `smartChecksEnabled === false` | Helper short-circuits to `{ issues: [] }`, chip never renders, Submit never gates | Master toggle is the only check before any per-check evaluation runs |
| `data.lastFuelup === null` | Checks A/B/C/E skip silently; D and G still run | Helper takes `LastFuelupForCheck \| null`; per-check sub-functions guarded by the caller |
| `data.lastFuelup.date` unparseable | `lubeDateToIso` returns `null`, `lastFuelupForCheck()` returns `null`, behaviour matches the no-last-fuelup case | Defensive against malformed upstream input |
| Multiple checks fire at once | Issues appear in canonical order A → B → C → D → E → G with a single `[Submit anyway]` button | Aggregator pushes in fixed order; user gets one decision, not N |
| Field cleared then re-typed | `oninput` fires on every keystroke; chip clears on first keystroke and stays cleared | Cheap idempotent assign — `clearSmartCheckIssues` no-ops on empty |
| User taps Submit, edits cost (not a tracked field), taps Submit | Chip persists across the cost edit; second Submit re-evaluates and either keeps or clears the chip based on current values | Per spec — only odometer/date/volume clear; cost has no smart check today |
| `submit(true)` POST 4xx → error toast | Error toast renders; chip stays cleared | Server-side error is a separate signal; smart-check chip is one-shot per submit attempt |
| `submit(true)` POST 5xx / network error → queue | Submission queues; chip stays cleared | Same |
| Check D, `submitted.date === today` | Does **not** fire | Strict `>` comparison per spec |
| Check E, `Δ = 2000` exact | Does **not** fire | Strict `>` per spec, threshold inclusive at zero side, exclusive at the upper |
| Check C, `\|Δ\| = 5` exact | Fires | `≤ 5` inclusive per spec |
| Check G, volume = exactly 0.5 gal / 2 L | Does **not** fire | Strict `<` per spec |
| Check G, volume < 1 (e.g. 0.49) | Suggests `volume * 10` | Leading zero before decimal → suggestion is signal |
| Check G, volume ≥ 1 but < floor (e.g. 1.99 L) | Omits "did you mean" suffix | No leading zero in the typed number → suggestion would mislead |
| Cost field edited | No chip clear, no smart-check re-run | Spec excludes cost from clear-on-edit |
| `prefs` snapshot taken at mount, settings toggled mid-session | New value picks up on next page navigation (loadPrefs re-runs) | Same pattern as `odometerPrefillEnabled` / `odometerIncrementMi` — locked by precedent |

## Non-obvious decisions

**`onclick={() => submit()}` not `onclick={submit}` on the main button.**
Svelte passes the `MouseEvent` as the first argument to a bare handler
reference. `submit` accepts an optional `skipSmartChecks: boolean = false`
first arg — a `MouseEvent` is truthy and would silently bypass the chip on
every click. The arrow-wrapper forces a zero-arg call. The `submitAnyway`
button can use the bare reference because `submitAnyway()` takes no
arguments.

**Chip clears via explicit `oninput`, not a `$effect` watching field
values.** Reactive `$effect` triggers on initialization too — the chip
would never appear because the very assignment of `smartCheckIssues`
would re-run the effect on the next microtask after a `bind:value`
round-trip from native input events that themselves trigger effects.
Explicit `oninput` is simpler, predictable, and matches the existing
`odometerEdited` pattern.

**LubeLogger `M/D/YYYY` is parsed inline, not via `format.ts`.** Existing
`format.ts` helpers render dates for display; smart-checks needs the
opposite direction (raw upstream date → ISO for lex compare). A four-line
regex helper inside `+page.svelte` is cheaper than expanding the format
module's surface. If a second caller needs the same conversion later,
promote it to `format.ts` then.

**Smart-checks owns `ODOMETER_MAX_DELTA_MI`, not `format.ts` or a new
constants module.** The constant is now meaningful only to smart-check E
(the `Δ > 2000` gate); keeping it next to its one consumer is the natural
home. Until #20b it was also imported by the OCR-confirm relative-range
check, which warned on the same threshold — a redundant double-warning.
That OCR-side too-high check was removed (the OCR-confirm step now only
flags a *backwards* reading), so the constant has a single consumer and
`+page.svelte` no longer imports it.

**Server side is intentionally untouched.** `/api/fuelup` continues to
enforce only the four required-and-positive invariants. Apple Shortcuts
and direct callers bypass smart checks by design — the Shortcut surface
already constructs valid payloads, and server-side smart-checks would
block legitimate scripted backfills of historical data (where "future
date" relative to ingest time is meaningless, and `Δ odometer > 2000` is
expected for the first row of a multi-year backfill).

**Helper takes `now?: Date` instead of reading `Date.now()` directly.**
Check D's "future date" semantics depend on the user's local clock day.
Real callers omit the arg and the helper falls back to `new Date()`. The
unit suite injects a fixed `Date` so check-D specs are deterministic
across CI time zones — no need to monkey-patch the global `Date`
constructor like `tests/e2e/fixtures.ts#pinClock` does for e2e.

## Future considerations

- **Check F (cost / volume ratio).** Deferred from v0.2.0 because it
  needs per-currency band tables or a market-aware design. Revisit when
  the FX chain is mature enough to ground "expected $/gal" by currency.
- **Per-check toggles in Settings.** Single master toggle for v0.2.0. If
  any one check turns noisy in real use, promote to individual switches.
- **User-tunable thresholds.** `ODOMETER_MAX_DELTA_MI`, the C duplicate
  band (5 mi), and the G volume floors (0.5 gal / 2 L) are all
  hardcoded. Promote to Prefs if real travel routinely hits the bands.
- **Reactive live warnings.** Chose submit-attempt-only to keep the
  form's typing-feel snappy. A live-warning mode would need debouncing
  and a quieter visual treatment.
- **Per-vehicle thresholds.** Single global setting for v0.2.0; a
  long-trip commuter vs daily-commuter knob is a separate feature.
