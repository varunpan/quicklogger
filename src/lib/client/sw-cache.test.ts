import { describe, it, expect, vi } from 'vitest';
import { navigationFallback, vehiclesNetworkFirst } from './sw-cache';

// Minimal Cache double: a Map keyed on the request URL (or a raw string key).
function fakeCache() {
  const store = new Map<string, Response>();
  const key = (r: Request | string) => (typeof r === 'string' ? r : r.url);
  return {
    async put(r: Request, res: Response) {
      store.set(key(r), res);
    },
    async match(r: Request | string) {
      return store.get(key(r));
    },
    _store: store
  } as unknown as Cache & { _store: Map<string, Response> };
}

describe('navigationFallback', () => {
  it('passes the network response through when online', async () => {
    const net = new Response('live', { status: 200 });
    const res = await navigationFallback(
      new Request('http://x/'),
      async () => net,
      async () => new Response('shell')
    );
    expect(res).toBe(net);
  });

  it('serves the cached /offline shell when the network fails', async () => {
    const shell = new Response('shell', { status: 200 });
    const match = vi.fn(async (k: string) => (k === '/offline' ? shell : undefined));
    const res = await navigationFallback(
      new Request('http://x/history'),
      async () => {
        throw new Error('offline');
      },
      match
    );
    expect(match).toHaveBeenCalledWith('/offline');
    expect(res).toBe(shell);
  });

  it('returns 504 when offline and the shell was never cached', async () => {
    const res = await navigationFallback(
      new Request('http://x/'),
      async () => {
        throw new Error('offline');
      },
      async () => undefined
    );
    expect(res.status).toBe(504);
  });
});

describe('vehiclesNetworkFirst', () => {
  it('caches and returns a successful response', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    const net = new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    const res = await vehiclesNetworkFirst(req, async () => net, cache);
    expect(res.status).toBe(200);
    expect(await cache.match(req)).toBeDefined();
  });

  it('does not cache a non-ok response', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    const res = await vehiclesNetworkFirst(
      req,
      async () => new Response('err', { status: 500 }),
      cache
    );
    expect(res.status).toBe(500);
    expect(await cache.match(req)).toBeUndefined();
  });

  it('serves the cached copy when the network fails', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    await cache.put(req, new Response(JSON.stringify([{ id: 7 }]), { status: 200 }));
    const res = await vehiclesNetworkFirst(req, async () => {
      throw new Error('offline');
    }, cache);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 7 }]);
  });

  it('returns 504 when offline with a cold cache', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    const res = await vehiclesNetworkFirst(req, async () => {
      throw new Error('offline');
    }, cache);
    expect(res.status).toBe(504);
  });
});
