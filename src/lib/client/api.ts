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
