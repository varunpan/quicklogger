# Manual UAT checklist

Run after each release before tagging stable.

Examples throughout this checklist assume a `gallons_us`/`miles`/`USD`
instance unless a section says otherwise — e.g. the dedicated
**Metric instance (liters + km)** section below, which repeats the relevant
checks for a `liters`/`km` instance.

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

- [ ] App auto-selects a vehicle on load: the one last picked on `/vehicles`
      (`lastVehicleId`) if any, otherwise the first vehicle — same resolution
      order as History / Maintenance / Stats
- [ ] With 2+ vehicles: pick vehicle B on `/vehicles`, confirm `/history` and
      `/maintenance` also land on vehicle B, then tap **Log Fuel** in the
      drawer — `/` shows vehicle B too, not the first vehicle in the list
- [ ] Enter odometer, volume in gallons, cost in USD, fill-to-full = on
- [ ] Tap "Log fillup"
- [ ] Toast shows "Logged: X.XX Gal · $YY.YY"
- [ ] Verify the entry appears in LubeLogger UI within 5 seconds

## Unit / currency conversion

- [ ] Switch volume to L, enter 50
- [ ] Switch currency to CAD, enter 65
- [ ] Tap "Log fillup"
- [ ] Toast confirms ~13.2 Gal · ~$47 USD
- [ ] LubeLogger record matches (US gal / USD)

## Offline + queue

- [ ] Enable airplane mode
- [ ] Submit a fillup → toast shows "Saved locally — will sync when online"
- [ ] Disable airplane mode
- [ ] Tap away and return to the app (focus event triggers sync)
- [ ] /history shows pending count drops to 0
- [ ] LubeLogger receives the entry

## Apple Shortcut — direct POST

- [ ] Run `quicklog-fuelup` shortcut from home screen
- [ ] Voice prompts complete (vehicle, volume, cost)
- [ ] Shortcut speaks "Logged X gallons, Y dollars"
- [ ] LubeLogger receives the entry

## Apple Shortcut — URL deep link

- [ ] Run `quicklog-prefill` shortcut
- [ ] Browser opens the deployed URL with form pre-filled (`?vehicleId=...&volume=...`)
- [ ] Tap "Log fillup" → confirmation
- [ ] LubeLogger receives the entry

## FX outage / manual override

- [ ] On the host running quicklogger, briefly block outbound TCP 443:
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
      see [`deployment.md`](deployment.md) § _Dev prod-mirror compose_.
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
- [ ] Submit a fillup — toast shows "Saved locally — will sync when online".

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

- [ ] Camera chip **Pump display photo** appears in the button row at the top
      of the form (above the Odometer/Date grid) — not between Volume and Cost
- [ ] Tap it → the OS photo picker opens (Camera / Photo Library / Choose Files
      on iOS). There is no dedicated auto-launched camera (no
      `capture=environment`) — picking an existing photo from the library
      also works
- [ ] Pick or capture a pump photo → a full-screen **preview** opens (Cancel /
      Rotate / Retake / Crop / **Send for OCR**) before any OCR call happens
      — see the crop section below for the Crop button's own flow
- [ ] Tap **Send for OCR** → within 2–15 s a chip "Detected: X gal · $Y ·
      $Z/gal" appears below the capture row
- [ ] Photograph 5+ real pump displays across stations, repeating the
      pick/preview/Send-for-OCR flow each time
- [ ] Tap **Use** → Volume + Cost (+ volumeUnit) populate; chip disappears
- [ ] Tap **Discard** → chip disappears; fields untouched
- [ ] Repeat with a non-pump scene → "Couldn't read clearly — try again or
      type manually" toast

## Photo OCR — odometer mode

- [ ] Camera chip **Odometer photo** appears in the same top button row
      (beside Pump display photo, if pump mode is also enabled) — not inside
      the Odometer field's cell. The **+N mi** chip below the Odometer field
      is a separate, unrelated control (see the odometer-prefill section
      above)
- [ ] Tap it → picker opens → pick/capture → full-screen preview (Cancel /
      Rotate / Retake / Crop / **Send for OCR**) → tap **Send for OCR** —
      same flow as pump mode above
- [ ] Photograph the dashboard odometer → blue chip "Detected: N mi" → **Use**
      populates Odometer
- [ ] Photograph a phone app showing mileage (Carfax / FuelEconomy.gov / similar) → same flow works
- [ ] With a previous fillup recorded, photograph an odometer that reads
      **below** the last value → amber chip reading "Detected: N mi — lower
      than last fillup (Y mi)", with **Use anyway** and **Dismiss** buttons
      (there is no plain "Use" on this chip)
- [ ] Tap **Use anyway** on that amber chip → Odometer is set to the detected
      (lower) value anyway
- [ ] Tap **Dismiss** instead → chip disappears, Odometer stays at the
      prefilled / typed value
- [ ] Photograph an odometer reading **more than 2,000 mi above** the last
      value → this is **not** flagged here. The blue "Detected" chip shows
      normally with a plain **Use** button; the jump is instead caught by a
      submit-time smart check after you tap Log fillup — see "Smart checks at
      submit" below
- [ ] First fillup for a fresh vehicle (no prior fillup on file) → the
      lower-than-last check is skipped entirely; the blue "Detected" chip
      with **Use** always shows

## Photo OCR — error paths

- [ ] Unset all four provider slots — `OLLAMA_VISION_URL`,
      `OLLAMA_CLOUD_API_KEY`, `OPENROUTER_API_KEY`, and the
      `OPENAI_COMPATIBLE_URL` + `OPENAI_COMPATIBLE_API_KEY` +
      `OPENAI_COMPATIBLE_MODEL` triple — and restart → both camera chips
      hidden
- [ ] With any ONE of those four slots configured (e.g. only
      `OLLAMA_CLOUD_API_KEY` set), OCR stays enabled and both camera chips
      stay visible — this is not an all-or-nothing toggle
- [ ] 21 rapid OCR taps within an hour → 21st attempt shows "OCR rate limit reached, try again in Ns" toast
- [ ] Disconnect network mid-OCR → after 90 s, "OCR took too long — please type values" toast surfaces
- [ ] Provider configured but reachable upstream is down → 502 → "OCR service unreachable — please type values" toast

## Photo OCR — disk state

- [ ] Inspect `/data/ocr-audit.jsonl` — one line per OCR call. `parsed` populated on success, `error` populated on failure. `ipHash` never resembles a raw IP (always `sha256:<16-hex>`). `mode` field present.
- [ ] Inspect `/data/ocr-budget.json` — `costCents` increments per OpenRouter call, stays 0 for ollama-only.
- [ ] Inspect `/data/ocr-audit-key.txt` — exists, 32 bytes, permissions `0600`.
- [ ] After 10 MiB of audit log growth, the live file is **renamed** to
      `ocr-audit.jsonl.1` (keeping one prior generation) on the next append,
      and a fresh file starts — it is never truncated to 0 bytes. Confirm
      `.1` exists and still has lines in it after triggering a rotation.

## Photo OCR — accuracy log (live data)

For 5+ real pump fillups + 5+ real odometer reads, record:

| Station / vehicle | Mode            | Provider            | Actual / detected | Drift | Notes |
| ----------------- | --------------- | ------------------- | ----------------- | ----- | ----- |
| ...               | pump / odometer | ollama / openrouter | ...               | ...   | ...   |

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
after a `·` separator.

- [ ] Open `/history`. Every fillup card shows a unit-price line in the **logged**
      currency + unit (e.g. `CA$1.45/L`, `$3.15/gal`). Actual price is
      `cost ÷ volume` — eyeball one against the card's volume·cost line.
- [ ] **Instance basis (no conversion).** A fillup in gallons + your instance
      currency (e.g. USD·gal on a USD instance) shows a **single** value —
      actual only, no `·` second half.
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

## Instance units — liters & km (v0.3.2)

quicklogger writes fuel volume in the unit your LubeLogger instance is configured
for, and labels every volume/distance to match (issue #69 — metric instances used
to **500 on submit**). Set `LUBELOGGER_VOLUME_UNIT` (`gallons_us` | `liters`) and
`LUBELOGGER_DISTANCE_UNIT` (`miles` | `km`) to match your instance (LubeLogger →
Settings → Imperial Calculation). The two vars are independent — a UK instance is
`liters` + `miles`.

### Startup validation

- [ ] Set `LUBELOGGER_VOLUME_UNIT` to a bad value (e.g. `furlongs`) and bring the
      stack up → server **refuses to boot** with a clear `EnvError`, not a
      per-submit 500. Restore a valid value.

### Metric instance (liters + km) — the #69 path

Point quicklogger's env (and a test instance) at `liters` + `km`.

- [ ] **Log-form labels.** Volume field reads **L**; odometer reads **km**.
- [ ] **Economy preview.** The "Will log" strip shows **L/100km** (not MPG) once
      an odometer + volume are entered against a prior fillup.
- [ ] **Submit in L.** Log a fillup in L/km → success toast shows the volume in
      **L**, and the record lands in LubeLogger with the same number (no gallon
      conversion). _This is the exact submit that 500'd pre-fix._
- [ ] **Enter gal → stored as L.** With the volume toggle on gal, enter a gallons
      amount → toast and stored record are in **L** (converted ×3.785). Odometer
      value is unchanged.
- [ ] **History.** The new card's unit price reads per **L**; distance reads **km**.
- [ ] **Last-fill strip** (home). Volume shown in **L**.
- [ ] **Smart-check.** The big-jump nudge fires above **2,000 km** and reads km.
- [ ] **Stats.** Distances/volumes read km / L.
- [ ] **Odometer OCR reads km** (only with an OCR provider configured, odometer
      mode). Photograph the dashboard odometer on this km instance — the
      detected reading matches the visible digits. The model is told this
      cluster shows kilometers; on a stale build that always said "miles"
      internally, a 6-digit km reading was more likely to be misread.
- [ ] **Photo filename** (only with an OCR provider configured). An attached photo
      is named `odometer-<value>km.jpg`.

### Gallons instance (gallons_us + miles) — regression

Point back to `gallons_us` + `miles`.

- [ ] Every surface above reads **gal** / **mi**; economy preview shows **MPG**.
- [ ] Submit in gal → stored un-converted; submit in L → stored as **gal**
      (÷3.785). Odometer unchanged.

### Mixed pairing

- [ ] On a `liters` + `miles` (or `gallons_us` + `km`) instance, the economy
      preview is **hidden** — no standard single figure.

### Cold cache

- [ ] First visit / cleared storage, **online**: labels briefly show **gal/mi**
      until the first `/api/server-info` refresh lands, then switch to the
      instance units.

## Smart checks at submit (v0.2.0)

Advisory-only — every check can be overridden. Six checks ship, labelled A,
B, C, D, E, G (a cost/volume-ratio check was deferred to a future release).
More than one firing at once stacks into a single chip. Examples below
assume a gal/mi instance; on a liters/km instance the same checks fire with
L/km numbers and wording — see the Instance units section above. Toggle at
`/settings` → **Smart checks** card (default **On**).

- [ ] **A — lower odometer.** Submit an odometer lower than the last fillup
      (same-or-later date) → amber chip includes "Odometer (X mi) is lower
      than the last fillup (Y mi on Mon D)."
- [ ] **B — older date, higher odometer.** Backdate a fillup earlier than the
      last one but with a higher odometer → chip includes "Older date but
      higher odometer than the most recent fillup (Y mi on Mon D)."
- [ ] **C — same-day duplicate.** Submit the same date as the last fillup with
      an odometer within 5 mi of it → chip includes "Looks like a duplicate of
      the Mon D fillup at Y mi."
- [ ] **D — future date.** Set the date field ahead of today → chip includes
      "Date is in the future."
- [ ] **E — big odometer jump.** Submit an odometer more than 2,000 mi above
      the last one → chip includes "Odometer is N mi above the last fillup —
      over 2,000 mi." (This is the same jump the odometer-OCR section used to
      warn about at photo-confirm time — it now fires here, at submit,
      instead — see the Photo OCR — odometer mode section above.)
- [ ] **G — tiny volume.** Enter a volume under 0.5 gal → chip includes
      "Volume (X) seems small" — under 1 gal it adds "— did you mean Y?"
      (X × 10).
- [ ] Two or more checks firing at once → one consolidated chip, "N issues
      found", one line per issue.
- [ ] Tap **Submit anyway** → the fillup submits with the same values,
      bypassing every currently-listed check for this one submission.
- [ ] Edit the odometer, date, or volume field after the chip appears → the
      chip clears (editing cost or notes does not clear it).
- [ ] `/settings` → **Smart checks** toggled **Off** → none of the above fire;
      submit goes straight through regardless of odometer / date / volume.

## Photo-date EXIF prefill (v0.2.0)

Pump-photo only — picking or capturing an odometer photo never touches the
Date field.

- [ ] Pick an **older** photo (taken on a previous day) from your library for
      the pump display → Date field updates to that photo's date, and a blue
      chip **"set from photo"** appears under the Date field.
- [ ] Take a pump photo right now with the camera (or pick a same-day library
      photo) → Date field is untouched and no cue chip appears — a photo
      dated today is a no-op by design.
- [ ] Pick a screenshot, or a photo with EXIF stripped (e.g. re-saved via a
      messaging app) → Date field is untouched, amber chip **"no date in
      photo"** appears.
- [ ] Pick an **odometer** photo (not pump) from your library, including an
      older one → Date field and cue are both untouched — EXIF prefill only
      triggers off the pump capture.
- [ ] Edit the Date field manually after a cue has appeared → the cue clears.
- [ ] Submit successfully → the cue clears along with the rest of the form
      reset.

## Photo attach to the LubeLogger record (v0.2.6)

Online-only: the attached bytes are never persisted to IndexedDB, so a queued
(offline) submission can never carry a photo.

- [ ] Send a pump photo for OCR (its "Detected" chip appears) → below the
      smart-check area, a new row appears: a checkbox (checked), **"Attach
      photo to this record"**, sub-label **"Pump display photo from this
      session"**.
- [ ] Also send an odometer photo for OCR this session → the row updates to
      **"Attach photos to this record"** / **"Pump & odometer photos from
      this session"**.
- [ ] Tap the row to uncheck it, then submit → the fillup is logged with no
      photo attached in LubeLogger.
- [ ] Leave it checked and submit online → the fillup is logged AND the exact
      (resized) bytes sent to OCR appear as attachments on the LubeLogger
      record, named `pump-<odometer>mi.jpg` / `odometer-<odometer>mi.jpg` (or
      `...km.jpg` on a km instance) — not the original full-resolution photo.
- [ ] Discard an OCR suggestion (chip's **Discard**, not **Use**) but leave
      the photo row checked, then submit → the photo still attaches even
      though its OCR reading was never applied to the fields.
- [ ] Reload the form without sending any OCR photo this session → the attach
      row does not render at all.
- [ ] Enable airplane mode with a photo staged and checked, then submit →
      toast reads "Saved locally — photo not attached." and the fillup queues
      text-only.
- [ ] After that offline queued save, the attach row disappears from the form
      (the staged photo is cleared) — it does not carry over into the next
      entry. Once the queue syncs, no photo is ever attached to that record;
      this is expected, not a bug.

Note: the staged photos are cleared only when the offline queue write itself
succeeds. If IndexedDB is unavailable (e.g. Safari private browsing), the
fillup fails outright with "Couldn't save — device storage unavailable" and
the staged photos are deliberately kept so you can retry — this edge case
isn't practical to reproduce on a normal device.

## Stats page (v0.3.0)

Reachable from the drawer nav (**Stats**, between Maintenance and Vehicles)
and via the vehicle-picker round-trip (`?from=stats`). Online-only, like
Maintenance — no local/offline cache.

- [ ] Open **Stats** from the drawer for a vehicle with fuel/service history.
      The vehicle card (and Plate/VIN card, if the vehicle has them) renders
      at the top, same as Maintenance.
- [ ] **Total cost of ownership** card shows a dollar total plus "N records"
      underneath — matches the sum of fuel + service + repair + upgrade + tax
      costs LubeLogger reports for that vehicle.
- [ ] **Cost breakdown** list shows one row per category with a record count
      (e.g. "12 fill-ups") and that category's cost total; a category with
      zero records for this vehicle shows no row at all.
- [ ] If the vehicle has a purchase price set in LubeLogger (> 0), a
      **Purchase price** row renders; if it's unset (or 0), the row is absent.
- [ ] **Last reported odometer** row shows the vehicle's latest odometer value
      with the instance distance unit (mi/km).
- [ ] If the vehicle has any past-due or upcoming reminders, a row links to
      Maintenance and shows a rose **"N Past Due"** badge (only when N > 0)
      and/or "N upcoming" text; tapping it navigates to `/maintenance` for the
      same vehicle. With **no** past-due or upcoming reminders, this row does
      not render at all.
- [ ] Switch to a vehicle with **no** logged records at all → "No records
      logged for this vehicle yet." message, no cost/odometer/reminder cards.
- [ ] With no vehicle resolvable (e.g. a fresh instance with none picked and
      none cached) → "Pick a vehicle first." message with a link to the
      vehicle picker.
- [ ] With LubeLogger upstream down → "Couldn't reach LubeLogger right now."
      banner; no cost/odometer/reminder cards render.
- [ ] "← Back to Log Fuel" link at the bottom returns to `/`.
