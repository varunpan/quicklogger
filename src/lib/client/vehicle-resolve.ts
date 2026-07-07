import { loadPrefs } from '$lib/client/prefs';
import type { Vehicle } from '$lib/server/lubelogger';

/** Shared vehicle-resolution chain for the history / maintenance / stats
 *  loaders: URL `?vehicleId=` → `prefs.lastVehicleId` → `vehicles[0]` → null.
 *  loadPrefs() returns DEFAULT_PREFS (lastVehicleId: null) on SSR; CSR uses
 *  the real value. Either way the fallback chain terminates. */
export function resolveSelectedVehicle(vehicles: Vehicle[], url: URL): Vehicle | null {
  const urlVid = Number(url.searchParams.get('vehicleId'));
  const prefsVid = loadPrefs().lastVehicleId;
  const candidate =
    Number.isFinite(urlVid) && urlVid > 0
      ? urlVid
      : typeof prefsVid === 'number'
        ? prefsVid
        : null;
  return (
    (candidate !== null ? vehicles.find((v) => v.id === candidate) : null) ??
    vehicles[0] ??
    null
  );
}
