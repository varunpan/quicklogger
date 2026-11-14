import {
  Queue,
  OdometerQueue,
  type ConvertedSnapshot,
  type QueueEntry,
  type OdometerQueueEntry
} from './idb';
import { loadPrefs, DEFAULT_PREFS } from './prefs';
import type { FuelSubmissionInput, OdometerSubmissionInput } from '$lib/shared/types';

/**
 * Drain the offline submission queue: walk every `'queued'` entry and POST it
 * to `/api/fuelup`, transitioning each on the response (2xx → synced,
 * 4xx → failed, 5xx/network → left queued). Only definitive server responses
 * consume the 5-attempt budget — a pure network error (offline, DNS fail)
 * reverts the pre-fetch bump, so resume triggers firing while offline can't
 * strand an entry. An entry seen at the cap transitions to `'failed'` so it's
 * visible in History. See `docs/technical/offline-queue.md` for the full
 * state machine.
 *
 * `dbName` overrides the IndexedDB database name (tests only); production
 * always uses the default `Queue.open()` database.
 *
 * `historyKeepPerVehicle` bounds the synced-history trail kept per vehicle
 * (the rows the History page renders). This loop runs in the SERVICE WORKER,
 * which has no localStorage, so the page's `historyKeepPerVehicle` preference
 * rides in on the `sync-queue` message (sync-trigger.ts) rather than being
 * read here; `loadPrefs()` is only the window-context fallback (in the SW it
 * safely returns defaults). Garbage in either source falls back to the
 * default of 200.
 */
let syncing = false;

// Whole number ≥ 1, or null when the value is unusable.
function sanitizeKeep(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) && n >= 1 ? Math.floor(n) : null;
}

export async function syncQueue(dbName?: string, historyKeepPerVehicle?: number): Promise<void> {
  // In-flight guard. iOS fires `focus` + `visibilitychange` back-to-back, so
  // two `sync-queue` messages can arrive almost simultaneously. Without this,
  // both runs read the same `'queued'` entry (neither has marked it synced
  // yet) and POST it twice — a duplicate fuel record that only the server-side
  // idempotency window would otherwise have to catch. There's exactly one SW
  // instance, so a module-level flag is a sufficient lock.
  if (syncing) return;
  syncing = true;
  let q: Queue | null = null;
  let oq: OdometerQueue | null = null;
  try {
    q = await Queue.open(dbName);
    // Odometer readings live in their own database. If it can't be opened,
    // fill-ups still drain — one queue's storage trouble never blocks the other.
    oq = await OdometerQueue.open(dbName).catch(() => null);

    // Replay both queues in the order the entries were made, not fuel-first:
    // LubeLogger auto-inserts an odometer record for each fill-up, so
    // replaying a later fill-up ahead of an earlier odometer reading would
    // reorder the upstream odometer history. (The server also sends each
    // odometer record's trip start explicitly — see /api/odometer.)
    type Work =
      { kind: 'fuel'; entry: QueueEntry } | { kind: 'odometer'; entry: OdometerQueueEntry };
    const work: Work[] = [
      ...(await q.list()).map((entry) => ({ kind: 'fuel' as const, entry })),
      ...(oq ? await oq.list() : []).map((entry) => ({ kind: 'odometer' as const, entry }))
    ].filter((w) => w.entry.status === 'queued');
    work.sort((a, b) => a.entry.enqueuedAt - b.entry.enqueuedAt || a.entry.id - b.entry.id);

    for (const w of work) {
      if (w.kind === 'fuel') {
        const fq = q;
        // `queueReplay` marks EVERY replayed POST — not just attempts ≥ 1.
        // A queued entry's original foreground POST may have landed upstream
        // with the response lost in transit (the enqueue happens in the form's
        // network-error catch), so even a first-drain replay is potentially a
        // re-send. The server checks LubeLogger for an already-landed record
        // before writing (day-later dedupe — the in-memory idempotency window
        // is 60 s and wiped on restart). Added at POST time only; the stored
        // entry keeps the unmodified user payload.
        await replayEntry(
          fq,
          w.entry,
          '/api/fuelup',
          { ...w.entry.input, queueReplay: true } satisfies FuelSubmissionInput,
          async (res) => {
            // Save the converted snapshot from the response body so the
            // cross-currency unit price renders on /history. Both `cost` and
            // `currency` come from the body: this loop runs in the SERVICE WORKER,
            // which has no localStorage, so the instance currency MUST be carried
            // in the response rather than read from client config (issue #57).
            //
            // A missing/invalid body is non-fatal: the row still advances to
            // 'synced'; the converted half just stays absent. Both fields are
            // required — a body missing either one yields no snapshot rather than
            // a guessed currency.
            //
            // The same body carries `deduped: true` when the server found the
            // record already upstream and skipped the write (replay dedupe).
            // Without carrying that onto the row, a duplicate entry syncs to a
            // plain 'synced' row and /history shows two fill-ups for one real
            // record, permanently. Strict `=== true` — a truthy non-boolean
            // must not flag the row.
            let snapshot: ConvertedSnapshot | undefined;
            let deduped = false;
            try {
              const body = await res.json();
              const cost = body?.submitted?.cost;
              const currency = body?.submitted?.currency;
              if (typeof cost === 'number' && typeof currency === 'string') {
                snapshot = { cost, currency };
              }
              deduped = body?.deduped === true;
            } catch {
              // Non-JSON / empty body → advance status without a snapshot.
            }
            await fq.markSynced(w.entry.id, snapshot, deduped);
          }
        );
      } else if (oq) {
        const odq = oq;
        await replayEntry(
          odq,
          w.entry,
          '/api/odometer',
          { ...w.entry.input, queueReplay: true } satisfies OdometerSubmissionInput,
          async (res) => {
            let deduped = false;
            try {
              deduped = (await res.json())?.deduped === true;
            } catch {
              // Non-JSON / empty body → still synced, just not flagged.
            }
            await odq.markSynced(w.entry.id, deduped);
          }
        );
      }
    }
    // Bound the synced-history trail. The form's success path appends a
    // 'synced' row per submit, so without pruning every fillup ever made is
    // re-iterated on every drain. These rows ARE the History page's data,
    // so the bound is the user-facing "fill-ups kept per vehicle" setting
    // (default 200) — it was previously a hardcoded 5, which silently capped
    // History at 5 fill-ups per vehicle.
    const keep =
      sanitizeKeep(historyKeepPerVehicle) ??
      sanitizeKeep(loadPrefs().historyKeepPerVehicle) ??
      DEFAULT_PREFS.historyKeepPerVehicle;
    await q.pruneSynced(keep);
    if (oq) await oq.pruneSynced(keep);
  } finally {
    q?.close();
    oq?.close();
    syncing = false;
  }
}

/** The queue operations a replay needs — satisfied by `Queue` and `OdometerQueue`. */
interface ReplayQueue {
  markFailed(id: number, error: string): Promise<void>;
  incrementAttempts(id: number): Promise<void>;
  decrementAttempts(id: number): Promise<void>;
}

/**
 * Replay one queued entry and transition it on the response — the state
 * machine both queues share (docs/technical/offline-queue.md):
 * 2xx → `onSuccess` (marks synced), 4xx → failed, 5xx → left queued,
 * network error → attempt reverted, 5-attempt cap → dead-lettered as failed.
 */
async function replayEntry(
  q: ReplayQueue,
  entry: { id: number; attempts: number },
  url: string,
  body: unknown,
  onSuccess: (res: Response) => Promise<void>
): Promise<void> {
  if (entry.attempts >= 5) {
    // Dead-letter the capped entry instead of skipping it: a silently
    // skipped row reads 'queued' forever but never replays — invisible
    // to both the UI and the user. 'failed' surfaces it in History.
    await q.markFailed(entry.id, 'max attempts');
    return;
  }
  await q.incrementAttempts(entry.id);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      await onSuccess(res);
    } else if (res.status >= 400 && res.status < 500) {
      await q.markFailed(entry.id, `${res.status}`);
    }
    // else: leave queued for next sync
  } catch (_err) {
    // The request never reached a server, so it must not consume replay
    // budget: iOS fires focus + visibilitychange on every resume, and one
    // offline stretch with a few lock/unlock cycles would otherwise burn
    // all 5 attempts without a single byte leaving the device. The bump
    // stays pre-fetch (a POST that kills the SW mid-flight still advances
    // the counter — crash-loop protection); only a caught throw reverts.
    await q.decrementAttempts(entry.id);
  }
}
