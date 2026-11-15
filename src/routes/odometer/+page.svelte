<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { browser } from '$app/environment';
  import { goto } from '$app/navigation';
  import { submitOdometer, ApiError } from '$lib/client/api';
  import { OdometerQueue } from '$lib/client/idb';
  import { genUuid } from '$lib/client/uuid';
  import { savePrefs } from '$lib/client/prefs';
  import Icon from '$lib/client/Icon.svelte';
  import type { OdometerSubmissionInput } from '$lib/shared/types';
  import { formatOdometer, effectiveDistanceUnit } from '$lib/client/format';
  import { localIsoDate } from '$lib/client/smart-checks';
  import VehicleCard from '$lib/client/VehicleCard.svelte';

  let { data } = $props();

  const DIST_UNIT = effectiveDistanceUnit();

  // Form state seeds from the loaded vehicle (same one-time `untrack` idiom as
  // Log Fuel) and is re-seeded whenever SvelteKit reuses this page for a
  // different vehicle — see the $effect.pre below. The odometer prefills with
  // LubeLogger's current mileage (or a higher reading still waiting to sync),
  // greyed with a "prefilled" badge until edited.
  let odometer = $state<number | ''>(untrack(() => data.lastOdometer ?? ''));
  let odometerEdited = $state(false);
  let isoDate = $state(localIsoDate());
  let notes = $state('');
  let submitting = $state(false);
  // Item whose Equip / Unequip is in flight (one at a time).
  let equipping = $state<number | null>(null);

  // A reading credits whatever is Equipped — the same rule LubeLogger applies
  // to the odometer records it auto-inserts for fill-ups. Putting an item on
  // or taking it off is the Equip / Unequip button, never a per-reading tick.
  const equipped = $derived(data.equipment.filter((e) => e.isEquipped));

  // Navigating /odometer?vehicleId=2 → /odometer (vehicle 1) reuses this
  // component with new `data`; without a re-seed the form would keep vehicle
  // 2's prefill and equipment ids and submit them for vehicle 1. Keyed on the
  // vehicle id only, so a same-vehicle reload never clobbers typing.
  let seededVehicleId: number | null = untrack(() => data.vehicle?.id ?? null);
  $effect.pre(() => {
    const vid = data.vehicle?.id ?? null;
    if (vid === seededVehicleId) return;
    seededVehicleId = vid;
    untrack(() => {
      odometer = data.lastOdometer ?? '';
      odometerEdited = false;
      lowerAcknowledged = false;
      notes = '';
      toast = null;
    });
  });
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
  const readingReady = $derived(
    odometerEdited &&
      !lowerThanLast &&
      typeof odometer === 'number' &&
      Number.isInteger(odometer) &&
      odometer >= 0 &&
      isoDate !== ''
  );
  const canSubmit = $derived(
    !submitting &&
      equipping === null &&
      odometerEdited &&
      !lowerThanLast &&
      data.vehicle !== null &&
      typeof odometer === 'number' &&
      Number.isInteger(odometer) &&
      odometer >= 0 &&
      isoDate !== ''
  );

  const canChangeEquipment = $derived(!submitting && equipping === null);
  // Disabled Equip / Unequip render grey (like a disabled Log odometer), not
  // faded blue, so it's obvious they need a reading first.
  const canEquip = $derived(canChangeEquipment && readingReady);

  /** Remember a logged reading on this device (History), like Log Fuel. */
  async function recordSynced(input: OdometerSubmissionInput, names: string[]) {
    try {
      const oq = await OdometerQueue.open();
      try {
        await oq.enqueue(input, 'synced', names);
      } finally {
        oq.close();
      }
    } catch {
      // IDB unavailable (private mode, quota); ignore.
    }
  }

  /**
   * Send one reading — a plain Log, or an Equip / Unequip — and land like a
   * logged fill-up: /maintenance when it reached LubeLogger; queued for the SW
   * to replay and /history (Queued badge, works offline) on a network error
   * or 5xx; a "Submission rejected" toast on a 4xx.
   */
  async function send(input: OdometerSubmissionInput, names: string[], okText: string) {
    const vehicleId = input.vehicleId;
    toast = null;
    try {
      await submitOdometer(input);
      toast = { kind: 'success', text: okText };
      savePrefs({ lastVehicleId: vehicleId });
      // Local history trail for /history, like the fuel form's synced row.
      await recordSynced(input, names);
      notes = '';
      odometerEdited = false;
      // Same landing as a logged fill-up: /maintenance, so any reminder the
      // new distance just tipped into due shows.
      // eslint-disable-next-line svelte/no-navigation-without-resolve
      void goto(`/maintenance?vehicleId=${vehicleId}`).catch(() => {});
    } catch (err) {
      const status = err instanceof ApiError ? err.status : undefined;
      if (status && status >= 400 && status < 500) {
        toast = { kind: 'error', text: `Submission rejected: ${(err as Error).message}` };
        return;
      }
      // Network error / 5xx: queue it for the service worker to replay, then
      // reset and land on /history (renders from IndexedDB, so the Queued
      // badge is visible offline) — same flow as the fuel form. An Equip /
      // Unequip queues as ONE row (reading + Equipped change), so both land
      // together and in the order tapped; the page shows it as pending.
      try {
        const oq = await OdometerQueue.open();
        try {
          await oq.enqueue(input, 'queued', names);
        } finally {
          oq.close();
        }
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
  }

  /**
   * Equip (put the item on) or Unequip (take it off) — one tap, no LubeLogger.
   * Logs the odometer entered above crediting what is Equipped BEFORE the
   * change (Equip: the item isn't on yet, so miles it didn't travel are
   * closed out; Unequip: it is, so it gets the miles up to now), and sets the
   * item's Equipped flag in the same request. Works offline: the pair queues
   * as one row and replays in order with fill-ups.
   */
  async function changeEquipment(item: (typeof data.equipment)[number]) {
    if (!data.vehicle || !canChangeEquipment || !readingReady) return;
    const putOn = !item.isEquipped;
    const action = putOn ? 'Equipped' : 'Unequipped';
    const input: OdometerSubmissionInput = {
      vehicleId: data.vehicle.id,
      date: isoDate,
      odometer: odometer as number,
      notes: notes.trim() || `${action} ${item.description}`,
      equipmentIds: equipped.map((e) => e.id),
      setEquipped: { equipmentId: item.id, equipped: putOn },
      clientSubmissionId: genUuid()
    };
    equipping = item.id;
    try {
      await send(
        input,
        equipped.map((e) => e.description),
        `${action} ${item.description} at ${formatOdometer(String(input.odometer))} ${DIST_UNIT}`
      );
    } finally {
      equipping = null;
    }
  }

  async function submit() {
    if (!canSubmit || !data.vehicle) return;
    const names = equipped.map((e) => e.description);
    const input: OdometerSubmissionInput = {
      vehicleId: data.vehicle.id,
      date: isoDate,
      odometer: odometer as number,
      notes: notes.trim() || undefined,
      equipmentIds: equipped.map((e) => e.id),
      // Equipment list never loaded on this device: let the server attach
      // whatever LubeLogger marks equipped when this reading is written.
      ...(data.equipmentKnown ? {} : { includeEquipped: true }),
      clientSubmissionId: genUuid()
    };
    submitting = true;
    try {
      await send(
        input,
        names,
        `Logged ${formatOdometer(String(input.odometer))} ${DIST_UNIT}${
          names.length ? ` with ${names.join(', ')}` : ''
        }`
      );
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
    {#if !data.equipmentKnown}
      <p class="text-xs text-amber-300 px-1 py-2" data-testid="equipment-unknown">
        Equipment list not loaded yet on this device. Anything marked Equipped in LubeLogger will be
        included when this reading syncs.
      </p>
    {:else if data.equipment.length === 0}
      <p class="text-xs text-zinc-500 px-1 py-2">
        No equipment on this vehicle. Add some (e.g. a trailer) under the vehicle's Equipment tab in
        LubeLogger.
      </p>
    {:else}
      <p class="text-xs text-zinc-500 px-1 pb-2">
        Readings count toward whatever is Equipped. Enter the odometer, then Equip when you put
        something on and Unequip when you take it off — offline too.
      </p>
      {#if !odometerEdited}
        <p class="text-xs text-amber-300 px-1 pb-2" data-testid="equip-hint">
          Type the current odometer above to Equip or Unequip.
        </p>
      {/if}
      {#each data.equipment as e (e.id)}
        <div
          data-testid="equipment-{e.id}"
          data-equipped={e.isEquipped}
          class="flex items-center gap-3 w-full rounded-xl px-3 py-3 mb-2 bg-zinc-800/60 border border-zinc-700/60"
        >
          <span class="flex-1 min-w-0">
            <span class="block text-sm font-semibold text-zinc-100">
              {e.description}
              {#if e.isEquipped}
                <span class="badge ml-1 text-blue-300 bg-blue-500/15 border border-blue-500/30"
                  >Equipped</span
                >
              {/if}
              {#if e.pending}
                <span
                  class="badge ml-1 text-amber-300 bg-amber-500/15 border border-amber-500/30"
                  data-testid="equipment-pending-{e.id}">waiting to sync</span
                >
              {/if}
            </span>
            <span class="block text-xs text-zinc-500 mt-0.5">
              {formatOdometer(String(e.distanceTraveled))}
              {DIST_UNIT} logged
            </span>
          </span>
          <button
            type="button"
            data-testid="equip-{e.id}"
            disabled={!canEquip}
            class="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold border"
            class:bg-blue-600={canEquip && !e.isEquipped}
            class:border-blue-600={canEquip && !e.isEquipped}
            class:text-white={canEquip && !e.isEquipped}
            class:border-zinc-500={canEquip && e.isEquipped}
            class:text-zinc-200={canEquip && e.isEquipped}
            class:bg-zinc-700={!canEquip}
            class:border-zinc-700={!canEquip}
            class:text-zinc-500={!canEquip}
            onclick={() => changeEquipment(e)}
          >
            {equipping === e.id ? 'Saving…' : e.isEquipped ? 'Unequip' : 'Equip'}
          </button>
        </div>
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
