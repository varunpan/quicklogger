import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { loadDismissedUpdateVersion, saveDismissedUpdateVersion } from './dismissed-update';

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('dismissed-update cache', () => {
  it('returns null when nothing is stored', () => {
    expect(loadDismissedUpdateVersion()).toBeNull();
  });
  it('round-trips a saved version', () => {
    saveDismissedUpdateVersion('0.2.4');
    expect(loadDismissedUpdateVersion()).toBe('0.2.4');
  });
  it('returns null when localStorage is undefined (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(loadDismissedUpdateVersion()).toBeNull();
  });
  it('save is a no-op when localStorage is undefined (SSR)', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => saveDismissedUpdateVersion('0.2.4')).not.toThrow();
  });
});
