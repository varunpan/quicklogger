import type { PageLoad } from './$types';
import { listVehicles, getVehicleInfo } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import type { Vehicle, VehicleInfo } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);

  if (!vehicle) {
    return {
      vehicle: null,
      info: null as VehicleInfo | null,
      error: 'no-vehicle' as const
    };
  }

  try {
    const info = await getVehicleInfo(vehicle.id, fetch);
    return { vehicle, info, error: null as string | null };
  } catch (err) {
    return {
      vehicle,
      info: null as VehicleInfo | null,
      error: (err as Error).message
    };
  }
};
