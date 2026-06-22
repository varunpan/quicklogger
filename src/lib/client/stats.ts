import type { VehicleInfo } from '$lib/server/lubelogger';

// Pure display helpers for /stats. Keep the page a thin render and the math
// here unit-tested. All numbers come straight from LubeLogger; the only thing
// we compute is plain addition (TCO = sum of category costs).

export function totalCostOfOwnership(info: VehicleInfo): number {
  return (
    info.gasRecordCost +
    info.serviceRecordCost +
    info.repairRecordCost +
    info.upgradeRecordCost +
    info.taxRecordCost
  );
}

export function totalRecordCount(info: VehicleInfo): number {
  return (
    info.gasRecordCount +
    info.serviceRecordCount +
    info.repairRecordCount +
    info.upgradeRecordCount +
    info.taxRecordCount
  );
}

export interface CostRow {
  label: string;
  cost: number;
  count: number;
  /** Singular count noun; the page pluralizes ("22 fill-ups", "1 record"). */
  noun: string;
}

export function costRows(info: VehicleInfo): CostRow[] {
  const rows: CostRow[] = [
    { label: 'Fuel', cost: info.gasRecordCost, count: info.gasRecordCount, noun: 'fill-up' },
    { label: 'Service', cost: info.serviceRecordCost, count: info.serviceRecordCount, noun: 'record' },
    { label: 'Repairs', cost: info.repairRecordCost, count: info.repairRecordCount, noun: 'record' },
    { label: 'Upgrades', cost: info.upgradeRecordCost, count: info.upgradeRecordCount, noun: 'record' },
    { label: 'Tax', cost: info.taxRecordCost, count: info.taxRecordCount, noun: 'record' }
  ];
  return rows.filter((r) => r.count > 0);
}

export interface ReminderSummary {
  pastDue: number;
  upcoming: number;
}

/** Counts for the compact reminder line: how many reminders are past due and
 *  how many are upcoming (very-urgent + urgent + not-urgent). We intentionally
 *  do NOT surface `nextReminder` here — LubeLogger's "next" is the next
 *  *upcoming* reminder and skips past-due items, so showing it beside a
 *  "past due" badge read as "that reminder is past due" when it wasn't (e.g. an
 *  oil change due in months under a brake-fluid past-due count). The card shows
 *  counts only and links to /maintenance for the detail. Returns null when the
 *  vehicle has no past-due or upcoming reminders, so the page can hide the
 *  line. */
export function reminderSummary(info: VehicleInfo): ReminderSummary | null {
  const pastDue = info.pastDueReminderCount;
  const upcoming =
    info.veryUrgentReminderCount + info.urgentReminderCount + info.notUrgentReminderCount;
  if (pastDue === 0 && upcoming === 0) return null;
  return { pastDue, upcoming };
}

/** Vehicle purchase price, only when it's a positive number. `vehicleData` is
 *  the loose `Vehicle` type (`[key: string]: unknown`), so guard the field. */
export function purchasePrice(info: VehicleInfo): number | null {
  const p = info.vehicleData.purchasePrice;
  return typeof p === 'number' && Number.isFinite(p) && p > 0 ? p : null;
}
