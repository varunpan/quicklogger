import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadOdometerSnapshot,
  saveOdometerSnapshot,
  odometerSnapshotKey
} from './odometer-snapshot';

const TRAILER = { id: 7, description: 'Off-road trailer', isEquipped: true, distanceTraveled: 1 };

describe('odometer snapshot', () => {
  beforeEach(() => localStorage.clear());

  it('returns null on a miss', () => {
    expect(loadOdometerSnapshot(1)).toBeNull();
  });

  it('round-trips equipment and lastOdometer per vehicle', () => {
    saveOdometerSnapshot(1, { equipment: [TRAILER], lastOdometer: 45100 });
    expect(loadOdometerSnapshot(1)).toEqual({ equipment: [TRAILER], lastOdometer: 45100 });
    expect(loadOdometerSnapshot(2)).toBeNull();
  });

  it('overwrites with fresh upstream values, so a wrong high reading can drop (review #1)', () => {
    saveOdometerSnapshot(1, { equipment: [TRAILER], lastOdometer: 1_234_560 });
    // The bad record was fixed in LubeLogger; the next load reports the truth.
    saveOdometerSnapshot(1, { lastOdometer: 123_456 });
    expect(loadOdometerSnapshot(1)).toEqual({ equipment: [TRAILER], lastOdometer: 123_456 });
  });

  it('keeps fields the fresh values do not carry', () => {
    saveOdometerSnapshot(1, { equipment: [TRAILER], lastOdometer: 45100 });
    saveOdometerSnapshot(1, { equipment: [] });
    expect(loadOdometerSnapshot(1)).toEqual({ equipment: [], lastOdometer: 45100 });
  });

  it('distinguishes "equipment never loaded" from "no equipment"', () => {
    saveOdometerSnapshot(1, { lastOdometer: 45100 });
    expect(loadOdometerSnapshot(1)?.equipment).toBeUndefined();
    saveOdometerSnapshot(1, { equipment: [] });
    expect(loadOdometerSnapshot(1)?.equipment).toEqual([]);
  });

  it('treats corrupt JSON as a miss', () => {
    localStorage.setItem(odometerSnapshotKey(1), '{nope');
    expect(loadOdometerSnapshot(1)).toBeNull();
  });
});
