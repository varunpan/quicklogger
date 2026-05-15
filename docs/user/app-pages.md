# App pages

quicklogger has five pages, reachable from the drawer (top-right
hamburger): **Log Fuel**, **History**, **Maintenance**, **Vehicles**,
**Settings**. The active page is highlighted in the drawer. This
page walks through each one.

At the bottom of the drawer, a small footer shows the running app
version (e.g. `v0.2.0`) alongside a `GitHub ↗` link that opens the
source repo in a new tab. Useful for confirming a deploy went through
and for finding release notes.

## Log Fuel (`/`)

The home page. Everything that follows assumes a vehicle is selected; on
first open quicklogger picks the first vehicle returned by LubeLogger.

### Last-fillup strip

If the selected vehicle has a previous fillup, two muted text lines
appear above the vehicle picker:

        Last fill: 87,234 mi · May 5, 2026 (7 days ago)
        10.80 Gal · $39.42 · Costco Pump 4

Source is either the live LubeLogger fetch or, when offline, a local
snapshot. An amber `offline copy` chip appears next to the date when the
strip is being rendered from local data. See
[`odometer-prefill.md`](odometer-prefill.md) for the full strip + prefill
behaviour and [`offline-queue.md`](offline-queue.md) for what "offline"
means here.

### Form fields

| Field | What it does |
| --- | --- |
| **Vehicle** | Button-style row showing year/make/model. Tap it to jump to the Vehicles page and pick a different one. |
| **Odometer** | Number input, pre-filled with the previous reading when prefill is on. A `prefilled` tag sits in the input until you interact. |
| **`+N mi` chip** | One-tap increment below the odometer field. The number (`N`) reflects your **Quick increment** setting; the chip is hidden if you set it to 0 or disable prefill. |
| **Date** | Native date picker, defaults to today. |
| **Volume** | Decimal input + `Gal`/`L` toggle pill on the right. |
| **Cost** | Decimal input + currency dropdown (USD/CAD/EUR/GBP/MXN). |
| **FX rate** | Only appears when the FX provider chain is unreachable. See [`currency-fx.md`](currency-fx.md). |
| **Fill to full** | Toggle button. Blue when on (default on). |
| **Missed fillup** | Toggle button. Blue when on. Marks the entry as one where a previous fillup was missed (so MPG calcs handle the gap). |
| **Note · station · grade** | Free-form text. Plain string, sent to LubeLogger's `notes` field. |
| **Will log** preview | Blue summary line appearing when both volume and cost are valid. Shows converted gallons + USD cost, plus MPG-since-last-fill when computable. |
| **Log fillup** | The submit button. Disabled until odometer, volume, cost, and date are all valid (>0 / non-empty). |

### What happens on submit

See [`offline-queue.md`](offline-queue.md) for the toast colours and the
queue behaviour. In short: green toast = posted; amber = saved locally
and will sync later; red = LubeLogger rejected it (fix and retry).

**Photo OCR (v0.2.0+):** when an OCR provider is configured, two blue
camera chips render — one in the Odometer cell, one between Volume and
Cost — letting you snap the pump display or odometer to pre-fill the
form. See [`photo-ocr.md`](photo-ocr.md) for setup and walkthrough.

## Vehicles (`/vehicles`)

A flat list of every vehicle LubeLogger knows about. Each tile shows:

- A generic car icon (LubeLogger photos aren't served).
- The vehicle's year + make + model, joined with spaces, skipping
  blanks.
- The LubeLogger vehicle id underneath (small grey text). Useful for
  Apple Shortcuts URL-deep-link recipes — see
  [`shortcuts.md`](shortcuts.md).

Tap a tile to:

1. Persist that vehicle id as your "last vehicle" in localStorage.
2. Navigate back to the page that sent you here. By default that's
   `/?vehicleId={id}` (Log Fuel). If you arrived from `/maintenance`
   via its vehicle card, you land back on
   `/maintenance?vehicleId={id}` instead — the picker honors a
   `?from=` query so the round-trip stays in context.

The vehicle list is read-only inside quicklogger — to add or edit
vehicles, do it in LubeLogger directly.

If LubeLogger returned no vehicles (none defined, or the API is
unreachable on first load), the page says:

> No vehicles found in LubeLogger.

## Settings (`/settings`)

All settings on this page are **per-device** — they persist in your
browser's `localStorage` under the key `quicklogger.prefs`. They do not
touch LubeLogger and do not sync between devices.

If you're looking for the deploy-wide knobs (LubeLogger URL, target
currency, FX provider chain), see [`configuration.md`](configuration.md).

| Label | What it does | localStorage field |
| --- | --- | --- |
| **Default volume unit** | `Gallons` / `Liters` toggle. New form opens with this unit pre-selected. Server still converts to whatever LubeLogger expects. | `defaultVolumeUnit` (`gal` or `L`) |
| **Default currency** | Dropdown of the same five currencies the form accepts. New form opens with this currency pre-selected. | `defaultCurrency` (ISO 4217 code) |
| **Odometer prefill** | `On` / `Off` toggle. Off = form opens with an empty odometer field; the `+N mi` chip is also hidden. | `odometerPrefillEnabled` (bool, default `true`) |
| **Quick increment (mi)** | Number input. The `+N mi` chip below the odometer field adds this many miles per tap. Set to `0` to hide the chip while keeping the prefilled value. | `odometerIncrementMi` (int, default `300`) |
| **Smart checks** | `On` / `Off` toggle. On = advisory chip appears at submit time when the form looks off (lower odometer than last, future date, tiny volume, etc.); the chip has a `[Submit anyway]` override. Off = no chip, no extra friction. | `smartChecksEnabled` (bool, default `true`) |

One field is also persisted but has no UI on this page: `lastVehicleId`,
set automatically when you pick a vehicle on `/vehicles` or submit a
fillup. The Log Fuel page falls back to this when no `vehicleId` query
param is present. The full set of persisted fields (these five plus
`lastVehicleId`) is defined by `DEFAULT_PREFS` in
`src/lib/client/prefs.ts`.

A small footer reminds you:

> Server converts to the LubeLogger-configured target unit and currency
> before posting. These prefs only affect form defaults.

## Maintenance (`/maintenance`)

A read-only list of upcoming maintenance reminders pulled from
LubeLogger for the active vehicle. Each row shows what's due, an
urgency chip (`Past Due` / `Very Urgent` / `Urgent`), and a due
context line — either a date (`Due Apr 12, 2026 · 31 days overdue`),
an odometer reading (`Due at 115,316 mi · 5,764 mi to go`), or both.

quicklogger relies on whatever reminders you've configured in
LubeLogger — there's no UI here to create, edit, or dismiss them.
Anything LubeLogger flags as `NotUrgent` is hidden; the page is
about what's actually approaching or past due.

The page is reachable two ways:

- **From the drawer** — tap `Maintenance` in the hamburger menu. The
  active vehicle is the one you most recently picked or submitted
  against (same `lastVehicleId` the form uses).
- **After a successful fuel submit** — the app auto-navigates here
  from the Log Fuel page so you see the heads-up without having to
  reach for the menu. Queued (offline) submits do NOT redirect —
  there's no live data to show.

Tap the **vehicle card** at the top to switch which vehicle's
reminders you're looking at. The picker (`/vehicles`) returns you
straight back to Maintenance after you pick, rather than dumping
you on Log Fuel.

States you may see:

- **Looks good** — your active vehicle has no `Urgent`,
  `VeryUrgent`, or `PastDue` items right now.
- **Couldn't reach LubeLogger right now** — the API call failed.
  Try again once you're back online; no data is cached locally for
  this page in this version.
- **Pick a vehicle first** — quicklogger doesn't know which vehicle
  to show. Tap through to `/vehicles` and select one.

Below the vehicle picker, a **Plate + VIN** card shows the active
vehicle's license plate and VIN (pulled from LubeLogger). Tap either
row to copy the value to your clipboard — handy at a parts counter
or filling in an insurance form. Each row briefly flashes
`Copied ✓` for confirmation. If your vehicle doesn't have one of
the two fields set in LubeLogger, that row hides; if neither is
set, the card hides entirely.

A small "← Back to Log Fuel" link at the bottom returns you to the
form.

## History (`/history`)

A scrollable list of every fillup you've logged through this PWA for
the active vehicle. One card per entry, newest date first.

A vehicle card at the top mirrors the one on Log Fuel and Maintenance —
tap it to switch which vehicle's history you're looking at. The
picker returns you straight back to History after you pick.

Each card shows:

- **Status badge** when relevant. Amber `Queued` means the entry is
  waiting to sync; rose `Failed` means LubeLogger rejected it. No
  badge means the entry posted successfully.
- **Date line** — the date you logged, plus a relative phrase
  (`May 12, 2026 · yesterday`, `Apr 7, 2026 · 36 days ago`).
- **Odometer reading**.
- **Volume + cost line** — formatted as `14.279 gal · USD 50.96`.
- **Fill-to-full** or **Missed fillup** when those flags were set.
- **note:** the free-text note, when you wrote one.
- **#tag chips** when you tagged the entry.
- **error:** and **attempts:** lines on failed entries only, so you
  know why and how often it tried.

States you may see:

- **No fillups logged on this device yet** — your local store is
  empty. Log something and it'll appear here.
- **No fillups logged for this vehicle yet** — the local store has
  entries for other vehicles. Switch vehicles via the picker card.
- **Couldn't load local history** — IndexedDB is unavailable (private
  browsing, storage quota). The page renders a rose notice; the
  picker still works.

A footer disclaimer is always present:

> Only fillups logged through this PWA appear here.

This is by design — the page reads the local browser store, not
LubeLogger. Fillups you entered via the LubeLogger web UI, or on a
different device, won't show up. To see the full history per
vehicle, use LubeLogger directly.

There's no retry, dismiss, or edit affordance in this version —
failed entries surface their last error so you can decide what to
do next.
