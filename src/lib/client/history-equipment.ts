import type { Equipment } from '$lib/server/lubelogger';
import type { OdometerRecordSummary } from './api';

/**
 * Which equipment LubeLogger credited each reading to, keyed by
 * `date|odometer` → names. Lets /history label a fill-up "with Test Trailer"
 * when LubeLogger's auto-inserted odometer record for it carried the trailer —
 * the only truthful source, since quicklogger can't see whether auto-insert
 * is on. Built from LubeLogger when online and cached per vehicle in
 * localStorage so the labels survive offline.
 */
export type EquipmentByReading = Record<string, string[]>;

export function readingKey(date: string, odometer: number): string {
  return `${date}|${odometer}`;
}

/** Records at the same date + odometer are merged (e.g. a fill-up's
 *  auto-insert plus a manual reading). Readings that credit nothing are left
 *  out. Unknown equipment ids (deleted items) are skipped. */
export function equipmentByReading(
  records: OdometerRecordSummary[],
  equipment: Equipment[]
): EquipmentByReading {
  const names = new Map(equipment.map((e) => [e.id, e.description]));
  const out: EquipmentByReading = {};
  for (const r of records) {
    const labels = r.equipmentIds.map((id) => names.get(id)).filter((n): n is string => !!n);
    if (labels.length === 0) continue;
    const key = readingKey(r.date, r.odometer);
    out[key] = [...new Set([...(out[key] ?? []), ...labels])];
  }
  return out;
}

export function historyEquipmentKey(vehicleId: number): string {
  return `quicklogger.historyEquipment.${vehicleId}`;
}

export function loadEquipmentByReading(vehicleId: number): EquipmentByReading {
  if (typeof localStorage === 'undefined') return {};
  try {
    const parsed = JSON.parse(localStorage.getItem(historyEquipmentKey(vehicleId)) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function saveEquipmentByReading(vehicleId: number, map: EquipmentByReading): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(historyEquipmentKey(vehicleId), JSON.stringify(map));
  } catch {
    /* quota / private mode — labels are a convenience */
  }
}
