# Offline queue

quicklogger is a PWA — the form keeps working when your phone has no
signal. Submissions made offline are saved on the device and posted to
LubeLogger automatically the next time the app can reach the network.
You will encounter the queue most often at the pump (no service, parking
garage) or when your LubeLogger host is briefly unreachable.

## Opening the app with no signal

quicklogger is installable, and it now starts even when you open it with no
connection at all. Launch the installed app (or hard-refresh the page) while
offline and you still get the real Log Fuel form — pick your vehicle, enter the
fill-up, and save it. An amber banner reminds you that you're offline:

> You're offline — this fill-up will be saved and synced when you reconnect.

…and the submit button reads **Save offline** instead of **Log fillup**. The
fill-up goes into the same on-device queue described below and posts to
LubeLogger automatically the next time the app reaches the network.

One caveat: the vehicle list is remembered from the last time you opened the app
online. If you install the app and then go offline **before ever opening it with
a connection**, there's no remembered vehicle yet, so the form comes up empty —
open it once on a network and you're set.

## Submitting offline — what you see on the form

After you tap **Log fillup**, one of these toasts appears at the bottom of
the form:

| Toast colour | Text                                                              | What it means                                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Green        | `Logged: {N.NN} Gal · {cost}` (or `... L ·` on a liters instance) | Posted to LubeLogger successfully. The numbers are the converted, server-side values (so you can sanity-check FX). The volume unit and cost currency both match your LubeLogger instance.           |
| Amber        | `Saved locally — will sync when online`                           | The network call failed (offline, server down, DNS not resolving). Your submission is in the device queue and will replay automatically.                                                            |
| Amber        | `Saved locally — photo not attached.`                             | Same save-and-queue as above, shown when you had photos attached at submit time. Only the fill-up itself is queued — photos are never queued, so they won't be attached when it syncs.              |
| Red          | `Submission rejected: {message}`                                  | The submission got a 4xx — either quicklogger's own validation (missing field, bad value, unknown currency/unit) or LubeLogger rejecting it. The submission is **not** queued; fix it and resubmit. |

The form does not need to know in advance whether you are offline. It
always tries the POST first and falls back to the queue on network or 5xx
failure.

When the fill-up goes into the queue, quicklogger clears the form and takes you
straight to **History**, where your entry is sitting at the top with an amber
**Queued** badge. That's your proof it was saved — you don't have to trust the
toast, and there's no half-filled form tempting you into a second tap. (The one
exception: if your device refuses to store anything at all — Private Browsing,
or a full disk — you stay on the form with the red "NOT saved" message so you
can try again.)

## The History page — what queued submissions look like

Open the drawer → **History**. Every fill-up logged on this device for the
selected vehicle appears in a single list, newest date first — synced,
pending, and failed entries together. Each card shows the date, odometer,
volume and cost, the price per unit, any notes you entered, and tag chips
if the entry has tags (only possible for entries logged via Shortcuts or
a direct API call — the Log Fuel form has no tags field).

Cards that haven't reached LubeLogger yet carry a badge:

- **Queued** (amber) — waiting for the next sync run.
- **Failed** (red) — won't retry. Two ways an entry gets here: the server
  rejected it permanently (HTTP 4xx), or it used up all 5 delivery
  attempts (shown as `error: max attempts`). To clear it, open the row
  in your browser's devtools → IndexedDB store and delete it, or accept
  that the entry won't reach LubeLogger.

One more badge shows up on entries that _did_ finish syncing:

- **Skipped** (grey) — the fill-up was already in LubeLogger, so quicklogger
  didn't write it a second time. Nothing is wrong and nothing was lost. The
  usual cause is a submission that reached the server while the reply got lost
  on the way back, so the app retried something that had in fact already
  landed. The card carries the line _"Already in LubeLogger — not written
  twice."_ so you know which of two similar-looking entries is the real record.

Cards without a badge have already posted successfully. These synced
fill-ups are kept as local history so the offline odometer prefill has
something to fall back on (see [`odometer-prefill.md`](odometer-prefill.md)).
How many are kept is up to you: **Settings → Fill-ups kept per vehicle**
(default 200); older ones are cleaned up automatically. Queued and failed
entries are never cleaned up.

A failed card also shows an `error: ...` line and — when at least one
delivery attempt actually reached your server — an `attempts:` count.
Tries that fail because you're offline don't count, and the count caps
at 5 (see "What happens on failure" below).

The page reads only from the on-device store — nothing is fetched from
LubeLogger, and only fill-ups logged through this PWA appear here.

## When does sync run?

The app tries to drain the queue every time you **open** or **refocus**
it, and the moment connectivity **returns** while the app is open (the
browser's `online` event — Wi-Fi reassociating, cellular coming back).
There is no background sync, and nothing happens while the tab is
closed. If you close the tab/PWA, sync resumes the next time you open
it. For most use cases this is fine — you'll re-open the app within
minutes.

Internals: see [`../technical/offline-queue.md`](../technical/offline-queue.md).

## What happens on failure

For each queued entry, the service worker:

1. POSTs `/api/fuelup` with the saved JSON body.
2. On HTTP 2xx, marks the entry `synced`.
3. On HTTP 4xx, marks the entry `failed`. It will not be retried.
4. On HTTP 5xx, leaves the entry `queued` and moves to the next one. It
   will be retried on the next sync trigger. This **does** consume one of
   the 5 attempts — the server was reached and answered.
5. On a network error or DNS failure (the request never reached a
   server), leaves the entry `queued` **without** consuming an attempt.
   Being offline never costs delivery attempts — only real server
   responses do, so resuming the app any number of times during one
   offline stretch can't wear an entry out.

Once `attempts` reaches **5**, the entry is marked `failed` with
`error: max attempts` on the next sync, so it's visible on the History
page instead of sitting in the queue forever. This protects against an
entry the server keeps answering with errors the 4xx path doesn't catch.

If you find a row at `status: failed · error: max attempts`, the
simplest recovery is:

- Open the form on a working network.
- Look at the row's volume/cost values.
- Submit a fresh entry manually.
- (Optional) clear the dead row from the IndexedDB store using your
  browser's devtools.

### Failure UX in the form

The form does not retry on its own. If the POST returns a 4xx, you see
the **red** toast (`Submission rejected: {message}`) and the form fields
keep their values so you can fix the problem and try again.

## Cross-reference

For the storage schema (IndexedDB shape, `queued`/`failed`/`synced`
transitions, service-worker lifecycle), see
[`../technical/offline-queue.md`](../technical/offline-queue.md).
