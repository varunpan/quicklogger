import { describe, it, expect, beforeEach } from 'vitest';
import { resolveOfflineLastFillup, lastFuelupCacheKey } from './last-fillup';
import { Queue } from './idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

function baseInput(overrides: Partial<FuelSubmissionInput> = {}): FuelSubmissionInput {
  return {
    vehicleId: 1,
    date: '2026-05-07',
    odometer: 87432,
    volume: 11.2,
    volumeUnit: 'gal',
    cost: 42.18,
    currency: 'USD',
    isFillToFull: true,
    missedFuelup: false,
    clientSubmissionId: '00000000-0000-0000-0000-000000000001',
    ...overrides
  };
}

function seedCache(vehicleId: number, snapshot: Record<string, unknown>) {
  localStorage.setItem(lastFuelupCacheKey(vehicleId), JSON.stringify(snapshot));
}

let q: Queue;

beforeEach(async () => {
  localStorage.clear();
  q = await Queue.open(`q-resolver-${Math.random()}`);
});

describe('resolveOfflineLastFillup', () => {
  it('returns null when cache and queue are empty', async () => {
    expect(await resolveOfflineLastFillup(1, q)).toBeNull();
  });

  it('returns the cached upstream snapshot when only the cache has data', async () => {
    seedCache(1, {
      id: '999', vehicleId: '1', date: '5/3/2026', odometer: '87234',
      fuelConsumed: '10.8', cost: '39.42', notes: 'Costco'
    });
    const got = await resolveOfflineLastFillup(1, q);
    expect(got).not.toBeNull();
    expect(got!.date).toBe('5/3/2026');
    expect(got!.odometer).toBe('87234');
    expect(got!.fuelConsumed).toBe('10.8');
    expect(got!.cost).toBe('39.42');
    expect(got!.costCurrency).toBeNull();
    expect(got!.notes).toBe('Costco');
  });

  it('returns the freshest queue entry when only the queue has data', async () => {
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got).not.toBeNull();
    expect(got!.date).toBe('5/8/2026');
    expect(got!.odometer).toBe('87800');
    expect(got!.costCurrency).toBe('USD');
  });

  it('picks queue entry when its date is newer than the cache', async () => {
    seedCache(1, { id: '999', vehicleId: '1', date: '5/3/2026', odometer: '87234', fuelConsumed: '10.8' });
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.odometer).toBe('87800');
  });

  it('picks cache when its date is newer than queue entries', async () => {
    seedCache(1, { id: '999', vehicleId: '1', date: '5/9/2026', odometer: '88100', fuelConsumed: '11.0' });
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.odometer).toBe('88100');
  });

  it('on tied date prefers the most recently enqueued entry', async () => {
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87700 }), 'synced');
    await new Promise((r) => setTimeout(r, 5));
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87750 }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.odometer).toBe('87750');
  });

  it('scopes to the requested vehicle', async () => {
    seedCache(1, { id: '999', vehicleId: '1', date: '5/9/2026', odometer: '88100', fuelConsumed: '11.0' });
    seedCache(2, { id: '888', vehicleId: '2', date: '5/9/2026', odometer: '20000', fuelConsumed: '8.0' });
    await q.enqueue(baseInput({ vehicleId: 2, date: '2026-05-10', odometer: 20100 }), 'synced');
    const got1 = await resolveOfflineLastFillup(1, q);
    const got2 = await resolveOfflineLastFillup(2, q);
    expect(got1!.odometer).toBe('88100');
    expect(got2!.odometer).toBe('20100');
  });

  it('skips queue entries with status "failed"', async () => {
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }), 'failed');
    expect(await resolveOfflineLastFillup(1, q)).toBeNull();
  });

  it('includes queue entries with status "queued"', async () => {
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }));
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.odometer).toBe('87800');
  });

  it('converts queue volume from L to gallons', async () => {
    await q.enqueue(baseInput({ volume: 50, volumeUnit: 'L', date: '2026-05-08' }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(Number(got!.fuelConsumed)).toBeCloseTo(13.21, 1);
  });

  it('formats queue cost as a 2-decimal string', async () => {
    await q.enqueue(baseInput({ cost: 60, currency: 'CAD', date: '2026-05-08' }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.cost).toBe('60.00');
    expect(got!.costCurrency).toBe('CAD');
  });

  it('converts queue ISO date to M/D/YYYY', async () => {
    await q.enqueue(baseInput({ date: '2026-05-08', odometer: 87800 }), 'synced');
    const got = await resolveOfflineLastFillup(1, q);
    expect(got!.date).toBe('5/8/2026');
  });

  it('returns null when localStorage parse fails and queue is empty', async () => {
    localStorage.setItem(lastFuelupCacheKey(1), 'not-json{{{');
    expect(await resolveOfflineLastFillup(1, q)).toBeNull();
  });

  it('lastFuelupCacheKey includes the vehicle id', () => {
    expect(lastFuelupCacheKey(42)).toBe('quicklogger.lastFuelup.42');
  });
});
