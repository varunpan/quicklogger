// Dedicated localStorage key — home-banner UI state, NOT a Settings pref and
// NOT server-derived. Kept out of `quicklogger.prefs` (single-writer per key;
// see server-info.ts) and out of `quicklogger-server-info` (network-written).
const KEY = 'quicklogger.dismissedUpdateVersion';

/** The version whose home update-banner the user dismissed, or null. */
export function loadDismissedUpdateVersion(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function saveDismissedUpdateVersion(version: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(KEY, version);
  } catch {
    /* private mode / quota — non-fatal; the banner simply reappears next load */
  }
}
