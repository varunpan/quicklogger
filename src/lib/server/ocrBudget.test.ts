import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BudgetStore, BudgetEntry } from './ocrBudget';
import { OcrBudget, JsonFileBudgetStore } from './ocrBudget';
import type { Logger } from './logger';

type LogCall = { level: string; msg: string; ctx: Record<string, unknown> };

function captureLogger(): { logger: Logger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const log = (level: string) => (msg: string, ctx?: Record<string, unknown>) =>
    void calls.push({ level, msg, ctx: ctx ?? {} });
  const logger = {
    debug: log('debug'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    child() { return this; }
  } as unknown as Logger;
  return { logger, calls };
}

function inMemoryStore(initial?: BudgetEntry | null): BudgetStore {
  let data = initial ?? null;
  return {
    async load() { return data; },
    async update(mutator) { data = mutator(data); }
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

  it('logs a warn and proceeds when the store read fails on check()', async () => {
    const { logger, calls } = captureLogger();
    const store: BudgetStore = {
      async load() { throw new Error('disk gone'); },
      async update() {}
    };
    const b = new OcrBudget({ dailyUsd: 1.0, store, logger });
    await expect(b.check()).resolves.toEqual({ ok: true });
    expect(
      calls.some((c) => c.level === 'warn' && c.msg === 'ocr budget read failed')
    ).toBe(true);
  });

  it('logs an error and swallows when the store write fails on add()', async () => {
    const { logger, calls } = captureLogger();
    const store: BudgetStore = {
      async load() { return null; },
      async update() { throw new Error('disk full'); }
    };
    const b = new OcrBudget({ dailyUsd: 1.0, store, logger });
    await expect(b.add(0.6)).resolves.toBeUndefined();
    expect(
      calls.some((c) => c.level === 'error' && c.msg === 'ocr budget write failed')
    ).toBe(true);
  });
});

describe('OcrBudget — concurrency (real file store)', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ocr-budget-'));
    path = join(dir, 'ocr-budget.json');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('does not under-count when many add() land at once', async () => {
    // The bug: load → mutate → save with no lock. Concurrent adds all read the
    // same snapshot, so the cap can be overshot. The locked read-modify-write
    // must count every call exactly.
    const store = new JsonFileBudgetStore(path);
    const b = new OcrBudget({ dailyUsd: 1000, store });
    const N = 25;
    await Promise.all(Array.from({ length: N }, () => b.add(1)));
    const loaded = await store.load();
    expect(loaded?.calls).toBe(N);
    expect(loaded?.costCents).toBeCloseTo(N, 5);
  });
});
