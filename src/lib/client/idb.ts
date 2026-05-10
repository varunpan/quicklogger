import { openDB, type IDBPDatabase } from 'idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

// 'queued' = pending replay; 'failed' = 4xx, won't retry; 'synced' = posted
// successfully, kept as permanent local history (used by the offline-prefill
// resolver). IndexedDB doesn't validate union values, so existing rows on
// upgrading devices stay intact.
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
}
