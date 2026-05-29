import { describe, it, expect, vi } from 'vitest';
import { submitFuelupWithPhotos } from './api';
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
  return vi.fn(async () =>
    new Response(JSON.stringify({ ok: true, submitted: { gallons: 11.2, cost: 42.18, fxRate: 1, fxSource: 'x' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    })
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
});
