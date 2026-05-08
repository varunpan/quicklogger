import type {
  FuelSubmissionInput,
  FuelSubmissionResult
} from '$lib/shared/types';
import type { Vehicle, GasRecord } from '$lib/server/lubelogger';

export async function listVehicles(fetchImpl = fetch): Promise<Vehicle[]> {
  const res = await fetchImpl('/api/vehicles');
  if (!res.ok) throw new Error(`vehicles ${res.status}`);
  return res.json();
}

export async function lastFuelup(vehicleId: number, fetchImpl = fetch): Promise<GasRecord | null> {
  const res = await fetchImpl(`/api/vehicle/last-fuelup?vehicleId=${vehicleId}`);
  if (!res.ok) return null;
  return res.json();
}

export interface FxResponse {
  rate: number;
  source: string;
  fetchedAt: number;
  stale: boolean;
  ageHours: number;
}

export async function getFx(from: string, to: string, fetchImpl = fetch): Promise<FxResponse | { available: false }> {
  const res = await fetchImpl(`/api/fx?from=${from}&to=${to}`);
  if (res.status === 503) return { available: false };
  if (!res.ok) throw new Error(`fx ${res.status}`);
  return res.json();
}

export async function submitFuelup(input: FuelSubmissionInput, fetchImpl = fetch): Promise<FuelSubmissionResult> {
  const res = await fetchImpl('/api/fuelup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input)
  });
  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`fuelup ${res.status}: ${text}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}
