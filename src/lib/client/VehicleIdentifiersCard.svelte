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
    const ok = await writeToClipboard(value);
    if (!ok) return;
    copiedField = field;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copiedField = null;
      copiedTimer = null;
    }, 1500);
  }

  async function writeToClipboard(value: string): Promise<boolean> {
    // Modern path requires a secure context (HTTPS or localhost). On a
    // homelab LAN over plain HTTP, navigator.clipboard is undefined in
    // every browser, so we have to fall back.
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return true;
      } catch {
        // Permission denied or transient failure — fall through to the
        // execCommand path rather than giving up.
      }
    }
    return execCommandCopy(value);
  }

  function execCommandCopy(value: string): boolean {
    if (typeof document === 'undefined') return false;
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    // iOS Safari refuses to copy from off-screen elements, so the
    // textarea has to be on-screen but visually inert.
    textarea.style.position = 'fixed';
    textarea.style.top = '0';
    textarea.style.left = '0';
    textarea.style.width = '1px';
    textarea.style.height = '1px';
    textarea.style.padding = '0';
    textarea.style.border = 'none';
    textarea.style.outline = 'none';
    textarea.style.boxShadow = 'none';
    textarea.style.background = 'transparent';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    const previousActive = document.activeElement as HTMLElement | null;
    try {
      // Focus has to land on the textarea so document.execCommand('copy')
      // sees it as activeElement. Without this WebKit copies an empty
      // selection (or nothing at all).
      textarea.focus({ preventScroll: true });
      // Mobile Safari ignores plain .select() on programmatically-added
      // textareas; the Range/Selection dance is the path that works on
      // both desktop and iOS WebKit.
      const range = document.createRange();
      range.selectNodeContents(textarea);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      textarea.setSelectionRange(0, value.length);
      return document.execCommand('copy');
    } catch {
      return false;
    } finally {
      document.body.removeChild(textarea);
      // Restore focus so the page's keyboard / scroll position isn't
      // perturbed by the temporary textarea. Failing the restore is
      // harmless — the worst case is the body becomes the active
      // element, which is the default state anyway.
      previousActive?.focus?.({ preventScroll: true });
    }
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
