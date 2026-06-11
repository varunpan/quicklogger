import { Queue } from './idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

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
 */
let syncing = false;

export async function syncQueue(dbName?: string): Promise<void> {
  // In-flight guard. iOS fires `focus` + `visibilitychange` back-to-back, so
  // two `sync-queue` messages can arrive almost simultaneously. Without this,
  // both runs read the same `'queued'` entry (neither has marked it synced
  // yet) and POST it twice — a duplicate fuel record that only the server-side
  // idempotency window would otherwise have to catch. There's exactly one SW
  // instance, so a module-level flag is a sufficient lock.
  if (syncing) return;
  syncing = true;
  try {
    const q = await Queue.open(dbName);
    const all = await q.list();
    for (const entry of all) {
      if (entry.status !== 'queued') continue;
      if (entry.attempts >= 5) {
        // Dead-letter the capped entry instead of skipping it: a silently
        // skipped row reads 'queued' forever but never replays — invisible
        // to both the UI and the user. 'failed' surfaces it in History.
        await q.markFailed(entry.id, 'max attempts');
        continue;
      }
      await q.incrementAttempts(entry.id);
      try {
        const res = await fetch('/api/fuelup', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(entry.input satisfies FuelSubmissionInput)
        });
        if (res.ok) {
          await q.markSynced(entry.id);
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
  } finally {
    syncing = false;
  }
}
