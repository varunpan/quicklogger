import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BudgetStore, BudgetEntry } from './ocrBudget';
import { OcrBudget } from './ocrBudget';

function inMemoryStore(initial?: BudgetEntry | null): BudgetStore {
  let data = initial ?? null;
  return {
    async load() { return data; },
    async save(d) { data = { ...d }; }
  };
}

describe('OcrBudget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('check() returns ok when under cap', async () => {
    const b = new OcrBudget({ dailyUsd: 1.0, store: inMemoryStore() });
    await expect(b.check()).resolves.toEqual({ ok: true });
  });

  it('rolls over to a new day on a UTC date change', async () => {
    const store = inMemoryStore({ date: '2026-05-10', calls: 100, costCents: 99.5 });
    const b = new OcrBudget({ dailyUsd: 1.0, store });
    await expect(b.check()).resolves.toEqual({ ok: true });
  });

  it('check() returns over when costCents has passed dailyUsd*100', async () => {
    const store = inMemoryStore({ date: '2026-05-11', calls: 50, costCents: 100.5 });
    const b = new OcrBudget({ dailyUsd: 1.0, store });
    await expect(b.check()).resolves.toEqual({ ok: false });
  });

  it('add() persists incremental cost on the current day', async () => {
    const store = inMemoryStore();
    const b = new OcrBudget({ dailyUsd: 1.0, store });
    await b.add(0.6);
    await b.add(0.6);
    const loaded = await store.load();
    expect(loaded?.date).toBe('2026-05-11');
    expect(loaded?.calls).toBe(2);
    expect(loaded?.costCents).toBeCloseTo(1.2, 5);
  });

  it('add() resets the tally on a new UTC day', async () => {
    const store = inMemoryStore({ date: '2026-05-10', calls: 10, costCents: 50 });
    const b = new OcrBudget({ dailyUsd: 1.0, store });
    await b.add(0.6);
    const loaded = await store.load();
    expect(loaded?.date).toBe('2026-05-11');
    expect(loaded?.calls).toBe(1);
    expect(loaded?.costCents).toBeCloseTo(0.6, 5);
  });
});
