export type VolumeUnit = 'gal' | 'L';

export const GAL_TO_L = 3.785411784;

function assertNonNegative(value: number): void {
  if (value < 0) {
    throw new RangeError(`Volume must be non-negative, got ${value}`);
  }
}

export function toGallons(value: number, unit: VolumeUnit): number {
  assertNonNegative(value);
  switch (unit) {
    case 'gal': return value;
    case 'L':   return value / GAL_TO_L;
    default:
      throw new TypeError(`Unknown volume unit: ${String(unit)}`);
  }
}

export function toLiters(value: number, unit: VolumeUnit): number {
  assertNonNegative(value);
  switch (unit) {
    case 'L':   return value;
    case 'gal': return value * GAL_TO_L;
    default:
      throw new TypeError(`Unknown volume unit: ${String(unit)}`);
  }
}
