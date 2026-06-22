import { describe, it, expect } from 'vitest';
import { unitPriceDisplay } from './unit-price';

// formatCost renders under the en-US/USD fallback in the test env (no
// server-info seeded): USD → "$x", CAD → "CA$x", both 2-decimal.
describe('unitPriceDisplay', () => {
  it('instance basis (USD/gal): actual only, no converted half', () => {
    const d = unitPriceDisplay(
      { cost: 36.35, currency: 'USD', volume: 11.544, volumeUnit: 'gal' },
      undefined,
      'USD'
    );
    expect(d.actual).toBe('$3.15/gal');
    expect(d.converted).toBeNull();
  });

  it('liter row: actual half is per-litre in the logged currency', () => {
    const d = unitPriceDisplay(
      { cost: 60.0, currency: 'CAD', volume: 40.0, volumeUnit: 'L' },
      { cost: 42.3, currency: 'USD' },
      'USD'
    );
    expect(d.actual).toBe('CA$1.50/L');
  });

  it('cross-currency: converted half from the snapshot, ≈ marker, per gallon', () => {
    const d = unitPriceDisplay(
      { cost: 60.0, currency: 'CAD', volume: 40.0, volumeUnit: 'L' },
      { cost: 42.3, currency: 'USD' },
      'USD'
    );
    // toGallons(40,'L') = 10.5669 gal; 42.30 / 10.5669 = 4.003 → $4.00
    expect(d.converted).toBe('≈ $4.00/gal');
  });

  it('unit-only conversion (currency matches, unit differs): no ≈, no snapshot needed', () => {
    const d = unitPriceDisplay(
      { cost: 42.3, currency: 'USD', volume: 40.0, volumeUnit: 'L' },
      undefined,
      'USD'
    );
    expect(d.converted).toBe('$4.00/gal');
  });

  it('cross-currency with no snapshot (pre-sync): converted omitted, actual still present', () => {
    const d = unitPriceDisplay(
      { cost: 58.0, currency: 'CAD', volume: 40.0, volumeUnit: 'L' },
      undefined,
      'USD'
    );
    expect(d.actual).toBe('CA$1.45/L');
    expect(d.converted).toBeNull();
  });

  it('cross-currency gallons row (CAD/gal) uses the snapshot, ≈ marker', () => {
    const d = unitPriceDisplay(
      { cost: 50.0, currency: 'CAD', volume: 12.5, volumeUnit: 'gal' },
      { cost: 36.5, currency: 'USD' },
      'USD'
    );
    expect(d.actual).toBe('CA$4.00/gal');
    expect(d.converted).toBe('≈ $2.92/gal');
  });
});
