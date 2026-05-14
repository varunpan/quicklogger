import { describe, it, expect, beforeEach } from 'vitest';
import { loadPrefs, savePrefs, DEFAULT_PREFS } from './prefs';

beforeEach(() => localStorage.clear());

describe('prefs', () => {
  it('returns defaults when nothing is stored', () => {
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
  it('round-trips a partial save', () => {
    savePrefs({ defaultVolumeUnit: 'L' });
    const p = loadPrefs();
    expect(p.defaultVolumeUnit).toBe('L');
    expect(p.defaultCurrency).toBe(DEFAULT_PREFS.defaultCurrency);
  });
  it('persists lastVehicleId', () => {
    savePrefs({ lastVehicleId: 7 });
    expect(loadPrefs().lastVehicleId).toBe(7);
  });
  it('survives malformed JSON in storage', () => {
    localStorage.setItem('quicklogger.prefs', 'not json');
    expect(loadPrefs()).toEqual(DEFAULT_PREFS);
  });
  it('defaults odometerPrefillEnabled to true', () => {
    expect(loadPrefs().odometerPrefillEnabled).toBe(true);
  });
  it('defaults odometerIncrementMi to 300', () => {
    expect(loadPrefs().odometerIncrementMi).toBe(300);
  });
  it('round-trips odometerPrefillEnabled', () => {
    savePrefs({ odometerPrefillEnabled: false });
    expect(loadPrefs().odometerPrefillEnabled).toBe(false);
  });
  it('round-trips odometerIncrementMi', () => {
    savePrefs({ odometerIncrementMi: 0 });
    expect(loadPrefs().odometerIncrementMi).toBe(0);
  });
  it('preserves odometer fields when partial save touches other keys', () => {
    savePrefs({ odometerIncrementMi: 250 });
    savePrefs({ defaultCurrency: 'EUR' });
    const p = loadPrefs();
    expect(p.odometerIncrementMi).toBe(250);
    expect(p.defaultCurrency).toBe('EUR');
  });
  it('defaults smartChecksEnabled to true', () => {
    expect(loadPrefs().smartChecksEnabled).toBe(true);
  });
  it('round-trips smartChecksEnabled', () => {
    savePrefs({ smartChecksEnabled: false });
    expect(loadPrefs().smartChecksEnabled).toBe(false);
  });
  it('preserves smartChecksEnabled across partial saves of other keys', () => {
    savePrefs({ smartChecksEnabled: false });
    savePrefs({ defaultCurrency: 'EUR' });
    const p = loadPrefs();
    expect(p.smartChecksEnabled).toBe(false);
    expect(p.defaultCurrency).toBe('EUR');
  });
  it('legacy JSON without smartChecksEnabled picks up the default', () => {
    // Mimics a localStorage value written by a pre-0.2.0 build.
    localStorage.setItem(
      'quicklogger.prefs',
      JSON.stringify({
        lastVehicleId: 4,
        defaultVolumeUnit: 'gal',
        defaultCurrency: 'USD',
        odometerPrefillEnabled: true,
        odometerIncrementMi: 300
      })
    );
    expect(loadPrefs().smartChecksEnabled).toBe(true);
  });
});
