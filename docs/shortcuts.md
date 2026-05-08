# Apple Shortcuts integration

quicklogger v0.1.0 supports two iOS Shortcut patterns. Both work over
the same HTTPS endpoint and require nothing on quicklogger's side
beyond the regular setup.

## Path 1 — URL deep link (simpler)

The home page (`/`) accepts these query params:

| Param | Type | Notes |
|---|---|---|
| `vehicleId` | int | LubeLogger vehicle id |
| `volume` | decimal | matches the chosen unit |
| `volumeUnit` | `gal` \| `L` | |
| `cost` | decimal | matches the chosen currency |
| `currency` | ISO 4217 | `USD`, `CAD`, etc. |
| `fillToFull` | `true` \| `false` | defaults to `true` if missing |

The form opens pre-filled; the user only taps **Log fillup** to submit.

**Shortcut recipe:** see `shortcuts/quicklog-prefill.shortcut.recipe.md`

## Path 2 — Direct POST (voice-friendly, no UI)

For a "Hey Siri, log fillup" voice flow, build a shortcut that POSTs
JSON straight to `/api/fuelup`. No browser, just speech in / speech out.

Required JSON body (see `docs/api-mapping.md` for the full schema):
```json
{
  "vehicleId": 1,
  "date": "2026-05-07",
  "odometer": 87432,
  "volume": 11.2,
  "volumeUnit": "gal",
  "cost": 42.18,
  "currency": "USD",
  "isFillToFull": true,
  "missedFuelup": false,
  "clientSubmissionId": "<UUID>"
}
```

**Shortcut recipe:** see `shortcuts/quicklog-fuelup.shortcut.recipe.md`

## Install

1. Build the shortcut on your phone using the recipe.
2. Tap **Add to Home Screen** for one-tap launch.
3. For voice, tap the shortcut → Share → Add Voice Trigger →
   "Log fillup".

## Re-publishing iCloud links

When you publish a new shortcut version, update the URL section
below.

| Shortcut | iCloud link |
|---|---|
| quicklog-fuelup | _(populate after first publish)_ |
| quicklog-prefill | _(populate after first publish)_ |

## Android

Android Shortcuts (Tasker / Macrodroid) are out of scope for v0.1.0.
The same `/api/fuelup` JSON endpoint will serve any client; build a
Tasker HTTP Request task with the same payload to integrate.
