import { Queue } from './idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

/**
 * Drain the offline submission queue: walk every `'queued'` entry and POST it
 * to `/api/fuelup`, transitioning each on the response (2xx → synced,
 * 4xx → failed, 5xx/network → left queued). The attempt counter is bumped
 * before the fetch so a permanently stuck entry eventually trips the `>= 5`
 * cap. See `docs/technical/offline-queue.md` for the full state machine.
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
      if (entry.attempts >= 5) continue;
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
        // network still down, leave queued
      }
    }
  } finally {
    syncing = false;
  }
}
