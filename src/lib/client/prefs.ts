import type { VolumeUnit } from '$lib/shared/types';

export interface Prefs {
  lastVehicleId: number | null;
  defaultVolumeUnit: VolumeUnit;
  defaultCurrency: string;
}

export const DEFAULT_PREFS: Prefs = {
  lastVehicleId: null,
  defaultVolumeUnit: 'gal',
  defaultCurrency: 'USD'
};

const KEY = 'quicklogger.prefs';

export function loadPrefs(): Prefs {
  if (typeof localStorage === 'undefined') return DEFAULT_PREFS;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PREFS, ...parsed };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function savePrefs(patch: Partial<Prefs>): void {
  if (typeof localStorage === 'undefined') return;
  const next = { ...loadPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
}
