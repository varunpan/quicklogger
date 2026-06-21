import type {
  FuelSubmissionInput,
  FuelSubmissionResult,
  OcrResult,
  OcrStatus,
  OcrMode
} from '$lib/shared/types';
import type { Vehicle, GasRecord, Reminder, VehicleInfo } from '$lib/server/lubelogger';
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

/** Multipart submit that attaches the retained OCR image bytes. Scalars are
 *  serialized to match `coerceParams` in `/api/fuelup` (booleans → 'true'/'false';
 *  undefined optionals omitted). Image parts are included only when present.
 *  Used by the page only when attach is on AND ≥1 blob exists. */
export async function submitFuelupWithPhotos(
  input: FuelSubmissionInput,
  photos: { pump: Blob | null; odometer: Blob | null },
  fetchImpl = fetch
): Promise<FuelSubmissionResult> {
  const fd = new FormData();
  fd.set('vehicleId', String(input.vehicleId));
  fd.set('date', input.date);
  fd.set('odometer', String(input.odometer));
  fd.set('volume', String(input.volume));
  fd.set('volumeUnit', input.volumeUnit);
  fd.set('cost', String(input.cost));
  fd.set('currency', input.currency);
  fd.set('isFillToFull', input.isFillToFull ? 'true' : 'false');
  fd.set('missedFuelup', input.missedFuelup ? 'true' : 'false');
  if (input.notes !== undefined) fd.set('notes', input.notes);
  if (input.tags !== undefined) fd.set('tags', input.tags);
  if (input.manualFxRate !== undefined) fd.set('manualFxRate', String(input.manualFxRate));
  fd.set('clientSubmissionId', input.clientSubmissionId);
  if (photos.pump) fd.set('pumpImage', photos.pump, 'pump.jpg');
  if (photos.odometer) fd.set('odometerImage', photos.odometer, 'odometer.jpg');

  const res = await fetchImpl('/api/fuelup', { method: 'POST', body: fd });
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

export async function getVehicleInfo(vehicleId: number, fetchImpl = fetch): Promise<VehicleInfo> {
  const res = await fetchImpl(`/api/vehicle/info?vehicleId=${vehicleId}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`vehicle-info ${res.status}${text ? `: ${text}` : ''}`);
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
  // Server's `error` string from a 400 response body. Used by the client
  // toast to surface the specific rejection reason (e.g., "empty image",
  // "multipart parse failed") instead of an opaque "OCR failed (400)".
  serverError?: string;
}

export async function postOcr(
  image: Blob,
  mode: OcrMode,
  rotation: Rotation = 0,
  crop: NormalizedRect | null = null,
  lastOdometerMi?: number,
  lastPricePerUnit?: number,
  timeoutMs?: number,
  fetchImpl = fetch
): Promise<OcrResult> {
  const fd = new FormData();
  fd.set('image', image, 'capture.jpg');
  fd.set('mode', mode);
  if (rotation !== 0) fd.set('rotation', String(rotation));
  if (crop) {
    fd.set('cropX', String(crop.x));
    fd.set('cropY', String(crop.y));
    fd.set('cropW', String(crop.w));
    fd.set('cropH', String(crop.h));
  }
  if (
    typeof lastOdometerMi === 'number' &&
    Number.isFinite(lastOdometerMi) &&
    lastOdometerMi > 0
  ) {
    fd.set('lastOdometerMi', String(lastOdometerMi));
  }
  if (
    typeof lastPricePerUnit === 'number' &&
    Number.isFinite(lastPricePerUnit) &&
    lastPricePerUnit > 0
  ) {
    fd.set('lastPricePerUnit', String(lastPricePerUnit));
  }
  // Client-side timeout self-adjusts to the configured chain envelope.
  // `timeoutMs` is the server's reported chainTimeoutMs (sum of per-slot
  // timeouts) when the probe surfaced one; falls back to the legacy 90 s
  // when absent (older server, or probe failed and page is degraded).
  // The +10 000 covers transit + serialization on top of the chain
  // envelope so the server still "fails first" by construction.
  const finalTimeoutMs = (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0)
    ? timeoutMs + 10_000
    : 90_000;
  let res: Response;
  try {
    res = await fetchImpl('/api/ocr', {
      method: 'POST',
      body: fd,
      signal: AbortSignal.timeout(finalTimeoutMs)
    });
  } catch (err) {
    const e: OcrError = new Error(`ocr network: ${(err as Error).message}`);
    if ((err as { name?: string }).name === 'TimeoutError') e.status = 0;
    throw e;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err: OcrError = new Error(`ocr ${res.status}: ${text}`);
    err.status = res.status;
    if (res.status === 400) {
      try {
        const body = JSON.parse(text);
        if (body && typeof body.error === 'string') err.serverError = body.error;
      } catch {
        // Non-JSON body (e.g., proxy HTML error page); leave serverError unset.
      }
    }
    if (res.status === 429) {
      const ra = res.headers.get('retry-after');
      err.retryAfter = ra ? Number(ra) : 60;
    }
    throw err;
  }
  return res.json();
}
