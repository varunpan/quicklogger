# Manual UAT checklist (v0.1.0)

Run after each release before tagging stable.

## Setup

- [ ] Latest tag pulled: `docker compose pull && docker compose up -d`
- [ ] Browser cache cleared on iPhone (or new device fresh install)
- [ ] LubeLogger has at least one test vehicle
- [ ] `LUBELOGGER_API_KEY` is set in your stack's `.env`

## Cert check

- [ ] Open the deployed URL on iPhone (Safari)
- [ ] Page loads with green padlock — no cert warnings
- [ ] (If using a private CA: confirm the root cert is trusted on the phone)

## PWA install

- [ ] Tap **Share** → **Add to Home Screen**
- [ ] Icon appears on home screen with "quicklog" label
- [ ] Tap icon: launches in standalone mode (no browser chrome)
- [ ] Status bar matches `#09090b` theme

## Happy-path submission

- [ ] App auto-selects last vehicle
- [ ] Enter odometer, volume in gallons, cost in USD, fill-to-full = on
- [ ] Tap "Log fillup"
- [ ] Toast shows "Logged: X.XX gal · $YY.YY"
- [ ] Verify the entry appears in LubeLogger UI within 5 seconds

## Unit / currency conversion

- [ ] Switch volume to L, enter 50
- [ ] Switch currency to CAD, enter 65
- [ ] Tap "Log fillup"
- [ ] Toast confirms ~13.2 gal · ~$47 USD
- [ ] LubeLogger record matches (US gal / USD)

## Offline + queue

- [ ] Enable airplane mode
- [ ] Submit a fillup → toast shows "Saved locally — will sync"
- [ ] Disable airplane mode
- [ ] Tap away and return to the app (focus event triggers sync)
- [ ] /history shows pending count drops to 0
- [ ] LubeLogger receives the entry

## Apple Shortcut — direct POST

- [ ] Run `quicklog-fuelup` shortcut from home screen
- [ ] Voice prompts complete (vehicle, volume, cost)
- [ ] Shortcut shows "Logged: X gal · $Y"
- [ ] LubeLogger receives the entry

## Apple Shortcut — URL deep link

- [ ] Run `quicklog-prefill` shortcut
- [ ] Browser opens the deployed URL with form pre-filled (`?vehicleId=...&volume=...`)
- [ ] Tap "Log fillup" → confirmation
- [ ] LubeLogger receives the entry

## FX outage / manual override

- [ ] On homelab, briefly block outbound TCP 443:
      `sudo iptables -I OUTPUT -p tcp --dport 443 -j REJECT`
      (or temporarily disable WAN at the router)
- [ ] Restart container: `docker compose restart quicklogger`
- [ ] Submit a CAD fillup
- [ ] Manual FX rate field becomes visible
- [ ] Enter `0.73`, submit → success
- [ ] Restore outbound:
      `sudo iptables -D OUTPUT -p tcp --dport 443 -j REJECT`

## Settings persistence

- [ ] Set default unit = L, currency = CAD
- [ ] Quit + relaunch app
- [ ] Form opens with L + CAD as defaults

## Odometer prefill + last-fillup strip (v0.1.3)

Run on a vehicle that has at least one previous fillup in LubeLogger.

### Strip

- [ ] Open `/`. Above the vehicle picker, two-line strip is visible:
      `Last fill: <comma-formatted miles> · <Mon D, YYYY> (<"today"|"yesterday"|"N days ago">)`
      `<volume> Gal · $<cost> · <notes if any>`.
- [ ] Date format reads `Mon D, YYYY` regardless of browser locale (en-US pin).
- [ ] Switch to a vehicle with **no** previous fillup. Strip is gone.

### Prefill

- [ ] On a vehicle with a previous fillup, open `/`. Odometer field shows the
      last reading as raw digits (no comma) in muted text. Small
      `PREFILLED` tag visible in the field's top-right corner.
- [ ] Type into the field. Text snaps to white, the tag disappears.
- [ ] Helper line under the field reads `+N mi this tank` where N is the
      delta from the last reading.

### `+N mi` chip

- [ ] Chip is visible below the odometer field, labelled with the increment
      from Settings (e.g. `+300 mi`).
- [ ] Tap once → field value increases by the increment, helper updates,
      muted style clears.
- [ ] Tap twice in succession → value increases by 2× the increment.
- [ ] After typing manually, tap chip → adds the increment to whatever was
      typed (not to the original prefill).

### Settings card

- [ ] `/settings` shows the new **Odometer prefill** card under Currency.
- [ ] Toggle Off → return to `/` → field is empty, chip is hidden, strip
      still shows.
- [ ] Toggle On, set increment to 0 → return to `/` → field is prefilled,
      chip is hidden.
- [ ] Toggle On, set increment to 250 → return to `/` → chip reads `+250 mi`
      and bumps by 250.

### Submit flow regression

- [ ] Submit a fillup successfully. Form resets — odometer re-prefills with
      the same prior value (snapshot from page-load), volume/cost reset.
- [ ] Submit a fillup with the chip-bumped value. LubeLogger receives the
      bumped value, not the original prefill.

### Real-phone (LAN preview)

- [ ] `npm run uat` — production-mirror server (`node --env-file=.env build`); it
      rebuilds until the precompressed `.gz`/`.br` companions are complete (works
      around a flaky precompress step), then smoke-tests before printing the URL.
- [ ] **(Alternative — true prod-mirror)** Instead of `npm run uat`, run the real
      production image: `docker compose -f compose.dev.yml up --build`. This runs
      the exact shipped artifact (not a `node build` preview). On `localhost` the
      service worker registers, so PWA/offline is testable in a desktop browser;
      for phone testing over HTTPS set the `TRAEFIK_*` + `ORIGIN` vars in `.env` —
      see [`deployment.md`](deployment.md) § *Dev prod-mirror compose*.
- [ ] Open `http://<LAN-IP>:5173` on iPhone Safari. Set `ORIGIN` in `.env` to this
      exact URL first (or use the container path above, which sets `ORIGIN` for you) —
      otherwise SvelteKit's CSRF guard 403s submits.
- [ ] Walk through Strip / Prefill / Chip / Settings card sections above on
      the phone.
- [ ] Tap-target sizes feel comfortable for one-handed use at the pump.

## Offline odometer prefill (v0.1.3)

Run on a vehicle that already has at least one fillup logged from this
device while online (so the local cache is populated).

### Setup — populate local data

- [ ] On a normal online session, submit one fillup successfully on the
      target vehicle. This writes both the upstream cache and a `'synced'`
      queue entry.

### Cache fallback (upstream down, cache populated)

- [ ] Take upstream offline (e.g., point dev `.env` `LUBELOGGER_URL`
      at an unreachable host, or pause the upstream container).
- [ ] Restart `quicklogger` so the page loader hits the broken upstream.
- [ ] Open `/`. Strip renders with the previously-cached values + small
      amber `offline copy` chip next to the days-ago text.
- [ ] Odometer field is prefilled with the last reading.
- [ ] `+N mi` chip increments work as normal.
- [ ] Submit a fillup — toast shows "Saved locally — will sync".

### Queue-derived fallback (upstream down, no cache)

- [ ] Clear `quicklogger.lastFuelup.<vehicleId>` from localStorage (DevTools
      → Application → Local Storage). Leave the `'synced'` queue entry
      from the prior submit intact.
- [ ] Reload `/`. Strip still renders (sourced from the queue entry).
- [ ] Cost is shown as `<currency> <amount>` (e.g. `CAD 60.00`), not
      `$<amount>`.

### Empty state (upstream down, nothing local)

- [ ] Clear both localStorage and IndexedDB.
- [ ] Reload `/`. Strip is hidden, field is empty (matches today's
      no-prior-fillup behaviour).

### Recovery (upstream returns)

- [ ] Restore upstream connectivity. Reload `/`. Strip renders without
      the `offline copy` chip; cost reverts to `$<amount>` rendering.
- [ ] Open DevTools → Application → Local Storage → your origin. Confirm
      `quicklogger.lastFuelup.<vehicleId>` value's `date` field matches
      whatever upstream just returned (i.e. it's the freshly-fetched
      value, not the previously-cached one).

## Photo OCR — pump mode (v0.2.0+, only with a provider configured)

- [ ] Camera chip "Photo pump display" appears between Volume and Cost on the form
- [ ] Tap it → iOS camera opens via `capture=environment`
- [ ] Photograph 5+ real pump displays across stations
- [ ] Within 2–15 s a chip "Detected: X gal · $Y · $Z/gal" appears in the same slot
- [ ] Tap **Use** → Volume + Cost (+ volumeUnit) populate; chip disappears
- [ ] Tap **Discard** → chip disappears; fields untouched
- [ ] Repeat with a non-pump scene → 422 toast "Couldn't read clearly"

## Photo OCR — odometer mode

- [ ] Camera chip "Photo" appears inside the Odometer cell (beside the `+N mi` chip)
- [ ] Photograph the dashboard odometer → blue chip "Detected: N mi" → [Use] populates Odometer
- [ ] Photograph a phone app showing mileage (Carfax / FuelEconomy.gov / similar) → same flow works
- [ ] With a previous fillup recorded, photograph an odometer that reads **below** the last value → amber warning, no [Use]
- [ ] Photograph an odometer reading **> 2000 mi above** last → amber warning, no [Use], message says "jumped > 2000 mi"
- [ ] Tap **Dismiss** on the amber chip → chip disappears, Odometer stays at the prefilled / typed value
- [ ] First fillup for a fresh vehicle (no `lastFuelup`) → relative check is skipped, [Use] always shows

## Photo OCR — error paths

- [ ] Unset `OLLAMA_VISION_URL` + `OPENROUTER_API_KEY` and restart → both camera chips hidden
- [ ] 21 rapid OCR taps within an hour → 21st attempt shows "OCR rate limit reached, try again in Ns" toast
- [ ] Disconnect network mid-OCR → after 90 s, "OCR took too long — please type values" toast surfaces
- [ ] Provider configured but reachable upstream is down → 502 → "OCR service unreachable — please type values" toast

## Photo OCR — disk state

- [ ] Inspect `/data/ocr-audit.jsonl` — one line per OCR call. `parsed` populated on success, `error` populated on failure. `ipHash` never resembles a raw IP (always `sha256:<16-hex>`). `mode` field present.
- [ ] Inspect `/data/ocr-budget.json` — `costCents` increments per OpenRouter call, stays 0 for ollama-only.
- [ ] Inspect `/data/ocr-audit-key.txt` — exists, 32 bytes, permissions `0600`.
- [ ] After 10 MiB of audit log growth, file gets truncated to 0 bytes on next append.

## Photo OCR — accuracy log (live data)

For 5+ real pump fillups + 5+ real odometer reads, record:

| Station / vehicle | Mode | Provider | Actual / detected | Drift | Notes |
| --- | --- | --- | --- | --- | --- |
| ... | pump / odometer | ollama / openrouter | ... | ... | ... |

Use mismatches to refine the system prompt in `ocrModes.ts` via patch
releases (v0.2.x).

## Pinch-zoom & pan crop (v0.3.0)

- [ ] In Photo OCR preview, tap **Crop** to enter crop mode
- [ ] Pinch with two fingers → the photo zooms behind a **fixed** crop box (the box stays put; the photo zooms/pans under it)
- [ ] Two-finger drag → the photo pans behind the fixed box
- [ ] The toolbar **zoom slider** scrubs smoothly from 1× to 5×, and the `N.N×` badge over the photo tracks the slider as you drag it
- [ ] Drag the slider all the way left → returns to 1× and the badge disappears
- [ ] At 1× (slider untouched / fully left), tap **Done** → the committed crop is unchanged vs. before this feature (a 1× crop is byte-for-byte identical)
- [ ] Zoom in + frame a small region (e.g. just the pump digits), tap **Done** → the cropped preview frames that tight region, and **Send for OCR** reads it correctly

## Drawer footer (v0.2.0)

- [ ] Open the drawer (top-right hamburger). Bottom of the drawer shows
      a footer line: `v<MAJOR>.<MINOR>.<PATCH>  ·  GitHub ↗`. Version
      matches the currently-deployed release (cross-check against the
      latest GitHub release tag).
- [ ] Tap `GitHub ↗`. Opens `https://github.com/varunpan/quicklogger`
      in a new tab (or the system browser if installed as a PWA).
      Original tab remains on whatever page it was.
- [ ] Footer is pinned to the bottom of the drawer regardless of which
      nav item is active — open / close / reopen confirms the spacing
      is stable.

## Plate + VIN tap-to-copy (v0.2.0)

- [ ] Open `/maintenance` for a vehicle that has both `licensePlate` and a `VIN` row in `extraFields` in LubeLogger. Confirm the new card renders both rows between the vehicle picker and reminders.
- [ ] Tap the **Plate** row. Confirm the row briefly flashes `Copied ✓` (~1.5 s), then reverts to `Plate`. Paste into Notes / Messages — value matches what LubeLogger has.
- [ ] Tap the **VIN** row. Same flash, paste matches.
- [ ] Switch to a vehicle whose `licensePlate` is empty in LubeLogger (or temporarily blank it). Reload `/maintenance`. Confirm only the VIN row renders.
- [ ] Switch to a vehicle whose `extraFields` has no `VIN` row (or one with an empty value). Reload. Confirm only the plate row renders.
- [ ] Switch to a vehicle missing both. Confirm no card renders at all — page reverts to picker → reminders.
- [ ] With LubeLogger upstream down: confirm the existing "Couldn't reach LubeLogger" banner shows and the Plate + VIN card hides (no vehicle data to draw from).

## Unit price on History cards (v0.3.0)

`/history` shows only fillups logged through this PWA on this device, so test
against fillups logged here. The unit-price line sits beneath each card's
volume·cost line (`data-testid="unit-price"`), with the converted half dimmed
after a ` · ` separator.

- [ ] Open `/history`. Every fillup card shows a unit-price line in the **logged**
      currency + unit (e.g. `CA$1.45/L`, `$3.15/gal`). Actual price is
      `cost ÷ volume` — eyeball one against the card's volume·cost line.
- [ ] **Instance basis (no conversion).** A fillup in gallons + your instance
      currency (e.g. USD·gal on a USD instance) shows a **single** value —
      actual only, no ` · ` second half.
- [ ] **Unit-only difference.** A fillup in litres with the instance currency
      (USD·L on USD) shows `$x/L · $y/gal` — converted half present but with
      **no** `≈` (exact arithmetic, no FX).
- [ ] **Cross-currency (snapshot).** With the app online, log a **new** fillup in
      a currency different from the instance (e.g. CAD on a USD instance), let it
      submit, then open `/history` → that card shows `CA$x/L · ≈ $y/gal`. The `≈`
      marks a currency conversion, at the **fillup-day** rate (not today's).
- [ ] **Pre-sync graceful degradation.** A cross-currency fillup still **queued**
      (logged offline, not yet synced) shows the actual line **only** — no
      converted half, no error. The `≈ $y/gal` half appears once it syncs.
- [ ] **Offline → replay.** Log a cross-currency fillup with the device offline
      (it queues, actual-only), then go back online so the queue replays → reopen
      `/history` and confirm the `≈ $y/gal` half is now present. (Snapshot currency
      is correct on a USD instance; non-USD has a known gap — issue #57.)
- [ ] **Regression.** Rest of each card (date, odometer, volume·cost, "Missed
      fillup" badge) unchanged; `/maintenance`, `/settings`, `/stats` unaffected.
