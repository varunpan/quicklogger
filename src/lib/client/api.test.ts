import { describe, it, expect, vi } from 'vitest';
import {
  submitFuelupWithPhotos,
  getVehicleInfo,
  postOcr,
  getFx,
  lastFuelup,
  getOcrStatus,
  listReminders,
  ApiError,
  OcrError
} from './api';
import type { FuelSubmissionInput } from '$lib/shared/types';

const input: FuelSubmissionInput = {
  vehicleId: 1,
  date: '2026-05-29',
  odometer: 87432,
  volume: 11.2,
  volumeUnit: 'gal',
  cost: 42.18,
  currency: 'USD',
  isFillToFull: true,
  missedFuelup: false,
  clientSubmissionId: 'abc'
};

function okFetch() {
  return vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          ok: true,
          submitted: { volume: 11.2, volumeUnit: 'gal', cost: 42.18, fxRate: 1, fxSource: 'x' }
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' }
        }
      )
  );
}

describe('submitFuelupWithPhotos', () => {
  it('serializes scalars and includes only the present image parts', async () => {
    const f = okFetch();
    const pump = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });
    await submitFuelupWithPhotos(input, { pump, odometer: null }, f as unknown as typeof fetch);
    const callArgs = f.mock.calls[0] as unknown as Parameters<typeof fetch>;
    const body = (callArgs[1] as RequestInit).body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('vehicleId')).toBe('1');
    expect(body.get('odometer')).toBe('87432');
    expect(body.get('isFillToFull')).toBe('true');
    expect(body.get('missedFuelup')).toBe('false');
    expect(body.get('clientSubmissionId')).toBe('abc');
    expect(body.get('pumpImage')).toBeInstanceOf(Blob);
    expect(body.get('odometerImage')).toBeNull();
  });

  it('throws with .status on a non-ok response', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 400 }));
    await expect(
      submitFuelupWithPhotos(input, { pump: null, odometer: null }, f as unknown as typeof fetch)
    ).rejects.toMatchObject({ status: 400 });
  });

  it('throws ApiError instances so consumers can instanceof-narrow', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 400 }));
    await expect(
      submitFuelupWithPhotos(input, { pump: null, odometer: null }, f as unknown as typeof fetch)
    ).rejects.toBeInstanceOf(ApiError);
  });
});

describe('getVehicleInfo', () => {
  const INFO = {
    vehicleData: { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
    gasRecordCount: 22,
    gasRecordCost: 707.39,
    serviceRecordCount: 44,
    serviceRecordCost: 4164.2,
    repairRecordCount: 9,
    repairRecordCost: 1018.24,
    upgradeRecordCount: 1,
    upgradeRecordCost: 595,
    taxRecordCount: 0,
    taxRecordCost: 0,
    lastReportedOdometer: 111180,
    pastDueReminderCount: 2,
    veryUrgentReminderCount: 0,
    urgentReminderCount: 0,
    notUrgentReminderCount: 7,
    nextReminder: null
  };

  it('requests /api/vehicle/info with the vehicle id and returns the parsed body', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify(INFO), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const info = await getVehicleInfo(1, f as unknown as typeof fetch);
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/vehicle/info?vehicleId=1');
    expect(info.vehicleData.id).toBe(1);
    expect(info.gasRecordCost).toBe(707.39);
  });

  it('throws with .status on a non-ok response', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 502 }));
    await expect(getVehicleInfo(1, f as unknown as typeof fetch)).rejects.toMatchObject({
      status: 502
    });
  });
});

// T3 — postOcr assembles the multipart body. Dropping the rotation/crop/hint
// fields from the FormData currently passes the whole vitest suite; these lock
// them in.
describe('postOcr', () => {
  const image = new Blob([new Uint8Array([0xff, 0xd8, 0xff])], { type: 'image/jpeg' });

  function bodyOf(f: ReturnType<typeof vi.fn>): FormData {
    const callArgs = f.mock.calls[0] as unknown as Parameters<typeof fetch>;
    return (callArgs[1] as RequestInit).body as FormData;
  }

  it('carries rotation, crop and hint fields when present', async () => {
    const f = vi.fn(
      async () =>
        new Response(JSON.stringify({ mode: 'odometer', odometer: 123456 }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    );
    const result = await postOcr(
      image,
      'odometer',
      90,
      { x: 0.1, y: 0.2, w: 0.3, h: 0.4 },
      12345,
      3.45,
      undefined,
      f as unknown as typeof fetch
    );
    const body = bodyOf(f);
    expect(body.get('image')).toBeInstanceOf(Blob);
    expect(body.get('mode')).toBe('odometer');
    expect(body.get('rotation')).toBe('90');
    expect(body.get('cropX')).toBe('0.1');
    expect(body.get('cropY')).toBe('0.2');
    expect(body.get('cropW')).toBe('0.3');
    expect(body.get('cropH')).toBe('0.4');
    expect(body.get('lastOdometerMi')).toBe('12345');
    expect(body.get('lastPricePerUnit')).toBe('3.45');
    // 200 → parsed OcrResult
    expect(result).toEqual({ mode: 'odometer', odometer: 123456 });
  });

  it('omits rotation, crop and hint fields at their defaults', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            mode: 'pump',
            volume: 11.2,
            volumeUnit: 'gal',
            cost: 42.18,
            pricePerUnit: 3.77
          }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' }
          }
        )
    );
    await postOcr(
      image,
      'pump',
      0,
      null,
      undefined,
      undefined,
      undefined,
      f as unknown as typeof fetch
    );
    const body = bodyOf(f);
    expect(body.get('mode')).toBe('pump');
    expect(body.get('rotation')).toBeNull();
    expect(body.get('cropX')).toBeNull();
    expect(body.get('cropY')).toBeNull();
    expect(body.get('cropW')).toBeNull();
    expect(body.get('cropH')).toBeNull();
    expect(body.get('lastOdometerMi')).toBeNull();
    expect(body.get('lastPricePerUnit')).toBeNull();
  });

  it('maps a TimeoutError to OcrError.status === 0', async () => {
    const f = vi.fn(async () => {
      const e = new Error('timed out');
      e.name = 'TimeoutError';
      throw e;
    });
    await expect(
      postOcr(image, 'pump', 0, null, undefined, undefined, undefined, f as unknown as typeof fetch)
    ).rejects.toMatchObject({ status: 0 });
  });

  it('throws OcrError instances (which are also ApiErrors)', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 502 }));
    await expect(
      postOcr(image, 'pump', 0, null, undefined, undefined, undefined, f as unknown as typeof fetch)
    ).rejects.toBeInstanceOf(OcrError);
  });
});

// T4 — the client GET helpers degrade silently rather than throwing, except
// listReminders which surfaces a .status. Each contract is load-bearing for a
// page that must render when an upstream slot is down.
describe('silent-degradation contracts', () => {
  it('getFx returns { available: false } on 503', async () => {
    const f = vi.fn(async () => new Response(null, { status: 503 }));
    const res = await getFx('CAD', 'USD', f as unknown as typeof fetch);
    expect(res).toEqual({ available: false });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe('/api/fx?from=CAD&to=USD');
  });

  it('lastFuelup returns null on a 502', async () => {
    const f = vi.fn(async () => new Response('bad gateway', { status: 502 }));
    expect(await lastFuelup(3, f as unknown as typeof fetch)).toBeNull();
  });

  it('getOcrStatus returns { enabled: false } on a 500', async () => {
    const f = vi.fn(async () => new Response('boom', { status: 500 }));
    expect(await getOcrStatus(f as unknown as typeof fetch)).toEqual({ enabled: false });
  });

  it('listReminders throws with .status on a non-ok response', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 502 }));
    await expect(listReminders(3, f as unknown as typeof fetch)).rejects.toMatchObject({
      status: 502
    });
  });
});
