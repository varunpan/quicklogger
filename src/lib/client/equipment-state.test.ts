import { describe, it, expect } from 'vitest';
import { applyPendingEquipment } from './equipment-state';
import type { OdometerQueueEntry } from './idb';

const TRAILER = { id: 7, description: 'Trailer', isEquipped: false, distanceTraveled: 100 };
const TENT = { id: 8, description: 'Roof tent', isEquipped: true, distanceTraveled: 40 };

let nextId = 1;
function row(
  setEquipped: { equipmentId: number; equipped: boolean } | undefined,
  over: Partial<OdometerQueueEntry> = {}
): OdometerQueueEntry {
  return {
    id: nextId++,
    input: {
      vehicleId: 1,
      date: '2026-11-15',
      odometer: 45300,
      clientSubmissionId: 'c',
      ...(setEquipped ? { setEquipped } : {})
    },
    status: 'queued',
    attempts: 0,
    enqueuedAt: nextId,
    ...over
  };
}

describe('applyPendingEquipment', () => {
  it('leaves LubeLogger state alone when nothing is queued', () => {
    expect(applyPendingEquipment([TRAILER, TENT], [], 1)).toEqual([TRAILER, TENT]);
  });

  it('applies a queued Equip and marks it pending', () => {
    const out = applyPendingEquipment([TRAILER], [row({ equipmentId: 7, equipped: true })], 1);
    expect(out[0]).toMatchObject({ id: 7, isEquipped: true, pending: true });
  });

  it('applies queued changes in the order they were tapped', () => {
    const rows = [
      row({ equipmentId: 7, equipped: false }, { enqueuedAt: 20 }),
      row({ equipmentId: 7, equipped: true }, { enqueuedAt: 10 })
    ];
    expect(applyPendingEquipment([TRAILER], rows, 1)[0].isEquipped).toBe(false);
  });

  it('ignores synced and failed rows, plain readings, and other vehicles', () => {
    const rows = [
      row({ equipmentId: 7, equipped: true }, { status: 'synced' }),
      row({ equipmentId: 7, equipped: true }, { status: 'failed' }),
      row(undefined),
      row(
        { equipmentId: 7, equipped: true },
        {
          input: {
            vehicleId: 2,
            date: 'x',
            odometer: 1,
            clientSubmissionId: 'c',
            setEquipped: { equipmentId: 7, equipped: true }
          }
        }
      )
    ];
    expect(applyPendingEquipment([TRAILER], rows, 1)).toEqual([TRAILER]);
  });

  it('does not mutate the input list', () => {
    const list = [{ ...TRAILER }];
    applyPendingEquipment(list, [row({ equipmentId: 7, equipped: true })], 1);
    expect(list[0].isEquipped).toBe(false);
  });

  it('offline snapshot: applies Equip / Unequip made after it, even once synced (phone UAT)', () => {
    // Snapshot saved at t=100 (trailer not equipped); an Equip tapped at t=200
    // has synced since, but the snapshot hasn't seen it.
    const rows = [row({ equipmentId: 7, equipped: true }, { status: 'synced', enqueuedAt: 200 })];
    const out = applyPendingEquipment([TRAILER], rows, 1, 100);
    expect(out[0]).toMatchObject({ isEquipped: true });
    expect(out[0].pending).toBe(false); // it did sync — no "waiting" tag
  });

  it('offline snapshot: ignores synced rows from before it was saved', () => {
    const rows = [row({ equipmentId: 7, equipped: true }, { status: 'synced', enqueuedAt: 50 })];
    expect(applyPendingEquipment([TRAILER], rows, 1, 100)[0].isEquipped).toBe(false);
  });

  it('fresh list (default cutoff): synced rows are already included, so ignored', () => {
    const rows = [row({ equipmentId: 7, equipped: true }, { status: 'synced', enqueuedAt: 9e12 })];
    expect(applyPendingEquipment([TRAILER], rows, 1)[0].isEquipped).toBe(false);
  });
});
