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
    case 'gal':
      return value;
    case 'L':
      return value / GAL_TO_L;
    default:
      throw new TypeError(`Unknown volume unit: ${String(unit)}`);
  }
}

export function toLiters(value: number, unit: VolumeUnit): number {
  assertNonNegative(value);
  switch (unit) {
    case 'L':
      return value;
    case 'gal':
      return value * GAL_TO_L;
    default:
      throw new TypeError(`Unknown volume unit: ${String(unit)}`);
  }
}

/** The unit a LubeLogger instance stores fuel volume in (LUBELOGGER_VOLUME_UNIT). */
export type LubeLoggerVolumeUnit = 'gallons_us' | 'liters';

/** The unit a LubeLogger instance tracks distance in (LUBELOGGER_DISTANCE_UNIT). */
export type LubeLoggerDistanceUnit = 'miles' | 'km';

/** Display form of the instance distance unit ("84,012 mi" / "84,012 km"). */
export type DistanceUnit = 'mi' | 'km';
