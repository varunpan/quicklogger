import type { PageLoad } from './$types';
import { browser } from '$app/environment';
import { listVehicles, lastFuelup, getOcrStatus } from '$lib/client/api';
import {
  resolveOfflineLastFillup,
  lastFuelupCacheKey,
  type LastFillupRecord,
  type LastFillupSource
} from '$lib/client/last-fillup';
import type { OcrMode, OcrStatus } from '$lib/shared/types';

export const load: PageLoad = async ({ fetch, url }) => {
  const vehicles = await listVehicles(fetch).catch(() => []);
  const prefillVehicleId = Number(url.searchParams.get('vehicleId'));
  const targetVehicle = vehicles.find((v) => v.id === prefillVehicleId) ?? vehicles[0] ?? null;

  let lastFuelupRecord: LastFillupRecord | null = null;
  let lastFuelupSource: LastFillupSource = null;

  if (targetVehicle) {
    const upstream = await lastFuelup(targetVehicle.id, fetch).catch(() => null);
    if (upstream) {
      lastFuelupRecord = {
        date: String(upstream.date ?? ''),
        odometer: String(upstream.odometer ?? ''),
        fuelConsumed: String(upstream.fuelConsumed ?? ''),
        cost: upstream.cost == null ? null : String(upstream.cost),
        costCurrency: null,
        notes: upstream.notes == null ? null : String(upstream.notes)
      };
      lastFuelupSource = 'upstream';
      if (browser) {
        try {
          // Cache only the fields the resolver reads (last-fillup.ts).
          // The full GasRecord includes extraFields / files which can be
          // arbitrarily large; localStorage quota would silently truncate.
          localStorage.setItem(
            lastFuelupCacheKey(targetVehicle.id),
            JSON.stringify({
              date: upstream.date,
              odometer: upstream.odometer,
              fuelConsumed: upstream.fuelConsumed,
              cost: upstream.cost,
              notes: upstream.notes
            })
          );
        } catch {
          // quota / disabled — cache silently degrades; live data still works
        }
      }
    } else if (browser) {
      lastFuelupRecord = await resolveOfflineLastFillup(targetVehicle.id);
      lastFuelupSource = lastFuelupRecord ? 'offline' : null;
    }
  }

  const ocrStatus: OcrStatus = await getOcrStatus(fetch).catch(() => ({ enabled: false }));
  const ocrEnabled = ocrStatus.enabled;
  const ocrModes: OcrMode[] = ocrEnabled && ocrStatus.modes ? ocrStatus.modes : [];
  const ocrChainTimeoutMs: number | undefined =
    ocrEnabled &&
    typeof ocrStatus.chainTimeoutMs === 'number' &&
    Number.isFinite(ocrStatus.chainTimeoutMs) &&
    ocrStatus.chainTimeoutMs > 0
      ? ocrStatus.chainTimeoutMs
      : undefined;

  return {
    vehicles,
    initialVehicle: targetVehicle,
    lastFuelup: lastFuelupRecord,
    lastFuelupSource,
    ocrEnabled,
    ocrModes,
    ocrChainTimeoutMs,
    prefill: {
      vehicleId: url.searchParams.get('vehicleId'),
      volume: url.searchParams.get('volume'),
      volumeUnit: url.searchParams.get('volumeUnit'),
      cost: url.searchParams.get('cost'),
      currency: url.searchParams.get('currency'),
      fillToFull: url.searchParams.get('fillToFull'),
      // date + notes round-trip through the vehicle picker (#50) so entered
      // values survive a vehicle change; also accepted on the Shortcuts
      // deep-link. odometer is deliberately NOT carried — it re-prefills from
      // the newly-picked vehicle's last fillup.
      date: url.searchParams.get('date'),
      notes: url.searchParams.get('notes')
    }
  };
};
