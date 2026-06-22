import { describe, it, expect } from 'vitest';
import { toGallons, toLiters, GAL_TO_L } from './units';

describe('units', () => {
  it('exposes the exact US gal→L factor', () => {
    expect(GAL_TO_L).toBe(3.785411784);
  });

  it('converts liters to US gallons', () => {
    expect(toGallons(3.785411784, 'L')).toBeCloseTo(1, 9);
    expect(toGallons(50, 'L')).toBeCloseTo(13.20860, 4);
  });

  it('passes US gallons through unchanged', () => {
    expect(toGallons(11.2, 'gal')).toBe(11.2);
  });

  it('converts US gallons to liters', () => {
    expect(toLiters(1, 'gal')).toBeCloseTo(3.785411784, 9);
  });

  it('passes liters through unchanged', () => {
    expect(toLiters(50, 'L')).toBe(50);
  });

  it('rejects negative volumes', () => {
    expect(() => toGallons(-1, 'gal')).toThrow(/non-negative/);
    expect(() => toLiters(-1, 'L')).toThrow(/non-negative/);
  });

  it('accepts zero', () => {
    expect(toGallons(0, 'L')).toBe(0);
    expect(toLiters(0, 'gal')).toBe(0);
  });

  it('handles very large volumes without precision loss beyond 1e-6', () => {
    const liters = 1_000_000;
    const gallons = toGallons(liters, 'L');
    expect(toLiters(gallons, 'gal')).toBeCloseTo(liters, 4);
  });

  it('throws on unknown unit', () => {
    // @ts-expect-error — invalid unit at runtime
    expect(() => toGallons(1, 'oz')).toThrow(/unit/i);
  });
});
