<script lang="ts">
  import { onMount } from 'svelte';
  import { Queue, type QueueEntry } from '$lib/client/idb';
  import { loadPrefs } from '$lib/client/prefs';
  import { lastFuelup } from '$lib/client/api';

  let { data: _data } = $props();
  const prefs = loadPrefs();
  let vehicleId: number | null = $state(prefs.lastVehicleId);
  let recent: Array<Record<string, unknown>> = $state([]);
  let queued: QueueEntry[] = $state([]);
  let loading: boolean = $state(true);

  async function load() {
    loading = true;
    if (vehicleId !== null) {
      const last = await lastFuelup(vehicleId);
      recent = last ? [last] : [];
    }
    const q = await Queue.open();
    queued = await q.list();
    loading = false;
  }

  onMount(load);
</script>

<header class="flex items-center mb-4 gap-3">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="text-zinc-400">‹</a>
  <h1 class="text-xl font-bold">History</h1>
</header>

{#if loading}
  <p class="text-zinc-400">Loading…</p>
{:else}
  {#if queued.length > 0}
    <h2 class="text-sm uppercase text-amber-400 mb-2">Pending sync</h2>
    <div class="flex flex-col gap-2 mb-4">
      {#each queued as q (q.id)}
        <div class="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-sm">
          <div class="text-amber-300 font-semibold">
            {q.input.volume} {q.input.volumeUnit} · {q.input.currency} {q.input.cost}
          </div>
          <div class="text-xs text-zinc-400">
            status: {q.status} · attempts: {q.attempts}
            {#if q.lastError}<br>error: {q.lastError}{/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <h2 class="text-sm uppercase text-zinc-400 mb-2">Last fillup on LubeLogger</h2>
  {#if recent.length === 0}
    <p class="text-zinc-500">None.</p>
  {:else}
    <div class="bg-zinc-800 rounded-xl p-3 text-sm">
      <pre class="text-xs whitespace-pre-wrap">{JSON.stringify(recent[0], null, 2)}</pre>
    </div>
  {/if}
{/if}
