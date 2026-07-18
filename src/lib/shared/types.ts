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
  /** Set (literal `true`) by the SW replay loop on every queued-entry POST —
   *  the server then checks LubeLogger for an already-landed record before
   *  writing (day-later replay dedupe; see docs/technical/offline-queue.md).
   *  Foreground submits never set it. Any non-`true` value is treated as
   *  absent server-side. */
  queueReplay?: boolean;
}

export interface FuelSubmissionResult {
  ok: true;
  submitted: {
    /** Volume converted into the instance unit (`volumeUnit`). Renamed from
     *  `gallons` in v0.3.2 when liters instances became supported. */
    volume: number;
    volumeUnit: VolumeUnit;
    cost: number;
    /** Instance currency `cost` is denominated in (ISO 4217). Used by both
     *  snapshot write sites so the converted unit price is server-authoritative
     *  and SW-safe — see docs/technical/fillup-unit-price.md. */
    currency: string;
    fxRate: number;
    fxSource: string;
    fxStale?: boolean;
  };
  /** Present iff the submit requested photo attachment but ≥1 image did not
   *  attach. The record was still created (record-first policy). */
  photoWarning?: string;
  /** Present (literal `true`) iff a `queueReplay`-flagged submit matched a
   *  record already in LubeLogger — no new write happened; `submitted` mirrors
   *  the matched record (its `fuelConsumed`/`cost`), not a fresh conversion. */
  deduped?: boolean;
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
  // Cached from /api/info.
  locale: string | null;
  currencySymbol: string | null;
  decimalSeparator: string | null;
  dateFormat: string | null;
  // LubeLogger instance currency (ISO code) — sourced from server env
  // (LUBELOGGER_CURRENCY, default 'USD'). Independent of LubeLogger's
  // /api/info: it's the value the server uses when converting submissions,
  // so it's authoritative for rendering upstream-cached entries.
  lubeloggerCurrency: string | null;
  // --- quicklogger self-update check (v0.2.3+) ---
  // The app's own version vs the latest quicklogger GitHub release. Deploy
  // stays manual; these only drive an informational "update available" hint.
  appCurrentVersion: string | null; // __APP_VERSION__ at runtime (set even on the unreachable fallback); null only when the Vite define is absent (vitest)
  appLatestVersion: string | null; // latest GitHub release tag, v-stripped; null if unknown
  appUpdateAvailable: boolean; // _isUpdateAvailable(appCurrentVersion, appLatestVersion)
  appReleaseUrl: string | null; // GitHub release html_url; null if unknown
}
