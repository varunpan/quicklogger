import type { PageLoad } from './$types';
import { listVehicles, listReminders } from '$lib/client/api';
import { loadPrefs } from '$lib/client/prefs';
import type { Reminder, Vehicle } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);

  // Resolution order: URL ?vehicleId= → prefs.lastVehicleId → vehicles[0].
  // loadPrefs() returns DEFAULT_PREFS (lastVehicleId: null) on SSR; CSR uses
  // the real value. Either way the fallback chain still terminates correctly.
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

  if (!vehicle) {
    return {
      vehicle: null,
      reminders: [] as Reminder[],
      error: 'no-vehicle' as const
    };
  }

  try {
    const reminders = await listReminders(vehicle.id, fetch);
    return { vehicle, reminders, error: null as string | null };
  } catch (err) {
    return {
      vehicle,
      reminders: [] as Reminder[],
      error: (err as Error).message
    };
  }
};
