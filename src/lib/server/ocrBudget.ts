import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

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
}

function utcDateStamp(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class OcrBudget {
  constructor(private readonly opts: Options) {}

  async check(): Promise<{ ok: true } | { ok: false }> {
    const today = utcDateStamp();
    const cur = await this.opts.store.load();
    if (!cur || cur.date !== today) return { ok: true };
    if (cur.costCents > this.opts.dailyUsd * 100) return { ok: false };
    return { ok: true };
  }

  async add(costCents: number): Promise<void> {
    const today = utcDateStamp();
    const cur = await this.opts.store.load();
    const next: BudgetEntry =
      !cur || cur.date !== today
        ? { date: today, calls: 1, costCents }
        : { date: today, calls: cur.calls + 1, costCents: cur.costCents + costCents };
    await this.opts.store.save(next);
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
