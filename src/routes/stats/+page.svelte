<script lang="ts">
  import { formatOdometer, formatCost } from '$lib/client/format';
  import VehicleIdentifiersCard from '$lib/client/VehicleIdentifiersCard.svelte';
  import VehicleImage from '$lib/client/VehicleImage.svelte';
  import {
    totalCostOfOwnership,
    totalRecordCount,
    costRows,
    reminderSummary,
    purchasePrice
  } from '$lib/client/stats';

  let { data } = $props();

  const vehicleLabel = $derived.by(() => {
    const v = data.vehicle;
    if (!v) return '';
    return [v.year, v.make, v.model].filter(Boolean).join(' ');
  });

  // formatCost(value, null) resolves the LubeLogger instance currency via
  // format.ts's effectiveCurrencyCode() fallback — correct for these
  // instance-currency costs. SSR has no cached server-info so it falls back to
  // USD/en-US, then re-renders correctly after hydration (same as History).
  const info = $derived(data.info);
  const isEmpty = $derived(!!info && totalRecordCount(info) === 0);
  const rows = $derived(info ? costRows(info) : []);
  const tco = $derived(info ? totalCostOfOwnership(info) : 0);
  const records = $derived(info ? totalRecordCount(info) : 0);
  const purchase = $derived(info ? purchasePrice(info) : null);
  const reminders = $derived(info ? reminderSummary(info) : null);
</script>

<div class="mb-4">
  <h1 class="text-xl font-bold text-zinc-100">Stats</h1>
</div>

{#if data.error === 'no-vehicle'}
  <div class="rounded-xl px-3 py-2 text-sm text-rose-300 bg-rose-500/15 border border-rose-500/30">
    Pick a vehicle first.
  </div>
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/vehicles?from=stats" class="block text-sm text-blue-400 mt-6">→ Pick vehicle</a>
{:else}
  {#if data.vehicle}
    <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
    <a href="/vehicles?from=stats" class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full">
      <VehicleImage vehicleId={data.vehicle?.id} class="w-12 h-12" />
      <div class="text-left flex-1 min-w-0">
        <div class="field-label">Vehicle</div>
        <div class="text-base font-semibold truncate text-zinc-100">
          {vehicleLabel}
        </div>
      </div>
      <span class="text-zinc-500" aria-hidden="true">›</span>
    </a>
  {/if}

  {#if data.vehicle}
    <VehicleIdentifiersCard
      licensePlate={typeof data.vehicle.licensePlate === 'string' ? data.vehicle.licensePlate : undefined}
      vin={typeof data.vehicle.vin === 'string' ? data.vehicle.vin : undefined}
    />
  {/if}

  {#if data.error}
    <div class="rounded-xl px-3 py-2 text-sm text-amber-300 bg-amber-500/15 border border-amber-500/30 flex items-center gap-2 mb-3">
      <span aria-hidden="true">⚠</span>
      <span>Couldn't reach LubeLogger right now.</span>
    </div>
  {:else if isEmpty}
    <p class="text-sm text-zinc-500 italic mt-2">No records logged for this vehicle yet.</p>
  {:else if info}
    <!-- Total cost of ownership -->
    <div class="bg-zinc-800 rounded-xl px-4 py-4 mb-3">
      <div class="field-label">Total cost of ownership</div>
      <div class="text-3xl font-bold text-zinc-100 mt-1 tabular-nums">{formatCost(tco, null)}</div>
      <div class="text-xs text-zinc-500 mt-1">{records} record{records === 1 ? '' : 's'}</div>
    </div>

    <!-- Cost breakdown -->
    <div class="bg-zinc-800 rounded-xl px-4 mb-3 divide-y divide-zinc-700/50">
      {#each rows as row (row.label)}
        <div class="flex items-center justify-between py-3">
          <div class="flex items-baseline gap-2">
            <span class="text-base text-zinc-100">{row.label}</span>
            <span class="text-xs text-zinc-500">{row.count} {row.noun}{row.count === 1 ? '' : 's'}</span>
          </div>
          <span class="text-base font-semibold text-zinc-100 tabular-nums">{formatCost(row.cost, null)}</span>
        </div>
      {/each}
    </div>

    <!-- Purchase price (only when set > 0) -->
    {#if purchase !== null}
      <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-3 flex items-center justify-between">
        <span class="field-label">Purchase price</span>
        <span class="text-base font-semibold text-zinc-100 tabular-nums">{formatCost(purchase, null)}</span>
      </div>
    {/if}

    <!-- Last reported odometer -->
    <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-3 flex items-center justify-between">
      <span class="field-label">Last reported odometer</span>
      <span class="text-base font-semibold text-zinc-100 tabular-nums">{formatOdometer(String(info.lastReportedOdometer))} mi</span>
    </div>

    <!-- Reminder status → maintenance -->
    {#if reminders}
      <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
      <a href={`/maintenance?vehicleId=${data.vehicle?.id}`} class="bg-zinc-800 rounded-xl px-4 py-3 mb-3 flex items-center gap-3 w-full">
        <div class="flex-1 min-w-0 text-left">
          <div class="flex items-center gap-2">
            {#if reminders.pastDue > 0}
              <span class="text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 border text-rose-300 bg-rose-500/15 border-rose-500/30">{reminders.pastDue} Past Due</span>
            {/if}
            {#if reminders.upcoming > 0}
              <span class="text-xs text-zinc-500">{reminders.upcoming} upcoming</span>
            {/if}
          </div>
          {#if reminders.nextDescription}
            <div class="text-sm text-zinc-300 mt-1.5 truncate">Next: {reminders.nextDescription}</div>
          {/if}
        </div>
        <span class="text-zinc-500" aria-hidden="true">›</span>
      </a>
    {/if}
  {/if}

  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="block text-sm text-blue-400 mt-6">← Back to Log Fuel</a>
{/if}
