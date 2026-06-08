import { describe, it, expect, vi } from 'vitest';
import { registerSyncTriggers, type SyncTriggerDeps } from './sync-trigger';

type FlushTarget = { postMessage: (message: unknown) => void };

function makeDeps(opts: { controller?: FlushTarget | null; ready?: Promise<unknown> } = {}) {
  const post = vi.fn();
  const controller: FlushTarget | null =
    'controller' in opts ? (opts.controller ?? null) : { postMessage: post };
  // Pending by default so the ready-gated initial drain doesn't fire and
  // interfere with the per-event assertions; the dedicated test passes a
  // resolved promise.
  const ready = opts.ready ?? new Promise<unknown>(() => {});
  const win = new EventTarget();
  const doc = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState
  });
  const deps: SyncTriggerDeps = { serviceWorker: { controller, ready }, window: win, document: doc };
  return { post, win, doc, deps };
}

describe('registerSyncTriggers', () => {
  it('flushes the queue when the window goes back online', () => {
    const { post, win, deps } = makeDeps();
    registerSyncTriggers(deps);

    win.dispatchEvent(new Event('online'));

    expect(post).toHaveBeenCalledWith({ type: 'sync-queue' });
  });

  it('flushes on window focus', () => {
    const { post, win, deps } = makeDeps();
    registerSyncTriggers(deps);

    win.dispatchEvent(new Event('focus'));

    expect(post).toHaveBeenCalledWith({ type: 'sync-queue' });
  });

  it('flushes on visibilitychange when the page is visible', () => {
    const { post, doc, deps } = makeDeps();
    doc.visibilityState = 'visible';
    registerSyncTriggers(deps);

    doc.dispatchEvent(new Event('visibilitychange'));

    expect(post).toHaveBeenCalledWith({ type: 'sync-queue' });
  });

  it('does not flush on visibilitychange when the page is hidden', () => {
    const { post, doc, deps } = makeDeps();
    doc.visibilityState = 'hidden';
    registerSyncTriggers(deps);

    doc.dispatchEvent(new Event('visibilitychange'));

    expect(post).not.toHaveBeenCalled();
  });

  it('flushes once the service worker is ready (initial drain)', async () => {
    const { post, deps } = makeDeps({ ready: Promise.resolve() });
    registerSyncTriggers(deps);

    await Promise.resolve(); // let the ready.then microtask run

    expect(post).toHaveBeenCalledWith({ type: 'sync-queue' });
  });

  it('does not throw when no controller is controlling the page yet', () => {
    const { win, deps } = makeDeps({ controller: null });
    registerSyncTriggers(deps);

    expect(() => win.dispatchEvent(new Event('online'))).not.toThrow();
  });

  it('cleanup removes every listener', () => {
    const { post, win, doc, deps } = makeDeps();
    const cleanup = registerSyncTriggers(deps);

    cleanup();
    win.dispatchEvent(new Event('online'));
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));

    expect(post).not.toHaveBeenCalled();
  });
});
