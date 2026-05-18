<script lang="ts">
  interface Props {
    vehicleId: number | undefined;
    class?: string;
    svgSize?: number;
  }

  let { vehicleId, class: klass = '', svgSize = 22 }: Props = $props();

  // Reset the fallback flag whenever the vehicle id changes so a fresh
  // <img> render gets a chance to load the new vehicle's photo. The `void`
  // prefix tells ESLint the property read is intentional while still
  // letting Svelte's reactivity tracker subscribe to the id primitive —
  // see docs/technical/lubelogger-car-images.md for the rationale.
  let vehicleImageOk = $state(true);
  $effect(() => { void vehicleId; vehicleImageOk = true; });
</script>

<div class="rounded-lg bg-zinc-700 shrink-0 flex items-center justify-center text-zinc-500 overflow-hidden {klass}">
  {#if vehicleImageOk && vehicleId !== undefined}
    <img
      src={`/api/vehicle/image?vehicleId=${vehicleId}`}
      alt=""
      class="w-full h-full object-cover"
      onerror={() => (vehicleImageOk = false)}
    />
  {:else}
    <svg width={svgSize} height={svgSize} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 17h14M5 17v-5l2-5h10l2 5v5M5 17H3M19 17h2M7 12h10" />
      <circle cx="8" cy="17" r="1.5" /><circle cx="16" cy="17" r="1.5" />
    </svg>
  {/if}
</div>
