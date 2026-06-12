/**
 * Reload the page when a NEW BUILD's service worker takes control, so the
 * running JS always matches the worker's precached shell. The SW uses
 * skipWaiting() + clients.claim() and deletes the previous versioned cache on
 * activate — without a reload, a tab open across a deploy keeps running the
 * OLD build's JS and its next lazy route-load requests an old-hash
 * /_app/immutable/ chunk that no cache or server can satisfy (404 online,
 * 504 offline → broken navigation). (Whole-app review #7.)
 *
 * Why not simply `controllerchange → reload()`: that shipped in v0.2.7 and
 * made the installed iPhone PWA reload ~1×/sec forever (whole-app review #39).
 * WebKit can fire `controllerchange` on a controlled load even when no new
 * worker was installed (prod logs showed 216 reload cycles with zero
 * /service-worker.js fetches — no new worker existed), and the previous
 * in-memory boolean guard reset on every reload, so it could never break the
 * cycle. The decision must therefore be robust to ANY controllerchange
 * pattern, which here means:
 *
 * 1. Ask the new controller for its build version (MessageChannel round-trip;
 *    the SW answers `SW_VERSION_REQUEST` — see src/service-worker.ts) and
 *    reload only when it differs from this page's build version. A
 *    same-version claim is noise: the page already matches the worker's
 *    shell, so reloading buys nothing and risks the loop.
 * 2. Cap at ONE reload per page build per tab session via a sessionStorage
 *    marker — unlike module state, it survives the reload it causes. Even if
 *    the version query times out or misreports forever, the worst case is a
 *    single extra reload, never a loop. Trade-off: if a spurious claim
 *    already consumed this build's one-shot, a genuine deploy in the same tab
 *    session won't auto-reload — accepted, because navigations are
 *    network-first (fresh SSR HTML references the new chunks), so the tab
 *    self-heals on its next full navigation or cold start.
 * 3. Log every decision. The client logger flushes via sendBeacon on
 *    beforeunload, so the evidence survives the reload — the exact WebKit
 *    trigger can be pinned from prod logs if it recurs.
 *
 * The first-ever claim (controller: null → worker) still doesn't reload: it
 * happens on the very first visit, where the page came from the same deploy
 * as the worker. When sessionStorage is unavailable (private mode), an
 * in-memory marker caps repeats within the page instance and rule 1 still
 * suppresses the observed same-version loop.
 */

/** Message type the page sends to the SW to ask for its build version. */
export const SW_VERSION_REQUEST = 'sw-version';

const MARKER_KEY = 'quicklogger:reloaded-for';
const DEFAULT_QUERY_TIMEOUT_MS = 1000;

type Controller = {
  postMessage(message: unknown, transfer: Transferable[]): void;
};

type SwContainer = {
  controller: Controller | null;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
};

type Options = {
  serviceWorker: SwContainer;
  reload: () => void;
  /** This page's build version (`version` from `$app/environment`). */
  pageVersion: string;
  /** Where the one-shot marker lives — `sessionStorage` in the app. */
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  log?: (level: 'info' | 'warn', msg: string, ctx?: Record<string, unknown>) => void;
  queryTimeoutMs?: number;
};

export function registerControllerReload(opts: Options): () => void {
  const { serviceWorker, reload, pageVersion, storage } = opts;
  const log = opts.log ?? (() => {});
  const timeoutMs = opts.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;

  let hadController = Boolean(serviceWorker.controller);
  let deciding = false;
  let recheck = false;
  let memoryMarker: string | null = null;

  const readMarker = (): string | null => {
    try {
      return storage.getItem(MARKER_KEY) ?? memoryMarker;
    } catch {
      return memoryMarker;
    }
  };
  const writeMarker = (v: string): void => {
    memoryMarker = v;
    try {
      storage.setItem(MARKER_KEY, v);
    } catch {
      /* private mode — in-memory marker still caps this page instance */
    }
  };

  async function decide(): Promise<void> {
    for (;;) {
      recheck = false;
      const ctrl = serviceWorker.controller;
      if (!ctrl) {
        log('warn', 'sw controllerchange: no controller, not reloading', { pageVersion });
      } else {
        const swVersion = await queryVersion(ctrl, timeoutMs);
        if (swVersion === pageVersion) {
          log('warn', 'sw controllerchange: controller matches page build, not reloading', {
            pageVersion,
            swVersion
          });
        } else if (readMarker() === pageVersion) {
          log('warn', 'sw controllerchange: already reloaded once for this build, not reloading', {
            pageVersion,
            swVersion: swVersion ?? 'unknown'
          });
        } else {
          writeMarker(pageVersion);
          log('info', 'sw controllerchange: new build took control, reloading', {
            pageVersion,
            swVersion: swVersion ?? 'unknown'
          });
          reload();
          return; // page is tearing down — leave `deciding` latched
        }
      }
      if (!recheck) break;
    }
    deciding = false;
  }

  const onChange = () => {
    if (!hadController) {
      // First-ever claim on an uncontrolled load — same deploy, no reload.
      hadController = true;
      return;
    }
    if (deciding) {
      // Burst while a decision is in flight — re-run once with fresh state.
      recheck = true;
      return;
    }
    deciding = true;
    void decide();
  };

  serviceWorker.addEventListener('controllerchange', onChange);
  return () => serviceWorker.removeEventListener('controllerchange', onChange);
}

/**
 * Ask a controller for its build version over a dedicated MessageChannel.
 * Resolves `undefined` on timeout or a malformed reply — callers treat that
 * as "possibly a new build" (reload once, marker-capped), because a worker
 * too old to know the protocol IS an update boundary.
 */
function queryVersion(ctrl: Controller, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    let done = false;
    const finish = (v: string | undefined) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      channel.port1.close();
      resolve(v);
    };
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    channel.port1.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { version?: unknown } | null;
      finish(typeof data?.version === 'string' ? data.version : undefined);
    };
    try {
      ctrl.postMessage({ type: SW_VERSION_REQUEST }, [channel.port2]);
    } catch {
      finish(undefined);
    }
  });
}
