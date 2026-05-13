import type { PageLoad } from './$types';
import { listVehicles } from '$lib/client/api';
import { loadPrefs } from '$lib/client/prefs';
import type { Vehicle } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);

  // Resolution order matches /maintenance:
  // URL ?vehicleId= → prefs.lastVehicleId → vehicles[0] → null.
  // loadPrefs() returns DEFAULT_PREFS (lastVehicleId: null) on SSR;
  // CSR uses the real value. Either way the fallback chain terminates.
  const urlVid = Number(url.searchParams.get('vehicleId'));
  const prefsVid = loadPrefs().lastVehicleId;
  const candidate =
    Number.isFinite(urlVid) && urlVid > 0
      ? urlVid
      : typeof prefsVid === 'number'
        ? prefsVid
        : null;
  const vehicle =
    (candidate !== null ? vehicles.find((v) => v.id === candidate) : null) ??
    vehicles[0] ??
    null;

  return { vehicle, vehicles };
};
