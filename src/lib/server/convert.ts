import { toGallons, toLiters, type VolumeUnit, type LubeLoggerVolumeUnit } from '$lib/shared/units';
import type { CurrencyService } from './currency';

export interface FuelInput {
  volume: number;
  volumeUnit: VolumeUnit;
  cost: number;
  currency: string;
  manualFxRate?: number;
}

export interface ConvertOptions {
  targetVolumeUnit: LubeLoggerVolumeUnit;
  targetCurrency: string;
  currencyService: CurrencyService;
}

export interface ConvertResult {
  /** Volume converted into the instance unit (`volumeUnit`). */
  volume: number;
  /** Display form of the instance unit the conversion targeted. */
  volumeUnit: VolumeUnit;
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
  const volumeUnit: VolumeUnit = opts.targetVolumeUnit === 'liters' ? 'L' : 'gal';
  const volume =
    volumeUnit === 'L'
      ? toLiters(input.volume, input.volumeUnit)
      : toGallons(input.volume, input.volumeUnit);

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

  return { volume, volumeUnit, cost, fxRate, fxSource, fxFetchedAt, fxStale };
}
