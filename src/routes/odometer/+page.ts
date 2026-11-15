import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { listVehicles, listEquipment, getVehicleInfo } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import { loadOdometerSnapshot, saveOdometerSnapshot } from '$lib/client/odometer-snapshot';
import { Queue, OdometerQueue, type OdometerQueueEntry, type QueueEntry } from '$lib/client/idb';
import { applyPendingEquipment, type EquipmentView } from '$lib/client/equipment-state';
import type { Vehicle } from '$lib/server/lubelogger';

/** This device's queue rows (odometer readings and fill-ups); empty when
 *  IndexedDB is unavailable or on the server. */
async function readLocalRows(): Promise<{ odometer: OdometerQueueEntry[]; fuel: QueueEntry[] }> {
  if (!browser) return { odometer: [], fuel: [] };
  const out = { odometer: [] as OdometerQueueEntry[], fuel: [] as QueueEntry[] };
  try {
    const oq = await OdometerQueue.open();
    try {
      out.odometer = await oq.list();
    } finally {
      oq.close();
    }
    const q = await Queue.open();
    try {
      out.fuel = await q.list();
    } finally {
      q.close();
    }
  } catch {
    // IDB unavailable — fall back to LubeLogger's / the snapshot's figures.
  }
  return out;
}

/**
 * Highest odometer among this vehicle's local rows. 'queued' rows always count
 * (not upstream yet). 'synced' rows count only when LubeLogger couldn't be
 * reached (`includeSynced`): online, they're already in LubeLogger's figure,
 * which stays authoritative so a fix made there wins; offline, they're newer
 * than the snapshot. 'failed' rows never count — LubeLogger refused them, so a
 * typo there can't steer the prefill. Mirrors how resolveOfflineLastFillup
 * folds the queue into the fuel prefill.
 */
function localOdometerMax(
  rows: { input: { vehicleId: number; odometer: number }; status: string }[],
  vehicleId: number,
  includeSynced: boolean
): number | null {
  let max: number | null = null;
  for (const e of rows) {
    const counts = e.status === 'queued' || (includeSynced && e.status === 'synced');
    if (counts && e.input.vehicleId === vehicleId && Number.isFinite(e.input.odometer))
      max = Math.max(max ?? 0, e.input.odometer);
  }
  return max;
}

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);

  if (!vehicle) {
    return {
      vehicle: null,
      equipment: [] as EquipmentView[],
      equipmentKnown: false,
      lastOdometer: null as number | null,
      error: 'no-vehicle' as const
    };
  }

  const [equipment, info] = await Promise.all([
    listEquipment(vehicle.id, fetch).catch(() => null),
    getVehicleInfo(vehicle.id, fetch).catch(() => null)
  ]);

  // Fresh upstream values overwrite the snapshot; the snapshot is only read
  // for whatever couldn't be fetched (offline / LubeLogger down).
  saveOdometerSnapshot(vehicle.id, {
    ...(equipment !== null ? { equipment } : {}),
    ...(info?.lastReportedOdometer ? { lastOdometer: info.lastReportedOdometer } : {})
  });
  const snapshot = loadOdometerSnapshot(vehicle.id);
  const upstreamLast = info?.lastReportedOdometer || snapshot?.lastOdometer || null;
  const local = await readLocalRows();
  const pending = localOdometerMax([...local.odometer, ...local.fuel], vehicle.id, info === null);
  const lastOdometer = Math.max(upstreamLast ?? 0, pending ?? 0) || null;

  const knownEquipment = equipment ?? snapshot?.equipment ?? null;
  return {
    vehicle,
    // `equipmentKnown: false` = never loaded on this device (fresh install,
    // offline). The page then says so instead of "no equipment", and the
    // reading asks the server to include whatever is marked equipped.
    // Equip / Unequip taps still waiting to sync are shown as already done
    // (marked `pending`), so later readings count toward them as they will
    // once the queue replays in order.
    equipment: applyPendingEquipment(
      knownEquipment ?? [],
      local.odometer,
      vehicle.id,
      // Fresh list: only still-queued taps apply. Snapshot (offline): taps
      // made after it was saved apply too, synced or not.
      equipment !== null ? Infinity : (snapshot?.equipmentSavedAt ?? 0)
    ),
    equipmentKnown: knownEquipment !== null,
    lastOdometer,
    error: equipment === null ? 'unreachable' : (null as string | null)
  };
};
