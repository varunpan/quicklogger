# App pages

quicklogger has four pages, reachable from the drawer (top-right
hamburger): **Log Fuel**, **History**, **Vehicles**, **Settings**. The
active page is highlighted in the drawer. This page walks through each
one.

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
2. Navigate back to `/?vehicleId={id}` so the Log Fuel page loads with
   the selected vehicle.

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

One field is also persisted but has no UI on this page: `lastVehicleId`,
set automatically when you pick a vehicle on `/vehicles` or submit a
fillup. The Log Fuel page falls back to this when no `vehicleId` query
param is present. The full set of persisted fields (these four plus
`lastVehicleId`) is defined by `DEFAULT_PREFS` in
`src/lib/client/prefs.ts`.

A small footer reminds you:

> Server converts to the LubeLogger-configured target unit and currency
> before posting. These prefs only affect form defaults.

## History (`/history`)

A bare-bones inspection page. It loads in two halves:

### Pending sync

If anything is in the local IndexedDB queue, this section appears first
under an amber **Pending sync** heading. One amber card per queue entry,
each showing volume + currency + cost, then `status` and `attempts`,
and `error` if the last attempt failed.

This is where you check whether an offline submission actually went
through. See [`offline-queue.md`](offline-queue.md) for what each status
means and what triggers a re-sync.

### Last fillup on LubeLogger

Below the queue, the most recent fillup the server returned for your
**last-picked vehicle** is rendered as raw JSON. It's pretty-printed so
you can read fields directly. There's no formatting layer — it's
diagnostic rather than presentational. If the server returned nothing
(network failed, vehicle has no fillups yet), the page says:

> None.

The page does not currently let you view older fillups, delete queue
entries, or trigger a manual re-sync — those run automatically on focus
(see [`offline-queue.md`](offline-queue.md)).
