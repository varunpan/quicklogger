export type VolumeUnit = 'gal' | 'L';

export interface FuelSubmissionInput {
  vehicleId: number;
  date: string;
  odometer: number;
  volume: number;
  volumeUnit: VolumeUnit;
  cost: number;
  currency: string;
  isFillToFull: boolean;
  missedFuelup: boolean;
  notes?: string;
  tags?: string;
  manualFxRate?: number;
  clientSubmissionId: string;
}

export interface FuelSubmissionResult {
  ok: true;
  submitted: {
    gallons: number;
    cost: number;
    fxRate: number;
    fxSource: string;
    fxStale?: boolean;
  };
}

// --- Photo OCR (v0.2.0+) ---
export type OcrMode = 'pump' | 'odometer';

export interface OcrPumpResult {
  mode: 'pump';
  volume: number;
  volumeUnit: VolumeUnit;
  cost: number;
  pricePerUnit: number;
}

export interface OcrOdometerResult {
  mode: 'odometer';
  odometer: number;
}

export type OcrResult = OcrPumpResult | OcrOdometerResult;

export interface OcrStatus {
  enabled: boolean;
  modes?: OcrMode[];
  // Sum of effective chain's per-slot timeouts, in milliseconds. Present
  // only when enabled=true. Client uses (chainTimeoutMs + 10_000) as its
  // request-side AbortSignal.timeout — falls back to a static 90 s when
  // the field is absent (older server, or probe in degraded mode).
  chainTimeoutMs?: number;
}

// --- LubeLogger server info (v0.2.3+) ---
export type ServerInfoStatus = 'ok' | 'unauthorized' | 'unreachable';

export interface ServerInfo {
  /** True iff at least one upstream call (/api/info or /api/version) resolved. */
  reachable: boolean;
  status: ServerInfoStatus;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean;
  // Cached from /api/info; unused this branch (consumed by the follow-up).
  locale: string | null;
  currencySymbol: string | null;
  decimalSeparator: string | null;
  dateFormat: string | null;
}
