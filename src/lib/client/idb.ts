import { openDB, type IDBPDatabase } from 'idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

// 'queued' = pending replay; 'failed' = 4xx, won't retry; 'synced' = posted
// successfully, kept as local history for the offline-prefill resolver and
// pruned to the newest few per vehicle on each drain (pruneSynced).
// IndexedDB doesn't validate union values, so existing rows on upgrading
// devices stay intact.
export type QueueStatus = 'queued' | 'failed' | 'synced';

export interface QueueEntry {
  id: number;
  input: FuelSubmissionInput;
  status: QueueStatus;
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
}

const STORE = 'pendingSubmissions';

interface DbSchema {
  pendingSubmissions: {
    key: number;
    value: Omit<QueueEntry, 'id'> & { id?: number };
    indexes: { byStatus: string };
  };
}

export class Queue {
  static async open(name = 'quicklogger'): Promise<Queue> {
    const db = await openDB<DbSchema>(name, 1, {
      upgrade(db) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('byStatus', 'status');
      }
    });
    return new Queue(db);
  }

  private constructor(private readonly db: IDBPDatabase<DbSchema>) {}

  async enqueue(input: FuelSubmissionInput, status: QueueStatus = 'queued'): Promise<number> {
    const entry = { input, status, attempts: 0, enqueuedAt: Date.now() };
    return await this.db.add(STORE, entry) as number;
  }

  async list(): Promise<QueueEntry[]> {
    return await this.db.getAll(STORE) as QueueEntry[];
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(STORE, id);
  }

  async markFailed(id: number, error: string): Promise<void> {
    const entry = await this.db.get(STORE, id) as QueueEntry | undefined;
    if (!entry) return;
    entry.status = 'failed';
    entry.lastError = error;
    await this.db.put(STORE, entry);
  }

  async markSynced(id: number): Promise<void> {
    const entry = await this.db.get(STORE, id) as QueueEntry | undefined;
    if (!entry) return;
    entry.status = 'synced';
    await this.db.put(STORE, entry);
  }

  async incrementAttempts(id: number): Promise<void> {
    const entry = await this.db.get(STORE, id) as QueueEntry | undefined;
    if (!entry) return;
    entry.attempts += 1;
    await this.db.put(STORE, entry);
  }

  async decrementAttempts(id: number): Promise<void> {
    const entry = await this.db.get(STORE, id) as QueueEntry | undefined;
    if (!entry) return;
    entry.attempts = Math.max(0, entry.attempts - 1);
    await this.db.put(STORE, entry);
  }

  /**
   * Delete all but the newest `keepPerVehicle` 'synced' rows per vehicle.
   * The offline-prefill resolver only ever consumes the newest synced row
   * for a vehicle, so older ones are dead weight that `syncQueue` would
   * otherwise iterate forever. 'queued' and 'failed' rows are never pruned.
   */
  async pruneSynced(keepPerVehicle: number): Promise<void> {
    const all = await this.list();
    const byVehicle = new Map<number, QueueEntry[]>();
    for (const e of all) {
      if (e.status !== 'synced') continue;
      const rows = byVehicle.get(e.input.vehicleId) ?? [];
      rows.push(e);
      byVehicle.set(e.input.vehicleId, rows);
    }
    for (const rows of byVehicle.values()) {
      // Same-ms enqueuedAt ties are broken by id (auto-increment ⇒ insertion order).
      rows.sort((a, b) => b.enqueuedAt - a.enqueuedAt || b.id - a.id);
      for (const stale of rows.slice(keepPerVehicle)) await this.remove(stale.id);
    }
  }
}
