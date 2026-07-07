import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSelectedVehicle } from './vehicle-resolve';
import { savePrefs } from './prefs';
import type { Vehicle } from '$lib/server/lubelogger';

const VEHICLES: Vehicle[] = [
  { id: 1, make: 'Honda', model: 'Civic Si' },
  { id: 2, make: 'Toyota', model: 'Sienna' }
];

function urlWith(vehicleId?: string): URL {
  return new URL(`http://localhost/history${vehicleId !== undefined ? `?vehicleId=${vehicleId}` : ''}`);
}

beforeEach(() => localStorage.clear());

describe('resolveSelectedVehicle', () => {
  it('URL ?vehicleId= wins over prefs', () => {
    savePrefs({ lastVehicleId: 1 });
    expect(resolveSelectedVehicle(VEHICLES, urlWith('2'))?.id).toBe(2);
  });

  it('falls back to prefs.lastVehicleId without a URL param', () => {
    savePrefs({ lastVehicleId: 2 });
    expect(resolveSelectedVehicle(VEHICLES, urlWith())?.id).toBe(2);
  });

  it('falls back to vehicles[0] when neither source resolves', () => {
    expect(resolveSelectedVehicle(VEHICLES, urlWith())?.id).toBe(1);
  });

  it('falls back to vehicles[0] when the candidate id matches nothing', () => {
    savePrefs({ lastVehicleId: 99 });
    expect(resolveSelectedVehicle(VEHICLES, urlWith())?.id).toBe(1);
  });

  it('ignores a non-positive or non-numeric URL param', () => {
    savePrefs({ lastVehicleId: 2 });
    expect(resolveSelectedVehicle(VEHICLES, urlWith('0'))?.id).toBe(2);
    expect(resolveSelectedVehicle(VEHICLES, urlWith('abc'))?.id).toBe(2);
  });

  it('returns null on an empty vehicle list', () => {
    expect(resolveSelectedVehicle([], urlWith('1'))).toBeNull();
  });
});
