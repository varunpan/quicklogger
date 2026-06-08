type FlushTarget = { postMessage: (message: unknown) => void };

type Listenable = {
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

export interface SyncTriggerDeps {
  /** The page's service-worker container. Only `controller` (the flush target)
   *  and `ready` (gates the initial drain) are used. */
  serviceWorker: { controller: FlushTarget | null; ready: Promise<unknown> };
  window: Listenable;
  document: Listenable & { visibilityState: DocumentVisibilityState };
}

/**
 * Wire the offline-queue flush triggers and return a cleanup function.
 *
 * Posts `{ type: 'sync-queue' }` to the controlling service worker whenever the
 * app resumes or regains connectivity, so queued fuel-ups drain without the
 * user having to re-focus the tab.
 *
 * Extracted from `+layout.svelte` so the trigger wiring is unit-testable — the
 * sibling of `sync-queue.ts`, which owns the drain itself.
 */
export function registerSyncTriggers(deps: SyncTriggerDeps): () => void {
  const { serviceWorker, window: win, document: doc } = deps;

  const trigger = () => serviceWorker.controller?.postMessage({ type: 'sync-queue' });
  const onVisible = () => {
    if (doc.visibilityState === 'visible') trigger();
  };

  win.addEventListener('focus', trigger);
  // Connectivity returns while the tab stays foregrounded (Wi-Fi reassociates,
  // cellular comes back) with no focus/visibility transition. Without this the
  // queue sits unsent until the next focus — the whole point of the queue is to
  // drain when the network is back.
  win.addEventListener('online', trigger);
  doc.addEventListener('visibilitychange', onVisible);

  // Initial drain once the SW is active and controlling the page, so the
  // on-mount flush isn't a no-op against a still-`null` controller.
  void serviceWorker.ready.then(() => trigger());

  return () => {
    win.removeEventListener('focus', trigger);
    win.removeEventListener('online', trigger);
    doc.removeEventListener('visibilitychange', onVisible);
  };
}
