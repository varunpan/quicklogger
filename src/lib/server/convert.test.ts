import { describe, it, expect } from 'vitest';
import { convertSubmission, type FuelInput } from './convert';
import type { CurrencyService } from './currency';

function fakeCurrency(rate: number, source: 'frankfurter' | 'manual' = 'frankfurter') {
  return {
    async getRate() {
      return { rate, source, fetchedAt: Date.now(), stale: false, ageHours: 0 };
    }
  } as unknown as CurrencyService;
}

describe('convertSubmission', () => {
  it('converts L + CAD to gallons_us + USD using FX rate', async () => {
    const input: FuelInput = { volume: 50, volumeUnit: 'L', cost: 65, currency: 'CAD' };
    const result = await convertSubmission(input, {
      targetVolumeUnit: 'gallons_us',
      targetCurrency: 'USD',
      currencyService: fakeCurrency(0.73)
    });
    expect(result.gallons).toBeCloseTo(13.2086, 4);
    expect(result.cost).toBeCloseTo(47.45, 2);
    expect(result.fxRate).toBe(0.73);
    expect(result.fxSource).toBe('frankfurter');
  });

  it('passes through gallons + USD with rate 1', async () => {
    const result = await convertSubmission(
      { volume: 11.2, volumeUnit: 'gal', cost: 42.18, currency: 'USD' },
      { targetVolumeUnit: 'gallons_us', targetCurrency: 'USD', currencyService: fakeCurrency(1) }
    );
    expect(result.gallons).toBe(11.2);
    expect(result.cost).toBe(42.18);
    expect(result.fxRate).toBe(1);
  });

  it('records manual FX source when service returns manual', async () => {
    const result = await convertSubmission(
      { volume: 50, volumeUnit: 'L', cost: 65, currency: 'CAD' },
      {
        targetVolumeUnit: 'gallons_us',
        targetCurrency: 'USD',
        currencyService: fakeCurrency(0.74, 'manual')
      }
    );
    expect(result.fxSource).toBe('manual');
  });

  it('uses manual override rate when provided', async () => {
    const input: FuelInput = {
      volume: 50,
      volumeUnit: 'L',
      cost: 65,
      currency: 'CAD',
      manualFxRate: 0.72
    };
    const result = await convertSubmission(input, {
      targetVolumeUnit: 'gallons_us',
      targetCurrency: 'USD',
      currencyService: fakeCurrency(0.99)
    });
    expect(result.fxRate).toBe(0.72);
    expect(result.fxSource).toBe('manual');
    expect(result.cost).toBeCloseTo(46.8, 2);
  });

  it('rejects unsupported target volume unit', async () => {
    await expect(
      convertSubmission(
        { volume: 50, volumeUnit: 'L', cost: 65, currency: 'CAD' },
        { targetVolumeUnit: 'kWh', targetCurrency: 'USD', currencyService: fakeCurrency(0.73) }
      )
    ).rejects.toThrow(/target volume unit/i);
  });
});
