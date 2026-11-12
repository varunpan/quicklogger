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

  it('merges patches and never moves lastOdometer backwards', () => {
    saveOdometerSnapshot(1, { equipment: [TRAILER], lastOdometer: 45320 });
    saveOdometerSnapshot(1, { lastOdometer: 45100 });
    expect(loadOdometerSnapshot(1)).toEqual({ equipment: [TRAILER], lastOdometer: 45320 });
  });

  it('treats corrupt JSON as a miss', () => {
    localStorage.setItem(odometerSnapshotKey(1), '{nope');
    expect(loadOdometerSnapshot(1)).toBeNull();
  });
});
