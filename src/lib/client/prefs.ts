import type { VolumeUnit } from '$lib/shared/types';

export interface Prefs {
  lastVehicleId: number | null;
  defaultVolumeUnit: VolumeUnit;
  defaultCurrency: string;
  odometerPrefillEnabled: boolean;
  odometerIncrementMi: number;
  smartChecksEnabled: boolean;
  /** How many synced fill-ups the offline queue keeps per vehicle — the
   *  History page renders these rows, so this is History's retention cap.
   *  Consumed by the queue drain's pruneSynced (sync-queue.ts). Whole
   *  number ≥ 1; consumers sanitize and fall back to the default. */
  historyKeepPerVehicle: number;
}

export const DEFAULT_PREFS: Prefs = {
  lastVehicleId: null,
  defaultVolumeUnit: 'gal',
  defaultCurrency: 'USD',
  odometerPrefillEnabled: true,
  odometerIncrementMi: 300,
  smartChecksEnabled: true,
  historyKeepPerVehicle: 200
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
