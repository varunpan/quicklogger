import { describe, it, expect, vi } from 'vitest';
import { navigationFallback, precacheShell, vehiclesNetworkFirst } from './sw-cache';

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
    async addAll(keys: string[]) {
      for (const k of keys) store.set(k, new Response('precached'));
    },
    _store: store
  } as unknown as Cache & { _store: Map<string, Response> };
}

describe('precacheShell', () => {
  it('adds every shell URL to the cache', async () => {
    const cache = fakeCache();
    const logError = vi.fn(async () => undefined);
    await precacheShell(cache, ['/offline', '/_app/x.js'], logError);
    expect(await cache.match('/offline')).toBeDefined();
    expect(await cache.match('/_app/x.js')).toBeDefined();
    expect(logError).not.toHaveBeenCalled();
  });

  it('logs then rethrows when the precache fails (install must abort)', async () => {
    const cache = {
      async addAll() {
        throw new Error('network flake mid-install');
      }
    } as unknown as Cache;
    const logError = vi.fn(async () => undefined);
    await expect(precacheShell(cache, ['/offline'], logError)).rejects.toThrow(
      'network flake mid-install'
    );
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

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
  // Collects promises the policy hands to event.waitUntil so tests can
  // settle the background cache write before asserting on the cache.
  function fakeWaitUntil() {
    const pending: Promise<unknown>[] = [];
    return { waitUntil: (p: Promise<unknown>) => void pending.push(p), pending };
  }

  it('caches and returns a successful response (body readable from both)', async () => {
    const cache = fakeCache();
    const { waitUntil, pending } = fakeWaitUntil();
    const req = new Request('http://x/api/vehicles');
    const net = new Response(JSON.stringify([{ id: 1 }]), { status: 200 });
    const res = await vehiclesNetworkFirst(req, async () => net, cache, waitUntil);
    expect(res.status).toBe(200);
    await Promise.all(pending);
    const cached = await cache.match(req);
    expect(cached).toBeDefined();
    // Read BOTH bodies: a dropped res.clone() would pass an existence-only
    // assertion and explode at runtime with "body already used".
    expect(await res.json()).toEqual([{ id: 1 }]);
    expect(await cached!.json()).toEqual([{ id: 1 }]);
  });

  it('hands the cache write to waitUntil (SW must outlive respondWith)', async () => {
    const cache = fakeCache();
    const { waitUntil, pending } = fakeWaitUntil();
    const req = new Request('http://x/api/vehicles');
    await vehiclesNetworkFirst(
      req,
      async () => new Response('[]', { status: 200 }),
      cache,
      waitUntil
    );
    expect(pending).toHaveLength(1);
  });

  it('does not cache a non-ok response when the cache is cold', async () => {
    const cache = fakeCache();
    const { waitUntil, pending } = fakeWaitUntil();
    const req = new Request('http://x/api/vehicles');
    const res = await vehiclesNetworkFirst(
      req,
      async () => new Response('err', { status: 500 }),
      cache,
      waitUntil
    );
    expect(res.status).toBe(500);
    await Promise.all(pending);
    expect(await cache.match(req)).toBeUndefined();
  });

  it('serves the cached copy when the network fails', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    await cache.put(req, new Response(JSON.stringify([{ id: 7 }]), { status: 200 }));
    const res = await vehiclesNetworkFirst(req, async () => {
      throw new Error('offline');
    }, cache, fakeWaitUntil().waitUntil);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 7 }]);
  });

  it('serves the cached copy when the server errors with a warm cache', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    await cache.put(req, new Response(JSON.stringify([{ id: 7 }]), { status: 200 }));
    const res = await vehiclesNetworkFirst(
      req,
      async () => new Response('upstream down', { status: 502 }),
      cache,
      fakeWaitUntil().waitUntil
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 7 }]);
  });

  it('returns 504 when offline with a cold cache', async () => {
    const cache = fakeCache();
    const req = new Request('http://x/api/vehicles');
    const res = await vehiclesNetworkFirst(req, async () => {
      throw new Error('offline');
    }, cache, fakeWaitUntil().waitUntil);
    expect(res.status).toBe(504);
  });
});
