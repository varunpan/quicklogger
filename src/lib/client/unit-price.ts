import { formatCost } from './format';
import { toGallons, type VolumeUnit } from '$lib/shared/units';
import type { ConvertedSnapshot } from './idb';

// The app's converted basis is gallons everywhere — the server rejects any
// other LUBELOGGER_VOLUME_UNIT (convert.ts), and no instance-unit value is
// ever sent to the client — so the converted half is always per-gallon.
const INSTANCE_UNIT = 'gal';

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
 * - `converted` (per gallon) is shown only when the row differs from the
 *   instance basis:
 *     - unit differs, currency matches → pure math (no FX, no snapshot);
 *     - currency differs → rendered from `converted` (the saved snapshot);
 *       omitted (`null`) when the snapshot is absent (pre-sync row).
 *
 * `instanceCurrency` is the LubeLogger instance currency, read by the caller
 * (the page, where `localStorage` is available) via `effectiveCurrencyCode()`.
 */
export function unitPriceDisplay(
  input: UnitPriceInput,
  converted: ConvertedSnapshot | undefined,
  instanceCurrency: string
): UnitPriceDisplay {
  const actual = `${formatCost(input.cost / input.volume, input.currency)}/${input.volumeUnit}`;

  const currencyDiffers = input.currency !== instanceCurrency;
  const unitDiffers = input.volumeUnit !== INSTANCE_UNIT;

  if (!currencyDiffers && !unitDiffers) {
    return { actual, converted: null };
  }

  // Unit differs but currency matches → pure arithmetic, no FX, no snapshot.
  if (!currencyDiffers) {
    const perGal = input.cost / toGallons(input.volume, input.volumeUnit);
    return { actual, converted: `${formatCost(perGal, input.currency)}/${INSTANCE_UNIT}` };
  }

  // Currency differs → render from the saved snapshot; omit if absent (pre-sync).
  if (converted) {
    const perGal = converted.cost / toGallons(input.volume, input.volumeUnit);
    return { actual, converted: `≈ ${formatCost(perGal, converted.currency)}/${INSTANCE_UNIT}` };
  }

  return { actual, converted: null };
}
