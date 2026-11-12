<script lang="ts">
  import { onMount } from 'svelte';
  import { Queue, OdometerQueue, type QueueEntry, type OdometerQueueEntry } from '$lib/client/idb';
  import {
    formatIsoDate,
    formatOdometer,
    formatCost,
    effectiveCurrencyCode,
    effectiveVolumeUnit,
    effectiveDistanceUnit,
    parseIsoLocal
  } from '$lib/client/format';
  import { unitPriceDisplay } from '$lib/client/unit-price';
  import VehicleCard from '$lib/client/VehicleCard.svelte';

  let { data } = $props();

  // Instance currency for the needsConversion comparison. Read on the client
  // (localStorage); SSR returns the 'USD' fallback but the {#each} only renders
  // after onMount, on the client instance.
  const instanceCurrency = effectiveCurrencyCode();
  const instanceUnit = effectiveVolumeUnit();
  const distUnit = effectiveDistanceUnit();

  let allEntries: QueueEntry[] = $state([]);
  // Odometer-only entries from /odometer (separate IDB store — see idb.ts).
  let odometerEntries: OdometerQueueEntry[] = $state([]);
  let loading: boolean = $state(true);
  let error: string | null = $state(null);

  // 'YYYY-MM-DD' → epoch ms via the shared parser. Local-midnight ms order
  // calendar dates identically to UTC ms — we only care about ordering, not
  // absolute display. Garbage collapses to 0 (sorts oldest).
  function dateKey(iso: string): number {
    return parseIsoLocal(iso)?.getTime() ?? 0;
  }

  type Row =
    | { kind: 'fuel'; key: string; entry: QueueEntry }
    | { kind: 'odometer'; key: string; entry: OdometerQueueEntry };

  // Fill-ups and odometer-only readings interleaved on one timeline.
  const visible = $derived.by((): Row[] => {
    const vid = data.vehicle?.id ?? null;
    if (vid === null) return [];
    const rows: Row[] = [
      ...allEntries
        .filter((e) => e.input.vehicleId === vid)
        .map((entry) => ({ kind: 'fuel' as const, key: `f${entry.id}`, entry })),
      ...odometerEntries
        .filter((e) => e.input.vehicleId === vid)
        .map((entry) => ({ kind: 'odometer' as const, key: `o${entry.id}`, entry }))
    ];
    return rows.sort(
      (a, b) =>
        dateKey(b.entry.input.date) - dateKey(a.entry.input.date) ||
        b.entry.enqueuedAt - a.entry.enqueuedAt
    );
  });

  const emptyCopy = $derived.by(() => {
    if (allEntries.length === 0 && odometerEntries.length === 0)
      return 'No fillups logged on this device yet.';
    return 'No fillups logged for this vehicle yet.';
  });

  function tagsOf(raw: string | undefined): string[] {
    if (!raw) return [];
    return raw
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  }

  function fuelCostLine(input: QueueEntry['input']): string {
    return `${input.volume.toFixed(3)} ${input.volumeUnit} · ${formatCost(input.cost, input.currency)}`;
  }

  onMount(async () => {
    try {
      const q = await Queue.open();
      allEntries = await q.list();
      odometerEntries = await (await OdometerQueue.open()).list();
    } catch (e) {
      error = (e as Error).message ?? 'IndexedDB unavailable';
    } finally {
      loading = false;
    }
  });
</script>

<header class="flex items-center mb-4 gap-3">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="text-zinc-400">‹</a>
  <h1 class="text-xl font-bold">History</h1>
</header>

{#if data.vehicle}
  <VehicleCard vehicle={data.vehicle} href="/vehicles?from=history" />
{/if}

{#if loading}
  <p class="text-zinc-400">Loading…</p>
{:else if error !== null}
  <div class="rounded-xl px-3 py-2 text-sm text-rose-300 bg-rose-500/15 border border-rose-500/30">
    Couldn't load local history: {error}
  </div>
  <p class="text-xs text-zinc-500 mt-6 italic">
    Only fillups and odometer readings logged through this PWA appear here.
  </p>
{:else if visible.length === 0}
  <p class="text-sm text-zinc-500 italic">{emptyCopy}</p>
  <p class="text-xs text-zinc-500 mt-6 italic">
    Only fillups and odometer readings logged through this PWA appear here.
  </p>
{:else}
  {#each visible as row (row.key)}
    {#if row.kind === 'odometer'}
      {@const entry = row.entry}
      <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-2" data-testid="odometer-card">
        <div class="flex items-center gap-2">
          <span class="badge border shrink-0 text-blue-300 bg-blue-500/15 border-blue-500/30">
            Odometer
          </span>
          {#if entry.status === 'queued'}
            <span class="badge border shrink-0 text-amber-300 bg-amber-500/15 border-amber-500/30">
              Queued
            </span>
          {:else if entry.status === 'failed'}
            <span class="badge border shrink-0 text-rose-300 bg-rose-500/15 border-rose-500/30">
              Failed
            </span>
          {:else if entry.deduped}
            <span class="badge border shrink-0 text-zinc-300 bg-zinc-700/40 border-zinc-600">
              Skipped
            </span>
          {/if}
          <span class="text-sm text-zinc-300">{formatIsoDate(entry.input.date)}</span>
        </div>
        <div class="text-base font-semibold text-zinc-100 mt-2">
          {`${formatOdometer(String(entry.input.odometer))} ${distUnit}`}
        </div>
        {#if entry.equipmentNames && entry.equipmentNames.length > 0}
          <div class="text-sm text-zinc-300 mt-0.5">with {entry.equipmentNames.join(', ')}</div>
        {/if}
        {#if entry.deduped && entry.status === 'synced'}
          <div class="text-xs text-zinc-500 mt-1">Already in LubeLogger — not written twice.</div>
        {/if}
        {#if entry.input.notes && entry.input.notes.trim().length > 0}
          <div class="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">
            note: {entry.input.notes}
          </div>
        {/if}
        {#if entry.status === 'failed' && entry.lastError}
          <div class="text-xs text-rose-300 mt-2">error: {entry.lastError}</div>
        {/if}
        {#if entry.status === 'failed' && entry.attempts > 0}
          <div class="text-xs text-zinc-500 mt-0.5">attempts: {entry.attempts}</div>
        {/if}
      </div>
    {:else}
      {@const entry = row.entry}
      {@const tagList = tagsOf(entry.input.tags)}
      {@const unitPrice = unitPriceDisplay(
        entry.input,
        entry.converted,
        instanceCurrency,
        instanceUnit
      )}
      <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-2" data-testid="fillup-card">
        <div class="flex items-center gap-2">
          {#if entry.status === 'queued'}
            <span class="badge border shrink-0 text-amber-300 bg-amber-500/15 border-amber-500/30">
              Queued
            </span>
          {:else if entry.status === 'failed'}
            <span class="badge border shrink-0 text-rose-300 bg-rose-500/15 border-rose-500/30">
              Failed
            </span>
          {:else if entry.deduped}
            <!-- Synced, but the server found the record already upstream and
               skipped the write. Muted zinc, not amber/rose: this is
               informative, not a problem — a replay of a POST that landed
               with its response lost is the ordinary cause. -->
            <span class="badge border shrink-0 text-zinc-300 bg-zinc-700/40 border-zinc-600">
              Skipped
            </span>
          {/if}
          <span class="text-sm text-zinc-300">{formatIsoDate(entry.input.date)}</span>
        </div>
        <div class="text-base font-semibold text-zinc-100 mt-2">
          {`${formatOdometer(String(entry.input.odometer))} ${distUnit}`}
        </div>
        <div class="text-sm text-zinc-300 mt-0.5">
          {fuelCostLine(entry.input)}
        </div>
        <div class="text-sm text-zinc-400 mt-0.5" data-testid="unit-price">
          {unitPrice.actual}{#if unitPrice.converted}<span class="text-zinc-500">
              · {unitPrice.converted}</span
            >{/if}
        </div>
        {#if entry.deduped && entry.status === 'synced'}
          <div class="text-xs text-zinc-500 mt-1">Already in LubeLogger — not written twice.</div>
        {/if}
        {#if entry.input.isFillToFull}
          <div class="text-xs text-zinc-400 mt-1">Fill-to-full</div>
        {/if}
        {#if entry.input.missedFuelup}
          <div class="text-xs text-zinc-400 mt-1">Missed fillup</div>
        {/if}
        {#if entry.input.notes && entry.input.notes.trim().length > 0}
          <div class="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">
            note: {entry.input.notes}
          </div>
        {/if}
        {#if tagList.length > 0}
          <div class="mt-2 flex flex-wrap gap-1">
            {#each tagList as tag (tag)}
              <span class="text-xs text-zinc-300 bg-zinc-700/60 rounded px-1.5 py-0.5">#{tag}</span>
            {/each}
          </div>
        {/if}
        {#if entry.status === 'failed' && entry.lastError}
          <div class="text-xs text-rose-300 mt-2">error: {entry.lastError}</div>
        {/if}
        {#if entry.status === 'failed' && entry.attempts > 0}
          <div class="text-xs text-zinc-500 mt-0.5">attempts: {entry.attempts}</div>
        {/if}
      </div>
    {/if}
  {/each}
  <p class="text-xs text-zinc-500 mt-4 italic">
    Only fillups and odometer readings logged through this PWA appear here.
  </p>
{/if}
