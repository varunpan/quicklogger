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

/** One odometer-only entry (`/odometer`). Same row shape and status machine
 *  as `QueueEntry`, minus the fuel-only `converted` snapshot, plus a display
 *  snapshot of the ticked equipment's names. See docs/technical/odometer-entry.md. */
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

/** Fields every queue row shares — what the generic queue operations touch. */
interface BaseEntry {
  id: number;
  input: { vehicleId: number };
  status: QueueStatus;
  attempts: number;
  enqueuedAt: number;
  lastError?: string;
  deduped?: boolean;
}

const STORE = 'pendingSubmissions';

/**
 * Odometer readings live in their OWN database (`<name>-odometer`, version 1)
 * rather than a second store in `quicklogger`. Adding a store to `quicklogger`
 * would need a version bump, and every v1 connection already in the wild (an
 * old-build tab, the outgoing SW) never closes, so the upgrade could block
 * indefinitely — hanging both queues. A separate database never upgrades the
 * fuel one, so the two can't block each other.
 */
export const ODOMETER_DB_SUFFIX = '-odometer';

/** Open (creating on first use) a one-store, version-1 queue database. */
function openQueueDb(name: string, store: string): Promise<IDBPDatabase> {
  return openDB(name, 1, {
    upgrade(db) {
      const s = db.createObjectStore(store, { keyPath: 'id', autoIncrement: true });
      s.createIndex('byStatus', 'status');
    }
  });
}

/** The operations both queues share — one implementation, so a fix to attempt
 *  counting, dead-lettering or retention reaches fuel and odometer alike. */
class RecordQueue<E extends BaseEntry> {
  protected constructor(
    protected readonly db: IDBPDatabase,
    protected readonly store: string
  ) {}

  protected async add(entry: Omit<E, 'id'>): Promise<number> {
    return (await this.db.add(this.store, entry)) as number;
  }

  protected async update(id: number, fn: (e: E) => void): Promise<void> {
    const entry = (await this.db.get(this.store, id)) as E | undefined;
    if (!entry) return;
    fn(entry);
    await this.db.put(this.store, entry);
  }

  async list(): Promise<E[]> {
    return (await this.db.getAll(this.store)) as E[];
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(this.store, id);
  }

  markFailed(id: number, error: string): Promise<void> {
    return this.update(id, (e) => {
      e.status = 'failed';
      e.lastError = error;
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

  /** Release the connection. Callers that open a queue for one read or one
   *  drain close it afterwards so connections don't pile up. */
  close(): void {
    this.db.close();
  }

  /**
   * Delete all but the newest `keepPerVehicle` 'synced' rows per vehicle.
   * The offline-prefill resolver only ever consumes the newest synced row
   * for a vehicle, so older ones are dead weight that `syncQueue` would
   * otherwise iterate forever. 'queued' and 'failed' rows are never pruned.
   */
  async pruneSynced(keepPerVehicle: number): Promise<void> {
    const all = await this.list();
    const byVehicle = new Map<number, E[]>();
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

export class Queue extends RecordQueue<QueueEntry> {
  static async open(name = 'quicklogger'): Promise<Queue> {
    return new Queue(await openQueueDb(name, STORE), STORE);
  }

  enqueue(
    input: FuelSubmissionInput,
    status: QueueStatus = 'queued',
    converted?: ConvertedSnapshot
  ): Promise<number> {
    const entry: Omit<QueueEntry, 'id'> = { input, status, attempts: 0, enqueuedAt: Date.now() };
    if (converted) entry.converted = converted;
    return this.add(entry);
  }

  markSynced(id: number, converted?: ConvertedSnapshot, deduped?: boolean): Promise<void> {
    return this.update(id, (e) => {
      e.status = 'synced';
      if (converted) e.converted = converted;
      // Only ever set, never cleared: an ordinary sync leaves the field absent
      // rather than writing `deduped: false` onto every row.
      if (deduped) e.deduped = true;
    });
  }
}

/** Queue for odometer-only readings — `Queue`'s counterpart for `/odometer`,
 *  in its own database (see ODOMETER_DB_SUFFIX). */
export class OdometerQueue extends RecordQueue<OdometerQueueEntry> {
  static readonly STORE = 'pendingOdometer';

  /** `name` is the base database name (default `quicklogger`); the odometer
   *  database is `<name>-odometer`. */
  static async open(name = 'quicklogger'): Promise<OdometerQueue> {
    return new OdometerQueue(
      await openQueueDb(`${name}${ODOMETER_DB_SUFFIX}`, OdometerQueue.STORE),
      OdometerQueue.STORE
    );
  }

  enqueue(
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
    return this.add(entry);
  }

  markSynced(id: number, deduped?: boolean): Promise<void> {
    return this.update(id, (e) => {
      e.status = 'synced';
      if (deduped) e.deduped = true;
    });
  }
}
