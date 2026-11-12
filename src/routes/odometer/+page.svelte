<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { SvelteSet } from 'svelte/reactivity';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { submitOdometer, ApiError } from '$lib/client/api';
  import { OdometerQueue } from '$lib/client/idb';
  import { saveOdometerSnapshot } from '$lib/client/odometer-snapshot';
  import { savePrefs } from '$lib/client/prefs';
  import Icon from '$lib/client/Icon.svelte';
  import type { OdometerSubmissionInput } from '$lib/shared/types';
  import { formatOdometer, effectiveDistanceUnit } from '$lib/client/format';
  import { localIsoDate } from '$lib/client/smart-checks';
  import VehicleCard from '$lib/client/VehicleCard.svelte';

  let { data } = $props();

  const DIST_UNIT = effectiveDistanceUnit();

  // Prefilled with LubeLogger's current mileage (max across all record types),
  // shown greyed with a "prefilled" badge like the fuel form until edited.
  let odometer = $state<number | ''>(untrack(() => data.lastOdometer ?? ''));
  let odometerEdited = $state(false);
  let isoDate = $state(localIsoDate());
  let notes = $state('');
  // Pre-check whatever LubeLogger marks as currently equipped (e.g. the
  // trailer is hitched), mirroring LubeLogger's own odometer form.
  const selected = new SvelteSet<number>(
    untrack(() => data.equipment.filter((e) => e.isEquipped).map((e) => e.id))
  );
  let submitting = $state(false);
  let toast = $state<{ kind: 'success' | 'queued' | 'error'; text: string } | null>(null);

  // Live connectivity for the offline banner + button label — same wiring as
  // the Log Fuel form.
  let online = $state(browser ? navigator.onLine : true);
  onMount(() => {
    const goOnline = () => (online = true);
    const goOffline = () => (online = false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  });

  const delta = $derived(
    odometerEdited && typeof odometer === 'number' && data.lastOdometer
      ? odometer - data.lastOdometer
      : null
  );
  // Smart-check parity with Log Fuel: a reading below the last known one is
  // usually a typo, so it needs an explicit "Submit anyway". Cleared on edit.
  let lowerAcknowledged = $state(false);
  const lowerThanLast = $derived(delta !== null && delta < 0 && !lowerAcknowledged);

  // An untouched prefill would log 0 miles, so the user must enter a reading.
  const canSubmit = $derived(
    !submitting &&
      odometerEdited &&
      !lowerThanLast &&
      data.vehicle !== null &&
      typeof odometer === 'number' &&
      Number.isInteger(odometer) &&
      odometer >= 0 &&
      isoDate !== ''
  );

  function toggle(id: number) {
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
  }

  async function submit() {
    if (!canSubmit || !data.vehicle) return;
    const vehicleId = data.vehicle.id;
    const input: OdometerSubmissionInput = {
      vehicleId,
      date: isoDate,
      odometer: odometer as number,
      notes: notes.trim() || undefined,
      equipmentIds: [...selected]
    };
    const names = data.equipment.filter((e) => selected.has(e.id)).map((e) => e.description);
    submitting = true;
    toast = null;
    try {
      await submitOdometer(input);
      toast = {
        kind: 'success',
        text: `Logged ${formatOdometer(String(input.odometer))} ${DIST_UNIT}${
          names.length ? ` with ${names.join(', ')}` : ''
        }`
      };
      saveOdometerSnapshot(vehicleId, { lastOdometer: input.odometer });
      savePrefs({ lastVehicleId: vehicleId });
      // Local history trail for /history, like the fuel form's synced row.
      try {
        await (await OdometerQueue.open()).enqueue(input, 'synced', names);
      } catch {
        // IDB unavailable (private mode, quota); ignore.
      }
      notes = '';
      odometerEdited = false;
      // Same landing as a logged fill-up: /maintenance, so any reminder the
      // new distance just tipped into due (e.g. the trailer's bearings) shows.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(`/maintenance?vehicleId=${vehicleId}`).catch(() => {});
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status && status >= 400 && status < 500) {
        toast = { kind: 'error', text: `Submission rejected: ${(err as Error).message}` };
      } else {
        // Network error / 5xx: queue it for the service worker to replay, then
        // reset and land on /history (renders from IndexedDB, so the Queued
        // badge is visible offline) — same flow as the fuel form.
        try {
          await (await OdometerQueue.open()).enqueue(input, 'queued', names);
          saveOdometerSnapshot(vehicleId, { lastOdometer: input.odometer });
          toast = { kind: 'queued', text: 'Saved locally — will sync when online' };
          notes = '';
          odometerEdited = false;
          // eslint-disable-next-line svelte/no-navigation-without-resolve
          void goto(`/history?vehicleId=${vehicleId}`).catch(() => {});
        } catch {
          toast = {
            kind: 'error',
            text: "Couldn't save — device storage unavailable. This reading was NOT saved."
          };
        }
      }
    } finally {
      submitting = false;
    }
  }
</script>

<div class="mb-4">
  <h1 class="text-xl font-bold text-zinc-100">Log odometer</h1>
  <p class="text-xs text-zinc-500 mt-1">Odometer entry only — no fuel.</p>
</div>

{#if data.error === 'no-vehicle'}
  <div class="rounded-xl px-3 py-2 text-sm text-rose-300 bg-rose-500/15 border border-rose-500/30">
    Pick a vehicle first.
  </div>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/vehicles?from=odometer" class="block text-sm text-blue-400 mt-6">→ Pick vehicle</a>
{:else}
  {#if data.vehicle}
    <VehicleCard vehicle={data.vehicle} href="/vehicles?from=odometer" />
  {/if}

  {#if !online}
    <div
      role="status"
      data-testid="offline-banner"
      class="rounded-xl bg-amber-500/10 border border-amber-500/30 px-3 py-2.5 mb-3 flex items-start gap-2"
    >
      <Icon name="warning" size={15} class="text-amber-300 mt-0.5 shrink-0" />
      <span class="text-sm text-amber-200 leading-relaxed"
        >You're offline — this reading will be saved and synced when you reconnect.</span
      >
    </div>
  {:else if data.error}
    <div
      class="rounded-xl px-3 py-2 text-sm text-amber-300 bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 mb-3"
    >
      <span aria-hidden="true">⚠</span>
      <span>Couldn't reach LubeLogger right now — readings will be saved and synced later.</span>
    </div>
  {/if}

  <div class="grid grid-cols-2 gap-2 mb-3">
    <div class="field min-w-0">
      <label for="odo-only" class="field-label">Odometer</label>
      <div class="relative">
        <input
          id="odo-only"
          class="field-input min-w-0"
          type="number"
          inputmode="numeric"
          step="1"
          min="0"
          onkeydown={(e) => {
            if (e.key === '.' || e.key === ',') e.preventDefault();
          }}
          bind:value={odometer}
          oninput={() => {
            odometerEdited = true;
            lowerAcknowledged = false;
          }}
          class:text-zinc-400={!odometerEdited && odometer !== ''}
        />
        {#if !odometerEdited && odometer !== ''}
          <span class="badge absolute top-1.5 right-2 text-zinc-500 bg-zinc-700/60">
            prefilled
          </span>
        {/if}
      </div>
      {#if delta !== null}
        <div class="text-xs text-zinc-500 mt-1 px-1" class:text-amber-300={delta < 0}>
          <span class="font-semibold" class:text-blue-400={delta >= 0}
            >{delta > 0 ? '+' : ''}{delta} {DIST_UNIT}</span
          > since last reading
        </div>
      {/if}
    </div>
    <label class="field min-w-0">
      <span class="field-label">Date</span>
      <input class="field-input min-w-0 appearance-none" type="date" bind:value={isoDate} />
    </label>
  </div>

  <div class="field mb-3">
    <span class="field-label">Equipment</span>
    {#if data.equipment.length === 0}
      <p class="text-xs text-zinc-500 px-1 py-2">
        No equipment on this vehicle. Add some (e.g. a trailer) under the vehicle's Equipment tab in
        LubeLogger.
      </p>
    {:else}
      {#each data.equipment as e (e.id)}
        {@const on = selected.has(e.id)}
        <button
          type="button"
          role="checkbox"
          aria-checked={on}
          data-testid="equipment-{e.id}"
          class="flex items-center gap-3 w-full rounded-xl px-3 py-3 mb-2 bg-zinc-800/60 border border-zinc-700/60 text-left"
          onclick={() => toggle(e.id)}
        >
          {#if on}
            <span
              class="w-5 h-5 rounded-md bg-blue-600 flex items-center justify-center shrink-0"
              aria-hidden="true"
            >
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="white"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"><polyline points="20 6 9 17 4 12" /></svg
              >
            </span>
          {:else}
            <span
              class="w-5 h-5 rounded-md border-2 border-zinc-600 bg-transparent shrink-0"
              aria-hidden="true"
            ></span>
          {/if}
          <span class="flex-1 min-w-0">
            <span
              class="block text-sm font-semibold"
              class:text-zinc-100={on}
              class:text-zinc-300={!on}>{e.description}</span
            >
            <span class="block text-xs text-zinc-500 mt-0.5">
              {formatOdometer(String(e.distanceTraveled))}
              {DIST_UNIT} logged{e.isEquipped ? ' · equipped' : ''}
            </span>
          </span>
        </button>
      {/each}
    {/if}
  </div>

  <label class="field mb-3">
    <span class="field-label">Note</span>
    <input
      class="field-input text-base"
      type="text"
      bind:value={notes}
      placeholder="Trip to the trailhead"
    />
  </label>

  {#if lowerThanLast && data.lastOdometer}
    <div
      class="rounded-xl px-4 py-3 mb-3 border border-amber-500/30 bg-amber-500/15 text-amber-300 text-sm leading-relaxed"
      role="alert"
      data-testid="smart-check-chip"
    >
      <div class="flex items-center gap-2 font-semibold mb-2">
        <span aria-hidden="true">⚠</span>
        <span>1 issue found</span>
      </div>
      <ul class="list-disc pl-5 space-y-1 mb-3">
        <li>
          Odometer is lower than the last reading ({`${formatOdometer(String(data.lastOdometer))} ${DIST_UNIT}`}).
        </li>
      </ul>
      <button
        type="button"
        class="w-full rounded-lg py-2 px-3 text-sm font-semibold border border-amber-500/40 text-amber-200"
        onclick={() => {
          lowerAcknowledged = true;
          void submit();
        }}
      >
        Submit anyway
      </button>
    </div>
  {/if}

  <button
    type="button"
    disabled={!canSubmit}
    class="bg-blue-600 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-xl py-4 text-base font-semibold text-white w-full"
    onclick={submit}
  >
    {submitting ? 'Logging…' : online ? 'Log odometer' : 'Save offline'}
  </button>

  {#if toast}
    <div
      role={toast.kind === 'error' ? 'alert' : 'status'}
      class="mt-4 rounded-xl px-4 py-3 text-sm"
      class:bg-emerald-600={toast.kind === 'success'}
      class:bg-amber-600={toast.kind === 'queued'}
      class:bg-rose-600={toast.kind === 'error'}
    >
      {toast.text}
    </div>
  {/if}

  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="block text-sm text-blue-400 mt-6">← Back to Log Fuel</a>
{/if}
