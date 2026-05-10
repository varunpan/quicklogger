import { Queue } from './idb';

export type LastFillupSource = 'upstream' | 'offline' | null;

// Output shape mirrors upstream `GasRecord` so the page-side render path
// (formatOdometer, daysAgo, $cost rendering) works unchanged. `costCurrency`
// is the only addition: null for upstream-cached records (they're already
// FX-normalized server-side), the entered currency for queue-derived records
// (we don't FX offline). The page uses it to render "<currency> <cost>"
// instead of "$<cost>" when present.
export interface LastFillupRecord {
  date: string;          // M/D/YYYY (matches upstream)
  odometer: string;      // raw integer-string of miles
  fuelConsumed: string;  // gallons (always — queue L is converted)
  cost: string | null;
  costCurrency: string | null;
  notes: string | null;
}

const L_PER_GALLON = 3.785411784;

export function lastFuelupCacheKey(vehicleId: number): string {
  return `quicklogger.lastFuelup.${vehicleId}`;
}

interface InternalCandidate {
  record: LastFillupRecord;
  // Sortable timestamp for "freshest" pick. Day-precision; ties are broken
  // by `tiebreak` (queue entry's enqueuedAt for queue rows; 0 for cache).
  ts: number;
  tiebreak: number;
}

function parseMDY(s: string): number | null {
  const parts = s.split('/');
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  return new Date(y, m - 1, d).getTime();
}

function parseISO(s: string): number | null {
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(m) || !Number.isFinite(d) || !Number.isFinite(y)) return null;
  return new Date(y, m - 1, d).getTime();
}

function isoToMDY(iso: string): string {
  const parts = iso.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return iso;
  const [y, m, d] = parts;
  return `${m}/${d}/${y}`;
}

function readCacheCandidate(vehicleId: number): InternalCandidate | null {
  if (typeof localStorage === 'undefined') return null;
  let raw: string | null;
  try {
    raw = localStorage.getItem(lastFuelupCacheKey(vehicleId));
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const date = String(parsed.date ?? '');
  const odometer = String(parsed.odometer ?? '');
  const fuelConsumed = String(parsed.fuelConsumed ?? '');
  if (!date || !odometer) return null;
  const ts = parseMDY(date);
  if (ts === null) return null;
  return {
    record: {
      date,
      odometer,
      fuelConsumed,
      cost: parsed.cost == null ? null : String(parsed.cost),
      costCurrency: null,
      notes: parsed.notes == null ? null : String(parsed.notes)
    },
    ts,
    tiebreak: 0
  };
}

async function readQueueCandidates(
  vehicleId: number,
  q: Queue
): Promise<InternalCandidate[]> {
  let entries;
  try {
    entries = await q.list();
  } catch {
    return [];
  }
  const out: InternalCandidate[] = [];
  for (const entry of entries) {
    if (entry.status === 'failed') continue;
    if (entry.input.vehicleId !== vehicleId) continue;
    const ts = parseISO(entry.input.date);
    if (ts === null) continue;
    const gallons =
      entry.input.volumeUnit === 'gal'
        ? entry.input.volume
        : entry.input.volume / L_PER_GALLON;
    out.push({
      record: {
        date: isoToMDY(entry.input.date),
        odometer: String(Math.round(entry.input.odometer)),
        fuelConsumed: gallons.toFixed(2),
        cost: entry.input.cost.toFixed(2),
        costCurrency: entry.input.currency,
        notes: entry.input.notes ?? null
      },
      ts,
      tiebreak: entry.enqueuedAt
    });
  }
  return out;
}

export async function resolveOfflineLastFillup(
  vehicleId: number,
  queue?: Queue
): Promise<LastFillupRecord | null> {
  const q = queue ?? (await Queue.open());
  const candidates: InternalCandidate[] = [];
  const cache = readCacheCandidate(vehicleId);
  if (cache) candidates.push(cache);
  candidates.push(...(await readQueueCandidates(vehicleId, q)));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.ts - a.ts || b.tiebreak - a.tiebreak);
  return candidates[0].record;
}
