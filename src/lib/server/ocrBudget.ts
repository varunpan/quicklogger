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
