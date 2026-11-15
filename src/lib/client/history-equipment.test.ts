import { describe, it, expect, beforeEach } from 'vitest';
import {
  equipmentByReading,
  readingKey,
  loadEquipmentByReading,
  saveEquipmentByReading,
  historyEquipmentKey
} from './history-equipment';

const EQ = [
  { id: 7, description: 'Off-road trailer', isEquipped: false, distanceTraveled: 0 },
  { id: 8, description: 'Roof tent', isEquipped: false, distanceTraveled: 0 }
];

describe('equipmentByReading', () => {
  it('maps each reading to the equipment it credited', () => {
    const map = equipmentByReading(
      [
        { date: '2026-11-15', odometer: 45420, equipmentIds: [7] },
        { date: '2026-11-15', odometer: 45300, equipmentIds: [] }
      ],
      EQ
    );
    expect(map).toEqual({ [readingKey('2026-11-15', 45420)]: ['Off-road trailer'] });
  });

  it('merges records at the same reading and skips unknown ids', () => {
    const map = equipmentByReading(
      [
        { date: '2026-11-15', odometer: 45420, equipmentIds: [7] },
        { date: '2026-11-15', odometer: 45420, equipmentIds: [8, 7, 99] }
      ],
      EQ
    );
    expect(map[readingKey('2026-11-15', 45420)]).toEqual(['Off-road trailer', 'Roof tent']);
  });
});

describe('cache', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips per vehicle', () => {
    saveEquipmentByReading(3, { 'a|1': ['Trailer'] });
    expect(loadEquipmentByReading(3)).toEqual({ 'a|1': ['Trailer'] });
    expect(loadEquipmentByReading(4)).toEqual({});
  });

  it('treats corrupt JSON as empty', () => {
    localStorage.setItem(historyEquipmentKey(3), '{nope');
    expect(loadEquipmentByReading(3)).toEqual({});
  });
});
