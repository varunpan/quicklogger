/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { syncQueue } from '$lib/client/sync-queue';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `quicklogger-shell-${version}`;
const IMG_CACHE = 'quicklogger-vehicle-images-v1';
const SHELL = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch((err) => sendSwLog('error', 'sw install failed', { message: (err as Error).message }))
  );
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE && k !== IMG_CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // SWR for vehicle images — separate cache, intercept before the /api/ branch.
  if (url.pathname === '/api/vehicle/image') {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // network-first for API; cache-first for shell
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 504 })));
    return;
  }
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      try {
        return await fetch(req);
      } catch {
        return cached ?? new Response('offline', { status: 504 });
      }
    })()
  );
});

interface SyncQueueMessage {
  type: 'sync-queue';
}

self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const data = event.data as SyncQueueMessage | undefined;
  if (data?.type === 'sync-queue') event.waitUntil(syncQueue());
});

async function staleWhileRevalidate(req: Request): Promise<Response> {
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  const networkFetch = fetch(req)
    .then((res) => {
      if (res.ok) void cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    // fire-and-forget refresh; return cached immediately
    void networkFetch;
    return cached;
  }
  return (await networkFetch) ?? new Response(null, { status: 504 });
}

self.addEventListener('error', (event) => {
  void sendSwLog('error', 'service-worker error', {
    message: (event as ErrorEvent).message ?? String(event),
    filename: (event as ErrorEvent).filename,
    lineno: (event as ErrorEvent).lineno
  });
});

self.addEventListener('unhandledrejection', (event) => {
  const reason = (event as PromiseRejectionEvent).reason;
  void sendSwLog('error', 'service-worker unhandled rejection', {
    message: reason instanceof Error ? reason.message : String(reason)
  });
});

async function sendSwLog(level: 'error' | 'warn' | 'info', msg: string, ctx: Record<string, unknown>) {
  try {
    await fetch('/api/log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        records: [{ level, msg, ts: new Date().toISOString(), ctx: { ...ctx, source: 'service-worker' } }]
      })
    });
  } catch { /* swallow — we can't log a log failure */ }
}
