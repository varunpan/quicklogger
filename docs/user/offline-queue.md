# Offline queue

quicklogger is a PWA — the form keeps working when your phone has no
signal. Submissions made offline are saved on the device and posted to
LubeLogger automatically the next time the app can reach the network.
You will encounter the queue most often at the pump (no service, parking
garage) or when your LubeLogger host is briefly unreachable.

## Submitting offline — what you see on the form

After you tap **Log fillup**, one of three toasts appears at the bottom of
the form:

| Toast colour | Text | What it means |
| --- | --- | --- |
| Green | `Logged: {N.NN} Gal · $X.XX` | Posted to LubeLogger successfully. The numbers are the converted, server-side values (so you can sanity-check FX). |
| Amber | `Saved locally — will sync when online` | The network call failed (offline, server down, DNS not resolving). Your submission is in the device queue and will replay automatically. |
| Red | `Submission rejected: {message}` | LubeLogger answered with a 4xx — typically validation (missing field, bad value). The submission is **not** queued; fix it and resubmit. |

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
  - `failed` — the server rejected it permanently (HTTP 4xx). It will
    not retry. To clear it, open the row in your browser's devtools →
    IndexedDB store and delete it, or accept that the entry won't reach
    LubeLogger.
  - `synced` — already posted successfully. These are kept as local history
    so the offline odometer prefill has something to fall back on (see
    [`odometer-prefill.md`](odometer-prefill.md)).
- **`attempts`** — how many times the service worker has tried to POST it.
  Caps at 5 (see "What happens on failure" below).

If the last attempt errored, an `error: ...` line is also shown.

Below the Pending sync block, **Last fillup on LubeLogger** shows the
freshest record fetched from the server as raw JSON — useful for confirming
that a previous submission really did land upstream.

## When does sync run?

The app tries to drain the queue every time you **open** or **refocus**
it. That's it — there is no background sync, and nothing happens while
the tab is closed. If you close the tab/PWA, sync resumes the next time
you open it. For most use cases this is fine — you'll re-open the app
within minutes.

Internals: see [`../technical/offline-queue.md`](../technical/offline-queue.md).

## What happens on failure

For each queued entry, the service worker:

1. Increments `attempts`.
2. POSTs `/api/fuelup` with the saved JSON body.
3. On HTTP 2xx, marks the entry `synced`.
4. On HTTP 4xx, marks the entry `failed`. It will not be retried.
5. On HTTP 5xx, network error, or DNS failure, leaves the entry `queued`
   and moves to the next one. It will be retried on the next sync trigger.

Once `attempts` reaches **5**, the entry is skipped on subsequent syncs
even if its status is still `queued`. This protects against an entry that
keeps failing in a way the 4xx path doesn't catch (e.g. CORS bug,
intermittent network).

If a row gets stuck at `attempts: 5 · status: queued`, the simplest
recovery is:

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
