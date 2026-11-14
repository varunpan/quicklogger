import type { Equipment } from '$lib/server/lubelogger';

/**
 * Per-vehicle localStorage copy of what `/odometer` last loaded from
 * LubeLogger: the equipment list (so the trailer checkbox still shows
 * offline) and LubeLogger's last reported odometer. It only ever mirrors
 * upstream — every successful load overwrites it, and nothing the user types
 * is written here — so a mistyped reading can't stick in the prefill: fix or
 * delete the record in LubeLogger and the next online load corrects it.
 * Readings still waiting to sync are folded in from the queues instead
 * (`pendingOdometerMax`, +page.ts). The `/odometer` sibling of
 * last-fillup.ts's `quicklogger.lastFuelup.<id>` cache.
 */
export interface OdometerSnapshot {
  /** Absent until the equipment list has loaded once. */
  equipment?: Equipment[];
  lastOdometer?: number;
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
    const out: OdometerSnapshot = {};
    if (Array.isArray(parsed.equipment)) out.equipment = parsed.equipment;
    if (typeof parsed.lastOdometer === 'number' && Number.isFinite(parsed.lastOdometer))
      out.lastOdometer = parsed.lastOdometer;
    return out;
  } catch {
    return null; // corrupt JSON / storage blocked → treat as a miss
  }
}

/** Overwrite whichever fields `fresh` carries with LubeLogger's latest values. */
export function saveOdometerSnapshot(vehicleId: number, fresh: OdometerSnapshot): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const next = { ...(loadOdometerSnapshot(vehicleId) ?? {}), ...fresh };
    localStorage.setItem(odometerSnapshotKey(vehicleId), JSON.stringify(next));
  } catch {
    /* quota / private mode — the snapshot is a convenience */
  }
}
