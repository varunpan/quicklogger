import { TtlCache } from './cache';
import type { LubeLoggerClient, Vehicle } from './lubelogger';
import { normalizeVehicleIdentifiers } from './vehicle-identifiers';

// One shared 5-minute cache of the normalized vehicle list, used by both
// `/api/vehicles` and `/api/vehicle/image`. Before this was a single module
// the two routes each kept their own `TtlCache` keyed `'vehicles'`, so a cold
// page load that fires both at once made two upstream `listVehicles()` calls on
// two independent TTL clocks (review #36). Sharing one cache + the single-flight
// dedup inside `TtlCache` collapses that to one call.
//
// The loader normalizes (VIN hoist) once per fetch, so cache hits still cost
// zero extraction work. `normalizeVehicleIdentifiers` spreads every upstream
// field through, so the image route reads `imageLocation`/`id` straight off the
// normalized object — it neither needs nor notices the raw shape.
const cache = new TtlCache<Vehicle[]>(5 * 60 * 1000);

export function getCachedVehicles(client: LubeLoggerClient): Promise<Vehicle[]> {
  return cache.get('vehicles', async () => {
    const raw = await client.listVehicles();
    return raw.map(normalizeVehicleIdentifiers);
  });
}

export function _resetVehicleCache(): void {
  cache.clear();
}
