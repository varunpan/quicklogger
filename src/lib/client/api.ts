import type {
  FuelSubmissionInput,
  FuelSubmissionResult,
  OcrResult,
  OcrStatus,
  OcrMode
} from '$lib/shared/types';
import type { Vehicle, GasRecord, Reminder } from '$lib/server/lubelogger';
import type { Rotation, NormalizedRect } from './image';

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

export async function listReminders(vehicleId: number, fetchImpl = fetch): Promise<Reminder[]> {
  const res = await fetchImpl(`/api/vehicle/reminders?vehicleId=${vehicleId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`reminders ${res.status}${text ? `: ${text}` : ''}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return res.json();
}

export async function getOcrStatus(fetchImpl = fetch): Promise<OcrStatus> {
  const res = await fetchImpl('/api/ocr');
  if (!res.ok) return { enabled: false };
  return res.json();
}

export interface OcrError extends Error {
  status?: number;
  retryAfter?: number;
}

export async function postOcr(
  image: Blob,
  mode: OcrMode,
  rotation: Rotation = 0,
  crop: NormalizedRect | null = null,
  lastOdometerMi?: number,
  fetchImpl = fetch
): Promise<OcrResult> {
  const fd = new FormData();
  fd.set('image', image, 'capture.jpg');
  fd.set('mode', mode);
  // Wire-additive: only add the form field when non-zero / non-null, so the
  // unmodified case is byte-identical to the v0.2.0 multipart shape.
  if (rotation !== 0) fd.set('rotation', String(rotation));
  if (crop) {
    fd.set('cropX', String(crop.x));
    fd.set('cropY', String(crop.y));
    fd.set('cropW', String(crop.w));
    fd.set('cropH', String(crop.h));
  }
  // Wire-additive: only attach `lastOdometerMi` when it's a finite positive
  // number. Server is defensive about this too, but keeping the client tight
  // means the un-hinted multipart shape stays byte-identical to v0.2.0+
  // (important for the e2e regression suite).
  if (
    typeof lastOdometerMi === 'number' &&
    Number.isFinite(lastOdometerMi) &&
    lastOdometerMi > 0
  ) {
    fd.set('lastOdometerMi', String(lastOdometerMi));
  }
  // 90s client-side timeout — generous enough for ollama CPU inference,
  // shorter than indefinite hang on broken network.
  let res: Response;
  try {
    res = await fetchImpl('/api/ocr', {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(90_000)
    });
  } catch (err) {
    const e: OcrError = new Error(`ocr network: ${(err as Error).message}`);
    // AbortSignal.timeout DOM exception name is 'TimeoutError'
    if ((err as { name?: string }).name === 'TimeoutError') e.status = 0;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: OcrError = new Error(`ocr ${res.status}: ${text}`);
    err.status = res.status;
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      err.retryAfter = ra ? Number(ra) : 60;
    }
    throw err;
  }
  return res.json();
}
