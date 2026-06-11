type SwContainer = {
  controller: unknown;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

/**
 * Reload the page when a new service worker takes control, so the running
 * JS always matches the worker's precached shell. The SW uses skipWaiting()
 * + clients.claim() and deletes the previous versioned cache on activate —
 * without a reload, a tab open across a deploy keeps running the OLD
 * build's JS and its next lazy route-load requests an old-hash
 * /_app/immutable/ chunk that no cache or server can satisfy (404 online,
 * 504 offline → broken navigation).
 *
 * Guarded so the FIRST-ever claim (controller: null → worker) doesn't
 * reload: that claim happens on the very first visit, where the running
 * page came from the same deploy as the worker and a reload would be a
 * pointless flash (and a loop risk if install re-fires).
 */
export function registerControllerReload(
  serviceWorker: SwContainer,
  reload: () => void
): () => void {
  let hadController = Boolean(serviceWorker.controller);
  const onChange = () => {
    if (!hadController) {
      hadController = true;
      return;
    }
    reload();
  };
  serviceWorker.addEventListener('controllerchange', onChange);
  return () => serviceWorker.removeEventListener('controllerchange', onChange);
}
