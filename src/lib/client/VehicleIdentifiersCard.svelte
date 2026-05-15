<script lang="ts">
  interface Props {
    licensePlate?: string;
    vin?: string;
  }

  let { licensePlate, vin }: Props = $props();

  // Normalize once at the render boundary: treat whitespace-only as missing.
  const plateValue = $derived(licensePlate?.trim() || '');
  const vinValue = $derived(vin?.trim() || '');
  const showCard = $derived(plateValue !== '' || vinValue !== '');

  let copiedField = $state<'plate' | 'vin' | null>(null);
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  async function copy(field: 'plate' | 'vin', value: string) {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard write blocked (rare: insecure context, permissions).
      // Fall back silently — iOS Safari long-press select-and-copy on the
      // value text still works because we don't use user-select: none.
      return;
    }
    copiedField = field;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedField = null;
      copiedTimer = null;
    }, 1500);
  }
</script>

{#if showCard}
  <div class="bg-zinc-800 rounded-xl px-3 py-2 mb-3" data-testid="vehicle-identifiers-card">
    {#if plateValue}
      <button
        type="button"
        class="w-full flex items-center gap-3 py-2 text-left"
        data-testid="vehicle-identifiers-plate"
        onclick={() => copy('plate', plateValue)}
      >
        <span class="field-label w-14 shrink-0">
          {copiedField === 'plate' ? 'Copied ✓' : 'Plate'}
        </span>
        <span class="flex-1 min-w-0 truncate font-mono text-base text-zinc-100">
          {plateValue}
        </span>
        {#if copiedField !== 'plate'}
          <svg
            class="text-zinc-500 shrink-0"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        {/if}
      </button>
    {/if}
    {#if vinValue}
      <button
        type="button"
        class="w-full flex items-center gap-3 py-2 text-left"
        data-testid="vehicle-identifiers-vin"
        onclick={() => copy('vin', vinValue)}
      >
        <span class="field-label w-14 shrink-0">
          {copiedField === 'vin' ? 'Copied ✓' : 'VIN'}
        </span>
        <span class="flex-1 min-w-0 truncate font-mono text-base text-zinc-100">
          {vinValue}
        </span>
        {#if copiedField !== 'vin'}
          <svg
            class="text-zinc-500 shrink-0"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="9" y="9" width="13" height="13" rx="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
        {/if}
      </button>
    {/if}
  </div>
{/if}
