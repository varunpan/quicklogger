import { readFile } from 'node:fs/promises';
import { atomicWriteFile, withPathLock } from './atomicFile';
import type { Logger } from './logger';

const NOOP_LOGGER: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child() { return this; }
};

export interface BudgetEntry {
  date: string;        // YYYY-MM-DD (UTC)
  calls: number;
  costCents: number;
}

export interface BudgetStore {
  load(): Promise<BudgetEntry | null>;
  /**
   * Atomically read-modify-write the entry. `mutator` receives the freshly
   * loaded state (re-read inside a per-path lock), so concurrent callers can't
   * each save a stale snapshot and under-count the day's spend.
   */
  update(mutator: (cur: BudgetEntry | null) => BudgetEntry): Promise<void>;
}

interface Options {
  dailyUsd: number;
  store: BudgetStore;
  logger?: Logger;
}

function utcDateStamp(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/**
 * Daily OCR spend tracker. The cap it enforces is **advisory / best-effort, not
 * a hard guarantee** (review #29). Three properties let real spend exceed
 * `dailyUsd`:
 *
 *  1. **TOCTOU.** `check()` reads outside the per-path lock and `add()` only
 *     lands after the multi-second provider call, so N concurrent requests can
 *     all pass `check()` before any `add()` is written — overshoot up to
 *     (N−1)×cost.
 *  2. **Strict `>`.** The request that crosses the cap is itself allowed; only
 *     the next one is refused.
 *  3. **Fail-open on write failure.** `add()` swallows write errors, so a
 *     persistently unwritable `/data` silently stops the tally and the cap
 *     never trips again.
 *
 * This is deliberate. At ~0.006¢/call behind the 20/hr upstream rate limit,
 * worst-case overshoot is cents. A hard cap (atomic check-and-reserve before
 * the provider call, refund on failure, `>=`, fail-closed on write failure)
 * was scoped and rejected as not worth the concurrency complexity for that
 * exposure. Note the on-disk increment itself IS race-safe — `add()` runs the
 * read-modify-write under `update()`'s per-path lock (review #4); only the cap
 * *decision* is soft.
 */
export class OcrBudget {
  private readonly log: Logger;
  constructor(private readonly opts: Options) {
    this.log = opts.logger ?? NOOP_LOGGER;
  }

  async check(): Promise<{ ok: true } | { ok: false }> {
    const today = utcDateStamp();
    let cur: BudgetEntry | null;
    try {
      cur = await this.opts.store.load();
    } catch (err) {
      this.log.warn('ocr budget read failed', { err });
      cur = null;
    }
    if (!cur || cur.date !== today) return { ok: true };
    if (cur.costCents > this.opts.dailyUsd * 100) return { ok: false };
    return { ok: true };
  }

  async add(costCents: number): Promise<void> {
    const today = utcDateStamp();
    try {
      // The load happens inside `update`'s per-path lock, so the increment is
      // computed against the freshest on-disk tally — concurrent adds queue
      // instead of clobbering each other.
      await this.opts.store.update((cur) =>
        !cur || cur.date !== today
          ? { date: today, calls: 1, costCents }
          : { date: today, calls: cur.calls + 1, costCents: cur.costCents + costCents }
      );
    } catch (err) {
      this.log.error('ocr budget write failed', { err });
    }
  }
}

export class JsonFileBudgetStore implements BudgetStore {
  constructor(private readonly path: string) {}
  async load(): Promise<BudgetEntry | null> {
    try {
      const buf = await readFile(this.path, 'utf-8');
      return JSON.parse(buf) as BudgetEntry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }
  async update(mutator: (cur: BudgetEntry | null) => BudgetEntry): Promise<void> {
    await withPathLock(this.path, async () => {
      let cur: BudgetEntry | null;
      try {
        cur = await this.load();
      } catch {
        // A corrupt/unparseable file self-heals by being overwritten with a
        // fresh entry — same recovery the FX cache gets from CurrencyService.
        cur = null;
      }
      await atomicWriteFile(this.path, JSON.stringify(mutator(cur)));
    });
  }
}
