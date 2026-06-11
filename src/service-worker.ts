/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version, prerendered } from '$service-worker';
import { syncQueue } from '$lib/client/sync-queue';
import { navigationFallback, precacheShell, vehiclesNetworkFirst } from '$lib/client/sw-cache';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `quicklogger-shell-${version}`;
const IMG_CACHE = 'quicklogger-vehicle-images-v1';
const API_CACHE = 'quicklogger-api-cache-v1'; // fixed name → survives deploys
const SHELL = [...build, ...files, ...prerendered]; // precache the /offline shell

self.addEventListener('install', (event) => {
  // precacheShell logs then RETHROWS on failure — a failed precache must
  // abort the install so the previous worker keeps serving its intact cache.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) =>
        precacheShell(c, SHELL, (err) =>
          sendSwLog('error', 'sw install failed', { message: err.message })
        )
      )
  );
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => k !== CACHE && k !== IMG_CACHE && k !== API_CACHE)
          .map((k) => caches.delete(k))
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
    event.respondWith(staleWhileRevalidate(event));
    return;
  }

  // Vehicle list — network-first, but cache the last good response so the
  // offline cold-start form has a vehicle to log against. Before the generic
  // /api/ branch so it doesn't fall through to the uncached network-first path.
  if (url.pathname === '/api/vehicles') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        return vehiclesNetworkFirst(req, (r) => fetch(r), cache, (p) => event.waitUntil(p));
      })()
    );
    return;
  }

  // network-first for API; cache-first for shell
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(req).catch(() => new Response(null, { status: 504 })));
    return;
  }

  // Navigations — network-first so online cold-starts get the live SSR'd page,
  // falling back to the precached /offline SPA shell when the network is down.
  // After the /api/ branches (a navigation pathname is never /api/…); before the
  // generic cache-first branch (assets stay cache-first from the shell).
  if (req.mode === 'navigate') {
    event.respondWith(
      navigationFallback(
        req,
        (r) => fetch(r),
        (k) => caches.match(k)
      )
    );
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

async function staleWhileRevalidate(event: FetchEvent): Promise<Response> {
  const req = event.request;
  const cache = await caches.open(IMG_CACHE);
  const cached = await cache.match(req);
  const networkFetch = fetch(req)
    .then(async (res) => {
      if (res.ok) await cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);
  if (cached) {
    // Background refresh; return cached immediately. waitUntil keeps the
    // worker alive until the refreshed bytes land — once respondWith
    // settles, the browser may otherwise kill the worker mid-write.
    event.waitUntil(networkFetch);
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
