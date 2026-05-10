/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import { Queue } from '$lib/client/idb';
import type { FuelSubmissionInput } from '$lib/shared/types';

declare const self: ServiceWorkerGlobalScope;

const CACHE = `quicklogger-shell-${version}`;
const SHELL = [...build, ...files];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

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

async function syncQueue() {
  const q = await Queue.open();
  const all = await q.list();
  for (const entry of all) {
    if (entry.status !== 'queued') continue;
    if (entry.attempts >= 5) continue;
    await q.incrementAttempts(entry.id);
    try {
      const res = await fetch('/api/fuelup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(entry.input satisfies FuelSubmissionInput)
      });
      if (res.ok) {
        await q.markSynced(entry.id);
      } else if (res.status >= 400 && res.status < 500) {
        await q.markFailed(entry.id, `${res.status}`);
      }
      // else: leave queued for next sync
    } catch (_err) {
      // network still down, leave queued
    }
  }
}
