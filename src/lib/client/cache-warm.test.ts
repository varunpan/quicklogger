import { describe, it, expect, vi } from 'vitest';
import { warmVehiclesCache } from './cache-warm';

describe('warmVehiclesCache', () => {
  it('fetches /api/vehicles only after the service worker is ready', async () => {
    let readySW: (v: unknown) => void;
    const ready = new Promise((r) => (readySW = r));
    const fetcher = vi.fn(async () => new Response('[]'));

    const warmed = warmVehiclesCache({ ready }, fetcher);
    expect(fetcher).not.toHaveBeenCalled();

    readySW!(undefined);
    await warmed;
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/vehicles');
  });

  it('swallows a failed warming fetch (best-effort)', async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    await expect(
      warmVehiclesCache({ ready: Promise.resolve() }, fetcher)
    ).resolves.toBeUndefined();
  });
});
