import { describe, it, expect } from 'vitest';
import { extractVin, normalizeVehicleIdentifiers } from './vehicle-identifiers';
import type { Vehicle } from './lubelogger';

function v(overrides: Partial<Vehicle> = {}): Vehicle {
  return { id: 1, year: 2014, make: 'Honda', model: 'Accord', ...overrides };
}

describe('extractVin', () => {
  it('returns the VIN value when present in extraFields', () => {
    const vin = extractVin(
      v({
        extraFields: [
          { name: 'VIN', value: '1HGCR2F80EA00735', isRequired: false, fieldType: 0 },
          { name: 'Trim', value: 'EX-L', isRequired: false, fieldType: 0 }
        ]
      })
    );
    expect(vin).toBe('1HGCR2F80EA00735');
  });

  it('trims whitespace around the value', () => {
    const vin = extractVin(
      v({ extraFields: [{ name: 'VIN', value: '  1HGCR2F80EA00735  ' }] })
    );
    expect(vin).toBe('1HGCR2F80EA00735');
  });

  it('matches the name case-insensitively', () => {
    for (const name of ['VIN', 'Vin', 'vin', '  Vin  ']) {
      const vin = extractVin(v({ extraFields: [{ name, value: 'X' }] }));
      expect(vin, `name=${JSON.stringify(name)}`).toBe('X');
    }
  });

  it('returns undefined when the value is an empty string', () => {
    expect(extractVin(v({ extraFields: [{ name: 'VIN', value: '' }] }))).toBeUndefined();
  });

  it('returns undefined when the value is whitespace-only', () => {
    expect(extractVin(v({ extraFields: [{ name: 'VIN', value: '   ' }] }))).toBeUndefined();
  });

  it('returns undefined when no VIN row exists', () => {
    expect(
      extractVin(v({ extraFields: [{ name: 'Trim', value: 'EX-L' }] }))
    ).toBeUndefined();
  });

  it('returns undefined when extraFields is missing', () => {
    expect(extractVin(v())).toBeUndefined();
  });

  it('returns undefined when extraFields is not an array', () => {
    expect(
      extractVin(v({ extraFields: 'nope' as unknown as Vehicle['extraFields'] }))
    ).toBeUndefined();
  });

  it('returns the first non-empty VIN when two VIN rows exist', () => {
    const vin = extractVin(
      v({
        extraFields: [
          { name: 'VIN', value: '' },
          { name: 'VIN', value: 'SECOND' },
          { name: 'VIN', value: 'THIRD' }
        ]
      })
    );
    expect(vin).toBe('SECOND');
  });

  it('skips rows with non-string name', () => {
    expect(
      extractVin(
        v({
          extraFields: [
            { name: 42 as unknown as string, value: 'wrong' },
            { name: 'VIN', value: 'right' }
          ]
        })
      )
    ).toBe('right');
  });

  it('skips rows with non-string value', () => {
    expect(
      extractVin(
        v({ extraFields: [{ name: 'VIN', value: 12345 as unknown as string }] })
      )
    ).toBeUndefined();
  });

  it('survives null / non-object entries inside extraFields', () => {
    expect(
      extractVin(
        v({
          extraFields: [
            null as unknown as Record<string, unknown>,
            undefined as unknown as Record<string, unknown>,
            { name: 'VIN', value: 'ok' }
          ]
        })
      )
    ).toBe('ok');
  });
});

describe('normalizeVehicleIdentifiers', () => {
  it('returns the original vehicle when no VIN is present (does not add a vin key)', () => {
    const input = v({ licensePlate: 'MBL4635' });
    const out = normalizeVehicleIdentifiers(input);
    expect(out).toBe(input);
    expect('vin' in out).toBe(false);
  });

  it('returns a new object with vin hoisted when present', () => {
    const input = v({
      licensePlate: 'MBL4635',
      extraFields: [{ name: 'VIN', value: '1HGCR2F80EA00735' }]
    });
    const out = normalizeVehicleIdentifiers(input);
    expect(out).not.toBe(input);
    expect(out.vin).toBe('1HGCR2F80EA00735');
    expect(out.licensePlate).toBe('MBL4635');
    expect(out.extraFields).toEqual([{ name: 'VIN', value: '1HGCR2F80EA00735' }]);
  });

  it('does not add a vin key when extraFields has only a blank VIN row', () => {
    const input = v({ extraFields: [{ name: 'VIN', value: '   ' }] });
    const out = normalizeVehicleIdentifiers(input);
    expect('vin' in out).toBe(false);
  });
});
