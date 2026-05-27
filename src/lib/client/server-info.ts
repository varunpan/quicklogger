import type { ServerInfo } from '$lib/shared/types';

// Separate localStorage key from `quicklogger.prefs` on purpose: prefs holds
// user-chosen settings (written by the Settings UI); this holds upstream-derived
// config (written by a network refresh). Different writer, different lifecycle —
// mixing them risks savePrefs() partial-writes clobbering cached config.
const KEY = 'quicklogger-server-info';

export function loadServerInfo(): ServerInfo | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ServerInfo;
  } catch {
    return null;
  }
}

export function saveServerInfo(info: ServerInfo): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(KEY, JSON.stringify(info));
}
