import type { PageLoad } from './$types';
import { listVehicles, listEquipment, getVehicleInfo } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
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

  return {
    vehicle,
    equipment: equipment ?? ([] as Equipment[]),
    lastOdometer: info?.lastReportedOdometer || null,
    error: equipment === null ? 'unreachable' : (null as string | null)
  };
};
