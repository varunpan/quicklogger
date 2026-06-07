import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Queue } from './idb';
import { syncQueue } from './sync-queue';
import type { FuelSubmissionInput } from '$lib/shared/types';

const baseInput: FuelSubmissionInput = {
  vehicleId: 1, date: '2026-05-07', odometer: 87432, volume: 50,
  volumeUnit: 'L', cost: 65, currency: 'CAD',
  isFillToFull: true, missedFuelup: false,
  clientSubmissionId: '00000000-0000-0000-0000-000000000001'
};

describe('syncQueue', () => {
  let dbName: string;
  let realFetch: typeof globalThis.fetch;

  beforeEach(() => {
    dbName = `sync-${Math.random()}`;
    realFetch = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('replays a queued entry once and marks it synced on a 2xx', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
  });

  it('does not replay the same entry twice when triggered concurrently', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    // Hold each replay in-flight so a second, concurrent run would overlap it
    // (the iOS focus + visibilitychange double-fire) if nothing guarded it.
    const fetchMock = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 10));
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await Promise.all([syncQueue(dbName), syncQueue(dbName)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const synced = (await q.list()).filter((e) => e.status === 'synced');
    expect(synced).toHaveLength(1);
  });

  it('marks an entry failed on a 4xx', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    globalThis.fetch = vi.fn(
      async () => new Response('bad', { status: 422 })
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const [entry] = await q.list();
    expect(entry.status).toBe('failed');
    expect(entry.lastError).toBe('422');
  });

  it('leaves an entry queued on a 5xx for the next trigger', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    globalThis.fetch = vi.fn(
      async () => new Response('boom', { status: 503 })
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const [entry] = await q.list();
    expect(entry.status).toBe('queued');
    expect(entry.attempts).toBe(1);
  });
});
