import type { PageLoad } from './$types';
import { listVehicles } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import type { Vehicle } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);
  return { vehicle, vehicles };
};
