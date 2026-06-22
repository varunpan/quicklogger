import { toGallons, type VolumeUnit } from '$lib/shared/units';
import type { CurrencyService } from './currency';

export interface FuelInput {
  volume: number;
  volumeUnit: VolumeUnit;
  cost: number;
  currency: string;
  manualFxRate?: number;
}

export interface ConvertOptions {
  targetVolumeUnit: string;
  targetCurrency: string;
  currencyService: CurrencyService;
}

export interface ConvertResult {
  gallons: number;
  cost: number;
  fxRate: number;
  fxSource: string;
  fxFetchedAt?: number;
  fxStale?: boolean;
}

export async function convertSubmission(
  input: FuelInput,
  opts: ConvertOptions
): Promise<ConvertResult> {
  if (opts.targetVolumeUnit !== 'gallons_us') {
    throw new Error(
      `Unsupported target volume unit "${opts.targetVolumeUnit}" for v0.1.0; only gallons_us is supported`
    );
  }

  const gallons = toGallons(input.volume, input.volumeUnit);

  let fxRate: number;
  let fxSource: string;
  let fxFetchedAt: number | undefined;
  let fxStale = false;

  if (input.manualFxRate !== undefined) {
    fxRate = input.manualFxRate;
    fxSource = 'manual';
  } else {
    const rate = await opts.currencyService.getRate(input.currency, opts.targetCurrency);
    fxRate = rate.rate;
    fxSource = rate.source;
    fxFetchedAt = rate.fetchedAt;
    fxStale = rate.stale;
  }

  const cost = input.cost * fxRate;

  return { gallons, cost, fxRate, fxSource, fxFetchedAt, fxStale };
}
