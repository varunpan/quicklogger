<script lang="ts">
  import { onMount } from 'svelte';
  import { Queue, type QueueEntry } from '$lib/client/idb';
  import { formatIsoDate, formatOdometer, formatCost, effectiveCurrencyCode } from '$lib/client/format';
  import { unitPriceDisplay } from '$lib/client/unit-price';
  import VehicleImage from '$lib/client/VehicleImage.svelte';

  let { data } = $props();

  // Instance currency for the needsConversion comparison. Read on the client
  // (localStorage); SSR returns the 'USD' fallback but the {#each} only renders
  // after onMount, on the client instance.
  const instanceCurrency = effectiveCurrencyCode();

  let allEntries: QueueEntry[] = $state([]);
  let loading: boolean = $state(true);
  let error: string | null = $state(null);

  const vehicleLabel = $derived.by(() => {
    const v = data.vehicle;
    if (!v) return '';
    return [v.year, v.make, v.model].filter(Boolean).join(' ');
  });

  // 'YYYY-MM-DD' → epoch ms. UTC keeps the comparison stable across
  // timezones — we only care about ordering, not absolute display.
  function dateKey(iso: string): number {
    const [y, m, d] = iso.split('-').map(Number);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) {
      return 0;
    }
    return Date.UTC(y, m - 1, d);
  }

  const visible = $derived.by(() => {
    const vid = data.vehicle?.id ?? null;
    if (vid === null) return [];
    return allEntries
      .filter((e) => e.input.vehicleId === vid)
      .sort(
        (a, b) =>
          dateKey(b.input.date) - dateKey(a.input.date) ||
          b.enqueuedAt - a.enqueuedAt
      );
  });

  const emptyCopy = $derived.by(() => {
    if (allEntries.length === 0) return 'No fillups logged on this device yet.';
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
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/vehicles?from=history" class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full">
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

{#if loading}
  <p class="text-zinc-400">Loading…</p>
{:else if error !== null}
  <div class="rounded-xl px-3 py-2 text-sm text-rose-300 bg-rose-500/15 border border-rose-500/30">
    Couldn't load local history: {error}
  </div>
  <p class="text-xs text-zinc-500 mt-6 italic">
    Only fillups logged through this PWA appear here.
  </p>
{:else if visible.length === 0}
  <p class="text-sm text-zinc-500 italic">{emptyCopy}</p>
  <p class="text-xs text-zinc-500 mt-6 italic">
    Only fillups logged through this PWA appear here.
  </p>
{:else}
  {#each visible as entry (entry.id)}
    {@const tagList = tagsOf(entry.input.tags)}
    {@const unitPrice = unitPriceDisplay(entry.input, entry.converted, instanceCurrency)}
    <div class="bg-zinc-800 rounded-xl px-4 py-3 mb-2" data-testid="fillup-card">
      <div class="flex items-center gap-2">
        {#if entry.status === 'queued'}
          <span class="text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 border shrink-0 text-amber-300 bg-amber-500/15 border-amber-500/30">
            Queued
          </span>
        {:else if entry.status === 'failed'}
          <span class="text-[10px] uppercase tracking-wider font-semibold rounded px-1.5 py-0.5 border shrink-0 text-rose-300 bg-rose-500/15 border-rose-500/30">
            Failed
          </span>
        {/if}
        <span class="text-sm text-zinc-300">{formatIsoDate(entry.input.date)}</span>
      </div>
      <div class="text-base font-semibold text-zinc-100 mt-2">
        {formatOdometer(String(entry.input.odometer))} mi
      </div>
      <div class="text-sm text-zinc-300 mt-0.5">
        {fuelCostLine(entry.input)}
      </div>
      <div class="text-sm text-zinc-400 mt-0.5" data-testid="unit-price">
        {unitPrice.actual}{#if unitPrice.converted}<span class="text-zinc-500"> · {unitPrice.converted}</span>{/if}
      </div>
      {#if entry.input.isFillToFull}
        <div class="text-xs text-zinc-400 mt-1">Fill-to-full</div>
      {/if}
      {#if entry.input.missedFuelup}
        <div class="text-xs text-zinc-400 mt-1">Missed fillup</div>
      {/if}
      {#if entry.input.notes && entry.input.notes.trim().length > 0}
        <div class="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">note: {entry.input.notes}</div>
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
  {/each}
  <p class="text-xs text-zinc-500 mt-4 italic">
    Only fillups logged through this PWA appear here.
  </p>
{/if}
