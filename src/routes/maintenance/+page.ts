import type { PageLoad } from './$types';
import { listVehicles, listReminders } from '$lib/client/api';
import { resolveSelectedVehicle } from '$lib/client/vehicle-resolve';
import type { Reminder, Vehicle } from '$lib/server/lubelogger';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => [] as Vehicle[]);
  const vehicle = resolveSelectedVehicle(vehicles, url);

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
