import { formatCost } from './format';
import { toGallons, toLiters, type VolumeUnit } from '$lib/shared/units';
import type { ConvertedSnapshot } from './idb';

export interface UnitPriceInput {
  cost: number;
  currency: string;
  volume: number;
  volumeUnit: VolumeUnit;
}

export interface UnitPriceDisplay {
  /** Always present: price per logged unit in the logged currency, e.g. "CA$1.45/L". */
  actual: string;
  /** Cross-currency → "≈ $4.06/gal"; unit-only → "$4.06/gal"; otherwise null. */
  converted: string | null;
}

/**
 * Format a fillup's unit price for a /history card.
 *
 * - `actual` is pure arithmetic from the row (`cost / volume`), always shown.
 * - `converted` (per instance unit) is shown only when the row differs from
 *   the instance basis:
 *     - unit differs, currency matches → pure math (no FX, no snapshot);
 *     - currency differs → rendered from `converted` (the saved snapshot);
 *       omitted (`null`) when the snapshot is absent (pre-sync row).
 *
 * `instanceCurrency` / `instanceUnit` are the LubeLogger instance basis, read
 * by the caller (the page, where `localStorage` is available) via
 * `effectiveCurrencyCode()` / `effectiveVolumeUnit()`.
 */
export function unitPriceDisplay(
  input: UnitPriceInput,
  converted: ConvertedSnapshot | undefined,
  instanceCurrency: string,
  instanceUnit: VolumeUnit
): UnitPriceDisplay {
  const actual = `${formatCost(input.cost / input.volume, input.currency)}/${input.volumeUnit}`;

  const inInstanceUnit = (v: number, u: VolumeUnit): number =>
    instanceUnit === 'L' ? toLiters(v, u) : toGallons(v, u);

  const currencyDiffers = input.currency !== instanceCurrency;
  const unitDiffers = input.volumeUnit !== instanceUnit;

  if (!currencyDiffers && !unitDiffers) {
    return { actual, converted: null };
  }

  // Unit differs but currency matches → pure arithmetic, no FX, no snapshot.
  if (!currencyDiffers) {
    const perUnit = input.cost / inInstanceUnit(input.volume, input.volumeUnit);
    return { actual, converted: `${formatCost(perUnit, input.currency)}/${instanceUnit}` };
  }

  // Currency differs → render from the saved snapshot; omit if absent (pre-sync).
  if (converted) {
    const perUnit = converted.cost / inInstanceUnit(input.volume, input.volumeUnit);
    return { actual, converted: `≈ ${formatCost(perUnit, converted.currency)}/${instanceUnit}` };
  }

  return { actual, converted: null };
}
