import type { PageLoad } from './$types';
import { listVehicles, listEquipment, getVehicleInfo } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import { loadOdometerSnapshot, saveOdometerSnapshot } from '$lib/client/odometer-snapshot';
import type { Equipment, Vehicle } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);

  if (!vehicle) {
    return {
      vehicle: null,
      equipment: [] as Equipment[],
      lastOdometer: null as number | null,
      error: 'no-vehicle' as const
    };
  }

  const [equipment, info] = await Promise.all([
    listEquipment(vehicle.id, fetch).catch(() => null),
    getVehicleInfo(vehicle.id, fetch).catch(() => null)
  ]);

  // Offline (or LubeLogger down): fall back to the last snapshot so the
  // equipment checkboxes and the odometer prefill still work and the entry
  // can be queued. The snapshot's lastOdometer only moves forward, so it can
  // also be ahead of upstream when an earlier reading is still queued.
  const snapshot = loadOdometerSnapshot(vehicle.id);
  if (equipment !== null || info) {
    saveOdometerSnapshot(vehicle.id, {
      ...(equipment !== null ? { equipment } : {}),
      ...(info?.lastReportedOdometer ? { lastOdometer: info.lastReportedOdometer } : {})
    });
  }
  const lastOdometer =
    Math.max(info?.lastReportedOdometer ?? 0, snapshot?.lastOdometer ?? 0) || null;

  return {
    vehicle,
    equipment: equipment ?? snapshot?.equipment ?? ([] as Equipment[]),
    lastOdometer,
    error: equipment === null ? 'unreachable' : (null as string | null)
  };
};
