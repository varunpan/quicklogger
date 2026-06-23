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

  it('does not consume an attempt on a network error (entry stays queued)', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);
    await syncQueue(dbName); // a second offline resume must not advance the counter either

    const [entry] = await q.list();
    expect(entry.status).toBe('queued');
    expect(entry.attempts).toBe(0);
  });

  it('transitions a capped entry to failed instead of silently skipping it', async () => {
    const q = await Queue.open(dbName);
    const id = await q.enqueue(baseInput);
    for (let i = 0; i < 5; i++) await q.incrementAttempts(id);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    expect(fetchMock).not.toHaveBeenCalled();
    const [entry] = await q.list();
    expect(entry.status).toBe('failed');
    expect(entry.lastError).toBe('max attempts');
  });

  it('continues to the next entry after a 4xx on the first', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    await q.enqueue({ ...baseInput, clientSubmissionId: '00000000-0000-0000-0000-000000000002' });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('bad', { status: 422 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const entries = await q.list();
    expect(entries.map((e) => e.status)).toEqual(['failed', 'synced']);
  });

  it('prunes synced rows to the newest 5 per vehicle, leaving other statuses alone', async () => {
    const q = await Queue.open(dbName);
    for (let i = 0; i < 7; i++) await q.enqueue(baseInput, 'synced'); // vehicle 1
    await q.enqueue({ ...baseInput, vehicleId: 2 }, 'synced');
    const failedId = await q.enqueue(baseInput);
    await q.markFailed(failedId, '422');
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const entries = await q.list();
    const v1Synced = entries.filter((e) => e.status === 'synced' && e.input.vehicleId === 1);
    expect(v1Synced).toHaveLength(5);
    // Newest survive: ids auto-increment, so the first two enqueued are gone.
    expect(Math.min(...v1Synced.map((e) => e.id))).toBe(3);
    expect(entries.filter((e) => e.input.vehicleId === 2)).toHaveLength(1);
    expect(entries.filter((e) => e.status === 'failed')).toHaveLength(1);
  });

  it('persists the converted snapshot using the currency from the 2xx JSON body', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    // A non-USD instance currency: proves the snapshot reads `submitted.currency`
    // from the response body and is NOT the old 'USD' fallback. The service
    // worker has no localStorage, so the currency must come from the body — the
    // regression guard for issue #57.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, submitted: { gallons: 11.2, cost: 47.92, currency: 'CAD' } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
    expect(entry.converted).toEqual({ cost: 47.92, currency: 'CAD' });
  });

  it('omits the snapshot when the 2xx body has a cost but no currency', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    // Both cost and currency are required to build a snapshot; a body missing
    // currency advances the row to 'synced' without a converted half rather
    // than guessing the currency.
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ ok: true, submitted: { gallons: 11.2, cost: 47.92 } }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        )
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
    expect(entry.converted).toBeUndefined();
  });

  it('still syncs (no snapshot) when the 2xx body is not parseable', async () => {
    const q = await Queue.open(dbName);
    await q.enqueue(baseInput);
    globalThis.fetch = vi.fn(
      async () => new Response(null, { status: 200 })
    ) as unknown as typeof globalThis.fetch;

    await syncQueue(dbName);

    const [entry] = await q.list();
    expect(entry.status).toBe('synced');
    expect(entry.converted).toBeUndefined();
  });
});
