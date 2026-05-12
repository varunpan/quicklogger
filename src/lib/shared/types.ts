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
// Wire format accepts 'receipt' (returns 501 in v0.2.0); the OcrMode union
// captures only modes the dispatcher actively handles.
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
}
