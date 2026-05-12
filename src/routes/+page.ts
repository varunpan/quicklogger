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
          localStorage.setItem(
            lastFuelupCacheKey(targetVehicle.id),
            JSON.stringify(upstream)
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

  return {
    vehicles,
    initialVehicle: targetVehicle,
    lastFuelup: lastFuelupRecord,
    lastFuelupSource,
    ocrEnabled,
    ocrModes,
    prefill: {
      vehicleId: url.searchParams.get('vehicleId'),
      volume: url.searchParams.get('volume'),
      volumeUnit: url.searchParams.get('volumeUnit'),
      cost: url.searchParams.get('cost'),
      currency: url.searchParams.get('currency'),
      fillToFull: url.searchParams.get('fillToFull')
    }
  };
};
