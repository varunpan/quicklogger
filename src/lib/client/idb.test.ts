import { describe, it, expect, beforeEach } from 'vitest';
import { openDB } from 'idb';
import { Queue, OdometerQueue, ODOMETER_DB_SUFFIX } from './idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

const baseInput: FuelSubmissionInput = {
  vehicleId: 1,
  date: '2026-05-07',
  odometer: 87432,
  volume: 50,
  volumeUnit: 'L',
  cost: 65,
  currency: 'CAD',
  isFillToFull: true,
  missedFuelup: false,
  clientSubmissionId: '00000000-0000-0000-0000-000000000001'
};

describe('Queue', () => {
  let q: Queue;
  beforeEach(async () => {
    q = await Queue.open(`q-${Math.random()}`);
  });

  it('enqueues and lists pending submissions', async () => {
    await q.enqueue(baseInput);
    const all = await q.list();
    expect(all).toHaveLength(1);
    expect(all[0].input.clientSubmissionId).toBe(baseInput.clientSubmissionId);
    expect(all[0].status).toBe('queued');
    expect(all[0].attempts).toBe(0);
  });

  it('removes by id after success', async () => {
    await q.enqueue(baseInput);
    const [entry] = await q.list();
    await q.remove(entry.id);
    expect(await q.list()).toHaveLength(0);
  });

  it('marks an entry failed', async () => {
    await q.enqueue(baseInput);
    const [entry] = await q.list();
    await q.markFailed(entry.id, 'lubelogger 422 odometer');
    const [after] = await q.list();
    expect(after.status).toBe('failed');
    expect(after.lastError).toBe('lubelogger 422 odometer');
  });

  it('increments attempts', async () => {
    await q.enqueue(baseInput);
    const [entry] = await q.list();
    await q.incrementAttempts(entry.id);
    await q.incrementAttempts(entry.id);
    const [after] = await q.list();
    expect(after.attempts).toBe(2);
  });

  it('marks an entry synced', async () => {
    await q.enqueue(baseInput);
    const [entry] = await q.list();
    await q.markSynced(entry.id);
    const [after] = await q.list();
    expect(after.status).toBe('synced');
  });

  it('markSynced is a no-op for an unknown id', async () => {
    await q.markSynced(9999);
    expect(await q.list()).toHaveLength(0);
  });

  it('enqueue accepts an explicit status', async () => {
    await q.enqueue(baseInput, 'synced');
    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
  });

  it('enqueue defaults status to queued', async () => {
    await q.enqueue(baseInput);
    const [entry] = await q.list();
    expect(entry.status).toBe('queued');
  });

  it('enqueue persists a converted snapshot when provided', async () => {
    await q.enqueue(baseInput, 'synced', { cost: 47.92, currency: 'USD' });
    const [entry] = await q.list();
    expect(entry.converted).toEqual({ cost: 47.92, currency: 'USD' });
  });

  it('enqueue stores no converted field when the snapshot is omitted', async () => {
    await q.enqueue(baseInput, 'synced');
    const [entry] = await q.list();
    expect(entry.converted).toBeUndefined();
  });

  it('markSynced persists a converted snapshot when provided', async () => {
    const id = await q.enqueue(baseInput);
    await q.markSynced(id, { cost: 47.92, currency: 'USD' });
    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
    expect(entry.converted).toEqual({ cost: 47.92, currency: 'USD' });
  });

  it('markSynced without a snapshot leaves converted undefined', async () => {
    const id = await q.enqueue(baseInput);
    await q.markSynced(id);
    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
    expect(entry.converted).toBeUndefined();
  });

  it('markSynced flags a deduped replay while keeping the status synced', async () => {
    const id = await q.enqueue(baseInput);
    await q.markSynced(id, { cost: 47.92, currency: 'USD' }, true);
    const [entry] = await q.list();
    // 'synced' — NOT a new status value. pruneSynced and the byStatus index
    // both key on 'synced', so a 'deduped' status would silently exempt these
    // rows from retention pruning.
    expect(entry.status).toBe('synced');
    expect(entry.deduped).toBe(true);
    expect(entry.converted).toEqual({ cost: 47.92, currency: 'USD' });
  });

  it('markSynced leaves deduped undefined for an ordinary sync', async () => {
    const id = await q.enqueue(baseInput);
    await q.markSynced(id, { cost: 47.92, currency: 'USD' });
    const [entry] = await q.list();
    expect(entry.deduped).toBeUndefined();
  });

  it('a deduped row is still pruned by pruneSynced', async () => {
    // Regression guard for the status-vs-flag decision: rows carrying the
    // deduped marker must stay inside the retention bound.
    const older = await q.enqueue(baseInput, 'synced');
    const newer = await q.enqueue(baseInput, 'synced');
    await q.markSynced(older, undefined, true);
    await q.markSynced(newer, undefined, true);
    await q.pruneSynced(1);
    const rows = await q.list();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(newer);
  });
});

describe('OdometerQueue', () => {
  const odoInput = {
    vehicleId: 1,
    date: '2026-11-12',
    odometer: 45320,
    equipmentIds: [7],
    clientSubmissionId: 'odo-1'
  };
  let oq: OdometerQueue;
  beforeEach(async () => {
    oq = await OdometerQueue.open(`oq-${Math.random()}`);
  });

  it('enqueues with equipment names and lists', async () => {
    await oq.enqueue(odoInput, 'queued', ['Off-road trailer']);
    const [e] = await oq.list();
    expect(e.input).toEqual(odoInput);
    expect(e.status).toBe('queued');
    expect(e.attempts).toBe(0);
    expect(e.equipmentNames).toEqual(['Off-road trailer']);
  });

  it('omits equipmentNames when none were ticked', async () => {
    await oq.enqueue(odoInput, 'queued', []);
    const [e] = await oq.list();
    expect('equipmentNames' in e).toBe(false);
  });

  it('transitions failed / synced (+deduped) and counts attempts', async () => {
    const a = await oq.enqueue(odoInput);
    const b = await oq.enqueue({ ...odoInput, odometer: 45400 });
    await oq.incrementAttempts(a);
    await oq.incrementAttempts(a);
    await oq.decrementAttempts(a);
    await oq.markFailed(a, '400');
    await oq.markSynced(b, true);
    const rows = await oq.list();
    const ra = rows.find((r) => r.id === a)!;
    const rb = rows.find((r) => r.id === b)!;
    expect(ra).toMatchObject({ status: 'failed', lastError: '400', attempts: 1 });
    expect(rb).toMatchObject({ status: 'synced', deduped: true });
  });

  it('pruneSynced keeps the newest N synced rows per vehicle and never prunes queued', async () => {
    for (let i = 0; i < 4; i++) await oq.enqueue({ ...odoInput, odometer: 100 + i }, 'synced');
    await oq.enqueue({ ...odoInput, odometer: 999 });
    await oq.pruneSynced(2);
    const rows = await oq.list();
    expect(rows.filter((r) => r.status === 'synced').map((r) => r.input.odometer)).toEqual([
      102, 103
    ]);
    expect(rows.some((r) => r.status === 'queued')).toBe(true);
  });

  it('keeps odometer rows in their own database, apart from fuel rows', async () => {
    const name = `shared-${Math.random()}`;
    const q = await Queue.open(name);
    await q.enqueue(baseInput);
    const o = await OdometerQueue.open(name);
    await o.enqueue(odoInput);
    expect(await q.list()).toHaveLength(1);
    expect(await o.list()).toHaveLength(1);
    const dbs = (await indexedDB.databases()).map((d) => d.name);
    expect(dbs).toContain(name);
    expect(dbs).toContain(`${name}${ODOMETER_DB_SUFFIX}`);
  });

  it('never upgrades or blocks on an existing v1 fuel database (review #4)', async () => {
    const name = `v1-${Math.random()}`;
    // An old-build connection that is never closed — the case that would
    // block a version bump forever.
    const oldConnection = await openDB(name, 1, {
      upgrade(db) {
        const store = db.createObjectStore('pendingSubmissions', {
          keyPath: 'id',
          autoIncrement: true
        });
        store.createIndex('byStatus', 'status');
      }
    });
    await oldConnection.add('pendingSubmissions', {
      input: baseInput,
      status: 'queued',
      attempts: 0,
      enqueuedAt: 1
    });

    const o = await OdometerQueue.open(name);
    await o.enqueue(odoInput);
    expect(await o.list()).toHaveLength(1);
    const q = await Queue.open(name);
    expect(await q.list()).toHaveLength(1);
    expect(oldConnection.version).toBe(1);
    oldConnection.close();
  });

  it('close() releases the connection', async () => {
    const name = `close-${Math.random()}`;
    const o = await OdometerQueue.open(name);
    o.close();
    // A version change only succeeds once no connection holds the database.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(`${name}${ODOMETER_DB_SUFFIX}`, 2);
      req.onblocked = () => reject(new Error('blocked'));
      req.onsuccess = () => {
        req.result.close();
        resolve();
      };
      req.onerror = () => reject(req.error);
    });
  });
});
