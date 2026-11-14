import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { listVehicles, listEquipment, getVehicleInfo } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import { loadOdometerSnapshot, saveOdometerSnapshot } from '$lib/client/odometer-snapshot';
import { Queue, OdometerQueue } from '$lib/client/idb';
import type { Equipment, Vehicle } from '$lib/server/lubelogger';

/**
 * Highest odometer among this vehicle's readings still waiting to sync —
 * queued odometer readings and queued fill-ups. Only 'queued' rows count:
 * 'synced' ones are already in LubeLogger's figure, and 'failed' ones (a 4xx
 * — LubeLogger refused them) must not keep steering the prefill. Mirrors how
 * resolveOfflineLastFillup folds the queue into the fuel prefill.
 */
async function pendingOdometerMax(vehicleId: number): Promise<number | null> {
  let max: number | null = null;
  const consider = (status: string, vid: number, odometer: number) => {
    if (status === 'queued' && vid === vehicleId && Number.isFinite(odometer))
      max = Math.max(max ?? 0, odometer);
  };
  try {
    const oq = await OdometerQueue.open();
    try {
      for (const e of await oq.list()) consider(e.status, e.input.vehicleId, e.input.odometer);
    } finally {
      oq.close();
    }
    const q = await Queue.open();
    try {
      for (const e of await q.list()) consider(e.status, e.input.vehicleId, e.input.odometer);
    } finally {
      q.close();
    }
  } catch {
    // IDB unavailable — fall back to LubeLogger's / the snapshot's figure.
  }
  return max;
}

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);

  if (!vehicle) {
    return {
      vehicle: null,
      equipment: [] as Equipment[],
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
  const pending = browser ? await pendingOdometerMax(vehicle.id) : null;
  const lastOdometer = Math.max(upstreamLast ?? 0, pending ?? 0) || null;

  const knownEquipment = equipment ?? snapshot?.equipment ?? null;
  return {
    vehicle,
    // `equipmentKnown: false` = never loaded on this device (fresh install,
    // offline). The page then says so instead of "no equipment", and the
    // reading asks the server to include whatever is marked equipped.
    equipment: knownEquipment ?? ([] as Equipment[]),
    equipmentKnown: knownEquipment !== null,
    lastOdometer,
    error: equipment === null ? 'unreachable' : (null as string | null)
  };
};
