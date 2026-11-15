import type { Equipment } from '$lib/server/lubelogger';
import type { OdometerQueueEntry } from './idb';

/** An equipment item as `/odometer` shows it: LubeLogger's state, with any
 *  Equip / Unequip still waiting to sync applied on top. */
export interface EquipmentView extends Equipment {
  /** Equipped state comes from a queued Equip / Unequip not yet in LubeLogger. */
  pending?: boolean;
}

/**
 * Apply this vehicle's Equip / Unequip rows, in the order they were tapped,
 * over the equipment list, so the page shows what LubeLogger holds (or will
 * hold once the queue replays — it replays in the same order):
 *
 * - 'queued' rows always apply, and are marked `pending` ("waiting to sync");
 * - 'synced' rows apply only when tapped after `listFetchedAt` — i.e. the
 *   list is the offline snapshot from before they synced (found in phone
 *   testing: an offline Equip that had synced still showed as not Equipped,
 *   offering Equip instead of Unequip). A freshly fetched list already
 *   includes them, so pass `Date.now()` / omit for that;
 * - 'failed' rows were refused by LubeLogger and never apply.
 */
export function applyPendingEquipment(
  equipment: Equipment[],
  entries: OdometerQueueEntry[],
  vehicleId: number,
  listFetchedAt: number = Infinity
): EquipmentView[] {
  const view: EquipmentView[] = equipment.map((e) => ({ ...e }));
  const changes = entries
    .filter(
      (e) =>
        e.input.vehicleId === vehicleId &&
        e.input.setEquipped &&
        (e.status === 'queued' || (e.status === 'synced' && e.enqueuedAt > listFetchedAt))
    )
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt || a.id - b.id);
  for (const entry of changes) {
    const { equipmentId, equipped } = entry.input.setEquipped!;
    const item = view.find((e) => e.id === equipmentId);
    if (item) {
      item.isEquipped = equipped;
      item.pending = entry.status === 'queued';
    }
  }
  return view;
}
