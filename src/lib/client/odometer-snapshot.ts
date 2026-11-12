import type { Equipment } from '$lib/server/lubelogger';

/**
 * Per-vehicle localStorage snapshot that keeps `/odometer` usable offline:
 * the equipment list (so the trailer checkbox still shows) and the last known
 * odometer (so the field still prefills). Written by the loader on every
 * successful fetch and by the page after each logged / queued reading; read
 * by the loader only when LubeLogger is unreachable. The `/odometer` sibling
 * of last-fillup.ts's `quicklogger.lastFuelup.<id>` cache.
 */
export interface OdometerSnapshot {
  equipment: Equipment[];
  lastOdometer: number | null;
}

export function odometerSnapshotKey(vehicleId: number): string {
  return `quicklogger.odometerSnapshot.${vehicleId}`;
}

export function loadOdometerSnapshot(vehicleId: number): OdometerSnapshot | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(odometerSnapshotKey(vehicleId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OdometerSnapshot>;
    return {
      equipment: Array.isArray(parsed.equipment) ? parsed.equipment : [],
      lastOdometer:
        typeof parsed.lastOdometer === 'number' && Number.isFinite(parsed.lastOdometer)
          ? parsed.lastOdometer
          : null
    };
  } catch {
    return null; // corrupt JSON / storage blocked → treat as a miss
  }
}

/** Merge `patch` into the stored snapshot. `lastOdometer` only ever moves
 *  forward, so a stale upstream read can't roll back a newer queued reading. */
export function saveOdometerSnapshot(vehicleId: number, patch: Partial<OdometerSnapshot>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const prev = loadOdometerSnapshot(vehicleId) ?? { equipment: [], lastOdometer: null };
    const next: OdometerSnapshot = {
      equipment: patch.equipment ?? prev.equipment,
      lastOdometer: Math.max(prev.lastOdometer ?? 0, patch.lastOdometer ?? 0) || null
    };
    localStorage.setItem(odometerSnapshotKey(vehicleId), JSON.stringify(next));
  } catch {
    /* quota / private mode — the snapshot is a convenience */
  }
}
