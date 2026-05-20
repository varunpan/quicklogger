import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
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
  save(entry: BudgetEntry): Promise<void>;
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
    let cur: BudgetEntry | null;
    try {
      cur = await this.opts.store.load();
    } catch (err) {
      this.log.warn('ocr budget read failed', { err });
      cur = null;
    }
    const next: BudgetEntry =
      !cur || cur.date !== today
        ? { date: today, calls: 1, costCents }
        : { date: today, calls: cur.calls + 1, costCents: cur.costCents + costCents };
    try {
      await this.opts.store.save(next);
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
  async save(entry: BudgetEntry): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(entry), 'utf-8');
  }
}
