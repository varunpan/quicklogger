import { openDB, type IDBPDatabase } from 'idb';
import type { FuelSubmissionInput, OdometerSubmissionInput } from '$lib/shared/types';

// 'queued' = pending replay; 'failed' = 4xx, won't retry; 'synced' = posted
// successfully, kept as local history for the offline-prefill resolver and
// pruned to the newest few per vehicle on each drain (pruneSynced).
// IndexedDB doesn't validate union values, so existing rows on upgrading
// devices stay intact.
export type QueueStatus = 'queued' | 'failed' | 'synced';

// Server-derived conversion snapshot, saved onto the row at sync time so
// /history can render the cross-currency unit price fully offline. NOT part
// of FuelSubmissionInput — it is not user input. See docs/technical/fillup-unit-price.md.
export interface ConvertedSnapshot {
  /** Converted total cost in the instance currency (server `submitted.cost`). */
  cost: number;
  /** Instance currency code at sync time. */
  currency: string;
}

export interface QueueEntry {
  id: number;
  input: FuelSubmissionInput;
  status: QueueStatus;
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
  converted?: ConvertedSnapshot;
  /**
   * Set when the replay POST came back `deduped: true` — the record was
   * already in LubeLogger, so the server skipped the write. Deliberately a
   * flag on a still-`'synced'` row rather than a fourth status value:
   * `pruneSynced` and the `byStatus` index both key on `'synced'`, so a new
   * status would silently exempt these rows from retention pruning. Optional,
   * so no IDB version bump is needed for existing rows. /history renders it as
   * a muted "Skipped" badge.
   */
  deduped?: boolean;
}

/** One odometer-only entry (`/odometer`). Lives in its own object store so
 *  the fuel queue's consumers (History pricing, offline odometer prefill,
 *  replay dedupe) never see a row without fuel fields. Same status machine
 *  and attempt budget as `QueueEntry`. See docs/technical/odometer-entry.md. */
export interface OdometerQueueEntry {
  id: number;
  input: OdometerSubmissionInput;
  status: QueueStatus;
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
  /** Display snapshot of the ticked equipment's names, so /history can label
   *  the row offline. Not part of the input — the server only takes ids. */
  equipmentNames?: string[];
  /** Same meaning as `QueueEntry.deduped`. */
  deduped?: boolean;
}

const STORE = 'pendingSubmissions';
const ODOMETER_STORE = 'pendingOdometer';

// v1: pendingSubmissions. v2 (#97): + pendingOdometer. Existing fuel rows are
// untouched by the upgrade — it only adds a store.
const DB_VERSION = 2;

interface DbSchema {
  pendingSubmissions: {
    key: number;
    value: Omit<QueueEntry, 'id'> & { id?: number };
    indexes: { byStatus: string };
  };
  pendingOdometer: {
    key: number;
    value: Omit<OdometerQueueEntry, 'id'> & { id?: number };
    indexes: { byStatus: string };
  };
}

function openQuickloggerDb(name: string): Promise<IDBPDatabase<DbSchema>> {
  return openDB<DbSchema>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('byStatus', 'status');
      }
      if (oldVersion < 2) {
        const store = db.createObjectStore(ODOMETER_STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('byStatus', 'status');
      }
    },
    // A newer build (page or SW) is upgrading the schema: let go so it isn't
    // blocked behind this connection. The next Queue.open() reconnects.
    blocking(_currentVersion, _blockedVersion, event) {
      (event.target as IDBDatabase).close();
    }
  });
}

export class Queue {
  static async open(name = 'quicklogger'): Promise<Queue> {
    return new Queue(await openQuickloggerDb(name));
  }

  private constructor(private readonly db: IDBPDatabase<DbSchema>) {}

  async enqueue(
    input: FuelSubmissionInput,
    status: QueueStatus = 'queued',
    converted?: ConvertedSnapshot
  ): Promise<number> {
    const entry: Omit<QueueEntry, 'id'> = { input, status, attempts: 0, enqueuedAt: Date.now() };
    if (converted) entry.converted = converted;
    return (await this.db.add(STORE, entry)) as number;
  }

  async list(): Promise<QueueEntry[]> {
    return (await this.db.getAll(STORE)) as QueueEntry[];
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(STORE, id);
  }

  async markFailed(id: number, error: string): Promise<void> {
    const entry = (await this.db.get(STORE, id)) as QueueEntry | undefined;
    if (!entry) return;
    entry.status = 'failed';
    entry.lastError = error;
    await this.db.put(STORE, entry);
  }

  async markSynced(id: number, converted?: ConvertedSnapshot, deduped?: boolean): Promise<void> {
    const entry = (await this.db.get(STORE, id)) as QueueEntry | undefined;
    if (!entry) return;
    entry.status = 'synced';
    if (converted) entry.converted = converted;
    // Only ever set, never cleared: an ordinary sync leaves the field absent
    // rather than writing `deduped: false` onto every row.
    if (deduped) entry.deduped = true;
    await this.db.put(STORE, entry);
  }

  async incrementAttempts(id: number): Promise<void> {
    const entry = (await this.db.get(STORE, id)) as QueueEntry | undefined;
    if (!entry) return;
    entry.attempts += 1;
    await this.db.put(STORE, entry);
  }

  async decrementAttempts(id: number): Promise<void> {
    const entry = (await this.db.get(STORE, id)) as QueueEntry | undefined;
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

/** Queue for odometer-only entries — the `/odometer` page's counterpart of
 *  `Queue`. Shares the `quicklogger` database (store `pendingOdometer`). */
export class OdometerQueue {
  static async open(name = 'quicklogger'): Promise<OdometerQueue> {
    return new OdometerQueue(await openQuickloggerDb(name));
  }

  private constructor(private readonly db: IDBPDatabase<DbSchema>) {}

  async enqueue(
    input: OdometerSubmissionInput,
    status: QueueStatus = 'queued',
    equipmentNames?: string[]
  ): Promise<number> {
    const entry: Omit<OdometerQueueEntry, 'id'> = {
      input,
      status,
      attempts: 0,
      enqueuedAt: Date.now()
    };
    if (equipmentNames && equipmentNames.length > 0) entry.equipmentNames = equipmentNames;
    return (await this.db.add(ODOMETER_STORE, entry)) as number;
  }

  async list(): Promise<OdometerQueueEntry[]> {
    return (await this.db.getAll(ODOMETER_STORE)) as OdometerQueueEntry[];
  }

  private async update(id: number, fn: (e: OdometerQueueEntry) => void): Promise<void> {
    const entry = (await this.db.get(ODOMETER_STORE, id)) as OdometerQueueEntry | undefined;
    if (!entry) return;
    fn(entry);
    await this.db.put(ODOMETER_STORE, entry);
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(ODOMETER_STORE, id);
  }

  markFailed(id: number, error: string): Promise<void> {
    return this.update(id, (e) => {
      e.status = 'failed';
      e.lastError = error;
    });
  }

  markSynced(id: number, deduped?: boolean): Promise<void> {
    return this.update(id, (e) => {
      e.status = 'synced';
      if (deduped) e.deduped = true;
    });
  }

  incrementAttempts(id: number): Promise<void> {
    return this.update(id, (e) => {
      e.attempts += 1;
    });
  }

  decrementAttempts(id: number): Promise<void> {
    return this.update(id, (e) => {
      e.attempts = Math.max(0, e.attempts - 1);
    });
  }

  /** Same retention rule as `Queue.pruneSynced`: newest `keepPerVehicle`
   *  'synced' rows per vehicle; 'queued' / 'failed' rows are never pruned. */
  async pruneSynced(keepPerVehicle: number): Promise<void> {
    const byVehicle = new Map<number, OdometerQueueEntry[]>();
    for (const e of await this.list()) {
      if (e.status !== 'synced') continue;
      const rows = byVehicle.get(e.input.vehicleId) ?? [];
      rows.push(e);
      byVehicle.set(e.input.vehicleId, rows);
    }
    for (const rows of byVehicle.values()) {
      rows.sort((a, b) => b.enqueuedAt - a.enqueuedAt || b.id - a.id);
      for (const stale of rows.slice(keepPerVehicle)) await this.remove(stale.id);
    }
  }
}
