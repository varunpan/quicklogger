import type { PageLoad } from './$types';
import { listVehicles } from '$lib/client/api';

export const load: PageLoad = async ({ fetch }) => {
  const vehicles = await listVehicles(fetch).catch(() => []);
  return { vehicles };
};
