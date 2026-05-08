import type { PageLoad } from './$types';
import { listVehicles, lastFuelup } from '$lib/client/api';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => []);
  const prefillVehicleId = Number(url.searchParams.get('vehicleId'));
  const targetVehicle = vehicles.find((v) => v.id === prefillVehicleId) ?? vehicles[0] ?? null;
  const last = targetVehicle ? await lastFuelup(targetVehicle.id, fetch).catch(() => null) : null;

  return {
    vehicles,
    initialVehicle: targetVehicle,
    lastFuelup: last,
    prefill: {
      vehicleId: url.searchParams.get('vehicleId'),
      volume: url.searchParams.get('volume'),
      volumeUnit: url.searchParams.get('volumeUnit'),
      cost: url.searchParams.get('cost'),
      currency: url.searchParams.get('currency'),
      fillToFull: url.searchParams.get('fillToFull')
    }
  };
};
