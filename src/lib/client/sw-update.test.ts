import { describe, it, expect, vi } from 'vitest';
import { registerControllerReload } from './sw-update';

function fakeContainer(controller: unknown) {
  const listeners = new Set<() => void>();
  return {
    controller,
    addEventListener: (_: string, l: () => void) => void listeners.add(l),
    removeEventListener: (_: string, l: () => void) => void listeners.delete(l),
    fire: () => listeners.forEach((l) => l()),
    listenerCount: () => listeners.size
  };
}

describe('registerControllerReload', () => {
  it('does not reload on the first-ever claim (no prior controller)', () => {
    const sw = fakeContainer(null);
    const reload = vi.fn();
    registerControllerReload(sw, reload);

    sw.fire(); // first claim: null → worker
    expect(reload).not.toHaveBeenCalled();

    sw.fire(); // a real update after that first claim
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads when a controlled page gets a new controller (deploy)', () => {
    const sw = fakeContainer({});
    const reload = vi.fn();
    registerControllerReload(sw, reload);

    sw.fire();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('cleanup removes the listener', () => {
    const sw = fakeContainer({});
    const reload = vi.fn();
    const cleanup = registerControllerReload(sw, reload);
    cleanup();

    sw.fire();
    expect(reload).not.toHaveBeenCalled();
    expect(sw.listenerCount()).toBe(0);
  });
});
