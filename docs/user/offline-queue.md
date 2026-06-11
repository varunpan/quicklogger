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

After you tap **Log fillup**, one of three toasts appears at the bottom of
the form:

| Toast colour | Text | What it means |
| --- | --- | --- |
| Green | `Logged: {N.NN} Gal · $X.XX` | Posted to LubeLogger successfully. The numbers are the converted, server-side values (so you can sanity-check FX). |
| Amber | `Saved locally — will sync when online` | The network call failed (offline, server down, DNS not resolving). Your submission is in the device queue and will replay automatically. |
| Red | `Submission rejected: {message}` | The submission got a 4xx — either quicklogger's own validation (missing field, bad value, unknown currency/unit) or LubeLogger rejecting it. The submission is **not** queued; fix it and resubmit. |

The form does not need to know in advance whether you are offline. It
always tries the POST first and falls back to the queue on network or 5xx
failure.

## The History page — what queued submissions look like

Open the drawer → **History**. If you have anything pending, you will see
a **Pending sync** section at the top with one card per submission:

        11.2 gal · USD 42.18
        status: queued · attempts: 0

Each card shows the volume, currency, cost, and two status fields:

- **`status`** — one of:
  - `queued` — waiting for the next sync run.
  - `failed` — won't retry. Two ways an entry gets here: the server
    rejected it permanently (HTTP 4xx), or it used up all 5 delivery
    attempts (shown as `error: max attempts`). To clear it, open the row
    in your browser's devtools → IndexedDB store and delete it, or accept
    that the entry won't reach LubeLogger.
  - `synced` — already posted successfully. The newest few (5 per vehicle)
    are kept as local history so the offline odometer prefill has something
    to fall back on (see [`odometer-prefill.md`](odometer-prefill.md));
    older ones are cleaned up automatically.
- **`attempts`** — how many times a POST actually reached your server.
  Tries that fail because you're offline don't count. Caps at 5 (see
  "What happens on failure" below).

If the last attempt errored, an `error: ...` line is also shown.

Below the Pending sync block, **Last fillup on LubeLogger** shows the
freshest record fetched from the server as raw JSON — useful for confirming
that a previous submission really did land upstream.

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
