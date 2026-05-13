# Maintenance page — internals

The `/maintenance` route shows LubeLogger reminders flagged as
`Urgent`, `VeryUrgent`, or `PastDue` for the active vehicle. This
doc covers the page's lifecycle, data flow, and error handling.
The HTTP API row and the `Reminder` type definition live in
[`idb-and-api.md`](./idb-and-api.md).

## Lifecycle

The page is reached two ways:

1. **From the drawer.** The user taps `Maintenance` in the
   hamburger menu. The loader resolves the active vehicle via the
   fallback chain `URL ?vehicleId= → prefs.lastVehicleId →
   vehicles[0].id`.
2. **As a post-submit redirect.** After a successful fuel
   submission on `/`, the submit handler calls
   `goto('/maintenance?vehicleId=' + vehicle.id)`. The URL always
   carries `vehicleId` in this path, so the first step of the
   fallback chain succeeds without touching prefs.

The redirect only fires on the **green** submit path
(`/api/fuelup` returned `200 { ok: true, ... }`). The amber
(queued) and red (rejected) branches do not navigate — there's no
point trying to fetch reminders when the network is unreachable,
and the form should stay on screen when a submission failed.

## Data flow

```text
User taps "Log fillup"
      │
      ▼
+page.svelte submit handler
      │   /api/fuelup → 200 ok        (green path)
      ├──────────────────────────────► goto('/maintenance?vehicleId=' + active)
      │
      │   /api/fuelup → queued        (amber path, SW caught it)
      ├──────────────────────────────► toast only, stay on page
      │
      │   /api/fuelup → 4xx           (red path)
      └──────────────────────────────► toast only, stay on page

User opens drawer → taps "Maintenance"
      │
      ▼
goto('/maintenance')                  (no query, loader uses prefs.lastVehicleId)
      │
      ▼
/maintenance loader (+page.ts)
      │
      ├── pick vehicleId from URL → prefs.lastVehicleId → vehicles[0].id
      ├── call listReminders(id) from $lib/client/api
      │     └── fetch('/api/vehicle/reminders?vehicleId=' + id)
      │           └── server route → LubeLoggerClient.listReminders(id)
      │                 └── GET {LUBELOGGER_URL}/api/vehicle/reminders?vehicleId=id
      │
      ▼
loader returns { vehicle, reminders, error }
      │
      ▼
+page.svelte renders:
   filter (urgency ≠ 'NotUrgent')
     → sort by urgency then most-overdue
       → for each: description + urgency badge + due-context line(s)
```

## Error handling

| Case | What the user sees |
|---|---|
| LubeLogger returned 5xx (timeout, down) | Page renders the header. Amber banner: `Couldn't reach LubeLogger right now.` Empty reminder area below. |
| LubeLogger returned 4xx (e.g. bad vehicle id) | Same amber banner. The 4xx is collapsed to a 502 server-side (matching `last-fuelup`), so the client-side message reads the same as the 5xx case. |
| `vehicleId` couldn't be resolved (no prefs, no vehicles) | Red banner: `Pick a vehicle first.` Link to `/vehicles`. |
| Active vehicle has zero not-OK reminders | Muted line: `Looks good — no upcoming maintenance for this vehicle.` |
| Network entirely offline (page reached via drawer while disconnected) | Same as 5xx case — the fetch fails, banner explains. No local cache. |
| Post-submit redirect when offline | Doesn't happen. The submit path is `queued` (amber), not green, so `goto` never fires. |

Server-side mapping in `+server.ts` matches the pattern used by
`last-fuelup/+server.ts`: any `LubeLoggerError` (4xx or 5xx) becomes
a 502 on the quicklogger side; anything else thrown becomes a 500.
The client helper turns non-200 into a thrown `Error` with
`{ status, message }` so the loader can populate `error` in the
returned object.

## Render details

- **Filter:** only reminders where `urgency !== 'NotUrgent'` are rendered.
- **Sort:** primary key `PastDue → VeryUrgent → Urgent`. Within a group,
  secondary key picks the most-overdue first via the signed countdown
  field that matches `userMetric` (`dueDays` for `Date`, `dueDistance`
  for `Odometer`, `Math.min` of both for `Both` as a heuristic — comparing
  days to miles mixes units, but the more-negative side correctly surfaces
  the more-overdue reminder first within the `Both` subset).
- **userMetric vs. metric:** the page uses `userMetric` to decide which
  due-side lines to render. `metric` is upstream's own pick of which
  side became urgent first when `userMetric === 'Both'`; not surfaced.
- **Render:** each reminder renders as a row with description, an
  urgency chip (rose / amber / yellow), and one or two due-context
  lines depending on `userMetric`. Lines use `formatDueDate` for the
  date and `humanCountdown` for the countdown. `formatLastFillupDate`
  is deliberately NOT used here — it appends `(N days ago)` which would
  double up with `humanCountdown`'s `(N days to go / overdue)` suffix.

## Persistence

None. The page touches no IndexedDB store, no localStorage key, no
service-worker cache. Reminders are fetched fresh on every visit —
they change as soon as the user logs a fillup (LubeLogger uses max
odometer across tabs to compute urgency), and the post-submit
redirect would actively defeat any cache. Revisit if an offline
glance becomes a real friction point.

## Cross-references

- [`idb-and-api.md`](./idb-and-api.md) — HTTP API row + `Reminder`
  type + LubeLogger client surface.
- [`service-worker.md`](./service-worker.md) — note that the
  reminders endpoint is NOT precached; the SW only serves the app
  shell offline.
