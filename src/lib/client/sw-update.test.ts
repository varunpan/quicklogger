import { describe, it, expect, vi } from 'vitest';
import { registerControllerReload, SW_VERSION_REQUEST } from './sw-update';

// Fast version-query timeout for tests; settle() must outlast it.
const QUERY_TIMEOUT_MS = 20;
const settle = () => new Promise((r) => setTimeout(r, QUERY_TIMEOUT_MS * 3));

/**
 * Mimics the service-worker side of the version-query contract: replies on
 * the transferred MessagePort with { version } — or never replies when
 * `versionReply()` returns undefined (a dead/legacy worker → timeout path).
 */
function fakeController(versionReply: () => string | undefined) {
  const postMessage = vi.fn((msg: unknown, transfer: Transferable[]) => {
    const m = msg as { type?: string } | undefined;
    if (m?.type !== SW_VERSION_REQUEST) return;
    const version = versionReply();
    if (version === undefined) return;
    (transfer[0] as MessagePort).postMessage({ version });
  });
  return { postMessage };
}

function fakeContainer(controller: ReturnType<typeof fakeController> | null) {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    fire: () => [...listeners].forEach((l) => l()),
    listenerCount: () => listeners.size
  };
}

function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    values: () => [...map.values()]
  };
}

function throwingStorage() {
  return {
    getItem: (): string | null => {
      throw new Error('denied');
    },
    setItem: (): void => {
      throw new Error('denied');
    }
  };
}

function register(
  sw: ReturnType<typeof fakeContainer>,
  overrides: Partial<{
    reload: () => void;
    pageVersion: string;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    log: (level: 'info' | 'warn', msg: string, ctx?: Record<string, unknown>) => void;
  }> = {}
) {
  const reload = overrides.reload ?? vi.fn();
  const cleanup = registerControllerReload({
    serviceWorker: sw,
    reload,
    pageVersion: overrides.pageVersion ?? 'v1',
    storage: overrides.storage ?? fakeStorage(),
    log: overrides.log,
    queryTimeoutMs: QUERY_TIMEOUT_MS
  });
  return { reload, cleanup };
}

describe('registerControllerReload', () => {
  it('does not reload on the first-ever claim (no prior controller)', async () => {
    const sw = fakeContainer(null);
    const { reload } = register(sw);

    sw.fire(); // first claim: null → worker
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads exactly once when a different-version worker takes control (deploy)', async () => {
    const sw = fakeContainer(fakeController(() => 'v2'));
    const storage = fakeStorage();
    const { reload } = register(sw, { storage, pageVersion: 'v1' });

    sw.fire();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.values()).toContain('v1'); // marker survives into the next page
  });

  it('#39 regression: repeated controllerchange from a same-version controller never reloads', async () => {
    const sw = fakeContainer(fakeController(() => 'v1'));
    const { reload } = register(sw, { pageVersion: 'v1' });

    for (let i = 0; i < 5; i++) {
      sw.fire();
      await settle();
    }
    expect(reload).not.toHaveBeenCalled();
  });

  it('#39 regression: the one-shot marker survives the reload and breaks the loop', async () => {
    // Page instance 1: unanswered query → conservative reload, marker written.
    const storage = fakeStorage();
    const sw1 = fakeContainer(fakeController(() => undefined));
    const { reload: reload1 } = register(sw1, { storage, pageVersion: 'v1' });
    sw1.fire();
    await settle();
    expect(reload1).toHaveBeenCalledTimes(1);

    // Page instance 2 after the reload: same build, same sessionStorage.
    // Even a different-version claim must not reload again for this build.
    const sw2 = fakeContainer(fakeController(() => 'v2'));
    const { reload: reload2 } = register(sw2, { storage, pageVersion: 'v1' });
    sw2.fire();
    await settle();
    expect(reload2).not.toHaveBeenCalled();
  });

  it("an older build's marker does not block this build's update", async () => {
    // A v1 page reloaded once (marker=v1); the page now runs v2 and a v3 worker claims.
    const storage = fakeStorage();
    storage.setItem('quicklogger:reloaded-for', 'v1');
    const sw = fakeContainer(fakeController(() => 'v3'));
    const { reload } = register(sw, { storage, pageVersion: 'v2' });

    sw.fire();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload when controllerchange fires with no controller', async () => {
    const sw = fakeContainer(fakeController(() => 'v2'));
    const { reload } = register(sw, { pageVersion: 'v1' });

    sw.controller = null; // e.g. unregistration
    sw.fire();
    await settle();
    expect(reload).not.toHaveBeenCalled();
  });

  it('coalesces a controllerchange burst into a single reload', async () => {
    const sw = fakeContainer(fakeController(() => 'v2'));
    const { reload } = register(sw, { pageVersion: 'v1' });

    sw.fire();
    sw.fire();
    sw.fire();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a suppressed same-version event does not block a later genuine update', async () => {
    let version = 'v1';
    const sw = fakeContainer(fakeController(() => version));
    const { reload } = register(sw, { pageVersion: 'v1' });

    sw.fire(); // same version → suppressed
    await settle();
    expect(reload).not.toHaveBeenCalled();

    version = 'v2'; // a real deploy lands
    sw.fire();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('falls back to an in-memory marker when sessionStorage throws (private mode)', async () => {
    const sw = fakeContainer(fakeController(() => 'v2'));
    const { reload } = register(sw, { storage: throwingStorage(), pageVersion: 'v1' });

    sw.fire();
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);

    sw.fire(); // marker held in memory caps this page instance
    await settle();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('logs every decision so prod evidence survives the reload', async () => {
    const log = vi.fn();
    const sw = fakeContainer(fakeController(() => 'v1'));
    register(sw, { pageVersion: 'v1', log });

    sw.fire();
    await settle();
    expect(log).toHaveBeenCalled();
    const [, , ctx] = log.mock.calls[0];
    expect(ctx).toMatchObject({ pageVersion: 'v1', swVersion: 'v1' });
  });

  it('cleanup removes the listener', async () => {
    const sw = fakeContainer(fakeController(() => 'v2'));
    const { reload, cleanup } = register(sw);
    cleanup();

    sw.fire();
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(sw.listenerCount()).toBe(0);
  });
});
