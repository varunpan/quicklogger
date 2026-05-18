<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { savePrefs } from '$lib/client/prefs';
  import VehicleImage from '$lib/client/VehicleImage.svelte';

  let { data } = $props();

  // Allowlist of pages that can hand off to the picker and expect us to
  // return there post-pick. Anything else (including absent / unknown
  // values) falls back to '/' to avoid open-redirect surface.
  const RETURN_TO: Record<string, string> = {
    maintenance: '/maintenance',
    history: '/history'
  };

  function returnPath(): string {
    const from = page.url.searchParams.get('from');
    return (from && RETURN_TO[from]) || '/';
  }

  function pick(id: number) {
    savePrefs({ lastVehicleId: id });
    // eslint-disable-next-line svelte/no-navigation-without-resolve
    goto(`${returnPath()}?vehicleId=${id}`);
  }
</script>

<header class="flex items-center mb-4 gap-3">
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a href={returnPath()} class="text-zinc-400">‹</a>
  <h1 class="text-xl font-bold">Pick vehicle</h1>
</header>

{#if data.vehicles.length === 0}
  <p class="text-zinc-400">No vehicles found in LubeLogger.</p>
{:else}
  <div class="flex flex-col gap-2">
    {#each data.vehicles as v (v.id)}
      <button type="button"
              class="bg-zinc-800 rounded-xl px-3 py-3 text-left flex items-center gap-3"
              onclick={() => pick(v.id)}>
        <VehicleImage vehicleId={v.id} class="w-14 h-14" svgSize={24} />
        <div class="flex-1 min-w-0">
          <div class="text-base font-semibold truncate">
            {[v.year, v.make, v.model].filter(Boolean).join(' ')}
          </div>
          <div class="text-xs text-zinc-400">id {v.id}</div>
        </div>
      </button>
    {/each}
  </div>
{/if}
