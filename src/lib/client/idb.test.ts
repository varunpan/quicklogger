import { describe, it, expect, beforeEach } from 'vitest';
import { Queue } from './idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

const baseInput: FuelSubmissionInput = {
  vehicleId: 1, date: '2026-05-07', odometer: 87432, volume: 50,
  volumeUnit: 'L', cost: 65, currency: 'CAD',
  isFillToFull: true, missedFuelup: false,
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
});
