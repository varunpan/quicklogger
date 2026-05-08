<script lang="ts">
  import { goto } from '$app/navigation';
  import { savePrefs } from '$lib/client/prefs';

  let { data } = $props();

  function pick(id: number) {
    savePrefs({ lastVehicleId: id });
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    goto('/');
  }
</script>

<header class="flex items-center mb-4 gap-3">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href="/" class="text-zinc-400">‹</a>
  <h1 class="text-xl font-bold">Pick vehicle</h1>
</header>

{#if data.vehicles.length === 0}
  <p class="text-zinc-400">No vehicles found in LubeLogger.</p>
{:else}
  <div class="flex flex-col gap-2">
    {#each data.vehicles as v (v.id)}
      <button type="button"
              class="bg-zinc-800 rounded-xl px-4 py-3 text-left"
              onclick={() => pick(v.id)}>
        <div class="text-base font-semibold">
          {[v.year, v.make, v.model].filter(Boolean).join(' ')}
        </div>
        <div class="text-xs text-zinc-400">id {v.id}</div>
      </button>
    {/each}
  </div>
{/if}
