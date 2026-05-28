import { Queue } from './idb';
import { loadServerInfo } from './server-info';

export type LastFillupSource = 'upstream' | 'offline' | null;

// Output shape mirrors upstream `GasRecord` so the page-side render path
// (formatOdometer, formatLastFillupDate, formatCost) works unchanged.
// `date` is ISO YYYY-MM-DD post-locale-invariant-parsing — both upstream
// snapshots and queue entries pass through unchanged. Legacy cached
// snapshots (written before this branch, under LubeLogger's instance
// locale) are migrated in place by the tolerant-read parser.
//
// `costCurrency`: null for upstream-cached records (rendered via the
// LubeLogger instance currency at format-time); the entered currency for
// queue-derived records (we don't FX offline). `formatCost` consumes both.
export interface LastFillupRecord {
  date: string;          // ISO YYYY-MM-DD
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
  ts: number;
  tiebreak: number;
}

// Fast path — new entries already ISO from the wire.
function parseISO(s: string): number | null {
  const parts = s.split('-');
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.getTime();
}

// Slow path — legacy entries written before this branch under LubeLogger's
// instance locale. Closed-set switch on the four LubeLogger dateFormat
// patterns observed in the wild:
//   "M/d/yyyy"   en-US   → "4/7/2024"
//   "d/M/yyyy"   en-GB   → "7/4/2024"
//   "yyyy-MM-dd" ISO     → "2024-04-07"   (the fast path also handles this)
//   "d.M.yyyy"   de-DE   → "7.4.2024"
// Unknown format → null. Caller treats as cache miss; upstream refetch
// repopulates with the new typed-ISO shape.
function parseLegacyDate(
  raw: string,
  dateFormat: string
): { iso: string; ts: number } | null {
  const fmt = dateFormat.toLowerCase();
  let sep: string;
  let yIdx: number, mIdx: number, dIdx: number;
  switch (fmt) {
    case 'm/d/yyyy':   sep = '/'; mIdx = 0; dIdx = 1; yIdx = 2; break;
    case 'd/m/yyyy':   sep = '/'; dIdx = 0; mIdx = 1; yIdx = 2; break;
    case 'yyyy-mm-dd': sep = '-'; yIdx = 0; mIdx = 1; dIdx = 2; break;
    case 'd.m.yyyy':   sep = '.'; dIdx = 0; mIdx = 1; yIdx = 2; break;
    default: return null;
  }
  const parts = raw.split(sep).map((p) => Number(p));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  const y = parts[yIdx], m = parts[mIdx], d = parts[dIdx];
  const dt = new Date(y, m - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return {
    iso: `${y.toString().padStart(4, '0')}-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}`,
    ts: dt.getTime()
  };
}

function parseDateForCache(
  raw: string,
  cachedDateFormat: string | null
): { iso: string; ts: number } | null {
  if (!raw) return null;
  // Fast path — new entries.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const ts = parseISO(raw);
    return ts === null ? null : { iso: raw, ts };
  }
  // Slow path — legacy entry. Needs cached dateFormat to disambiguate.
  if (!cachedDateFormat) return null;
  return parseLegacyDate(raw, cachedDateFormat);
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
  const rawDate = String(parsed.date ?? '');
  const odometer = String(parsed.odometer ?? '');
  const fuelConsumed = String(parsed.fuelConsumed ?? '');
  if (!rawDate || !odometer) return null;
  const cachedDateFormat = loadServerInfo()?.dateFormat ?? null;
  const parsedDate = parseDateForCache(rawDate, cachedDateFormat);
  if (parsedDate === null) return null;
  return {
    record: {
      date: parsedDate.iso,
      odometer,
      fuelConsumed,
      cost: parsed.cost == null ? null : String(parsed.cost),
      costCurrency: null,
      notes: parsed.notes == null ? null : String(parsed.notes)
    },
    ts: parsedDate.ts,
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
        date: entry.input.date,                          // already ISO from the queue
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
