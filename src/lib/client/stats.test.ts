import { describe, it, expect } from 'vitest';
import {
  totalCostOfOwnership,
  totalRecordCount,
  costRows,
  reminderSummary,
  purchasePrice
} from './stats';
import type { VehicleInfo } from '$lib/server/lubelogger';

function makeInfo(overrides: Partial<VehicleInfo> = {}): VehicleInfo {
  return {
    vehicleData: { id: 1, year: 2014, make: 'Honda', model: 'Accord' },
    gasRecordCount: 22, gasRecordCost: 707.39,
    serviceRecordCount: 44, serviceRecordCost: 4164.2,
    repairRecordCount: 9, repairRecordCost: 1018.24,
    upgradeRecordCount: 1, upgradeRecordCost: 595,
    taxRecordCount: 0, taxRecordCost: 0,
    lastReportedOdometer: 111180,
    pastDueReminderCount: 2, veryUrgentReminderCount: 0,
    urgentReminderCount: 0, notUrgentReminderCount: 7,
    nextReminder: null,
    ...overrides
  };
}

describe('totalCostOfOwnership', () => {
  it('sums the five category costs', () => {
    expect(totalCostOfOwnership(makeInfo())).toBeCloseTo(6484.83, 2);
  });
  it('is 0 when every category cost is 0', () => {
    expect(
      totalCostOfOwnership(
        makeInfo({ gasRecordCost: 0, serviceRecordCost: 0, repairRecordCost: 0, upgradeRecordCost: 0, taxRecordCost: 0 })
      )
    ).toBe(0);
  });
});

describe('totalRecordCount', () => {
  it('sums the five category counts', () => {
    expect(totalRecordCount(makeInfo())).toBe(76);
  });
  it('is 0 when every category count is 0', () => {
    expect(
      totalRecordCount(
        makeInfo({ gasRecordCount: 0, serviceRecordCount: 0, repairRecordCount: 0, upgradeRecordCount: 0, taxRecordCount: 0 })
      )
    ).toBe(0);
  });
});

describe('costRows', () => {
  it('returns one row per non-zero-count category in fixed order', () => {
    const rows = costRows(makeInfo());
    expect(rows.map((r) => r.label)).toEqual(['Fuel', 'Service', 'Repairs', 'Upgrades']);
    expect(rows[0]).toEqual({ label: 'Fuel', cost: 707.39, count: 22, noun: 'fill-up' });
  });
  it('drops zero-count rows (Tax here)', () => {
    const rows = costRows(makeInfo());
    expect(rows.find((r) => r.label === 'Tax')).toBeUndefined();
  });
  it('drops Service and Repairs when their counts are 0 (second-vehicle case)', () => {
    const rows = costRows(makeInfo({ serviceRecordCount: 0, repairRecordCount: 0 }));
    expect(rows.map((r) => r.label)).toEqual(['Fuel', 'Upgrades']);
  });
});

describe('reminderSummary', () => {
  it('computes pastDue and upcoming (very+urgent+notUrgent)', () => {
    const s = reminderSummary(
      makeInfo({
        pastDueReminderCount: 2,
        veryUrgentReminderCount: 1,
        urgentReminderCount: 3,
        notUrgentReminderCount: 7,
        nextReminder: {
          vehicleId: 1, id: 12, description: 'Engine Oil change',
          urgency: 'NotUrgent', metric: 'Both', userMetric: 'Both',
          notes: null, dueDate: '2026-11-30',
          dueOdometer: 116124, dueDays: 166, dueDistance: 4944, tags: ''
        }
      })
    );
    // nextReminder is deliberately ignored — see reminderSummary's docstring.
    expect(s).toEqual({ pastDue: 2, upcoming: 11 });
  });
  it('returns null when there are no reminders at all', () => {
    expect(
      reminderSummary(
        makeInfo({ pastDueReminderCount: 0, veryUrgentReminderCount: 0, urgentReminderCount: 0, notUrgentReminderCount: 0, nextReminder: null })
      )
    ).toBeNull();
  });
  it('returns null when a nextReminder exists but every count is 0 (counts drive the card)', () => {
    expect(
      reminderSummary(
        makeInfo({
          pastDueReminderCount: 0, veryUrgentReminderCount: 0, urgentReminderCount: 0, notUrgentReminderCount: 0,
          nextReminder: {
            vehicleId: 1, id: 1, description: 'Tire Rotation',
            urgency: 'NotUrgent', metric: 'Odometer', userMetric: 'Odometer',
            notes: null, dueDate: '2026-10-03', dueOdometer: 112552, dueDays: 0, dueDistance: 3000, tags: ''
          }
        })
      )
    ).toBeNull();
  });
});

describe('purchasePrice', () => {
  it('returns the price when it is a positive number', () => {
    expect(purchasePrice(makeInfo({ vehicleData: { id: 1, purchasePrice: 14990 } }))).toBe(14990);
  });
  it('returns null when purchasePrice is 0', () => {
    expect(purchasePrice(makeInfo({ vehicleData: { id: 1, purchasePrice: 0 } }))).toBeNull();
  });
  it('returns null when purchasePrice is absent or non-numeric', () => {
    expect(purchasePrice(makeInfo({ vehicleData: { id: 1 } }))).toBeNull();
    expect(purchasePrice(makeInfo({ vehicleData: { id: 1, purchasePrice: 'lots' } }))).toBeNull();
  });
});
