<script lang="ts">
  import VehicleImage from '$lib/client/VehicleImage.svelte';
  import { vehicleLabel } from '$lib/client/format';
  import type { Vehicle } from '$lib/server/lubelogger';

  // The tappable "current vehicle" card that opens the picker. Renders as an
  // <a> when `href` is given (history / maintenance / stats) or as a <button>
  // with `onclick` (home, which carries form state onto the picker URL).
  let { vehicle, href, onclick }: { vehicle: Vehicle; href?: string; onclick?: () => void } =
    $props();
</script>

{#snippet content()}
  <VehicleImage vehicleId={vehicle.id} class="w-12 h-12" />
  <div class="text-left flex-1 min-w-0">
    <div class="field-label">Vehicle</div>
    <div class="text-base font-semibold truncate text-zinc-100">
      {vehicleLabel(vehicle)}
    </div>
  </div>
  <span class="text-zinc-500" aria-hidden="true">›</span>
{/snippet}

{#if href}
  <!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
  <a {href} class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full">
    {@render content()}
  </a>
{:else}
  <button
    type="button"
    class="bg-zinc-800 rounded-xl px-3 py-3 mb-3 flex items-center gap-3 w-full"
    {onclick}
  >
    {@render content()}
  </button>
{/if}
