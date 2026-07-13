<script lang="ts">
  // The three inline SVG icons repeated across pages (camera ×5, warning
  // triangle ×3, external-link arrow ×3 before extraction). One-off icons
  // (menu, close, checkmark) stay inline at their single call site.
  export type IconName = 'camera' | 'warning' | 'external';

  let {
    name,
    size = 14,
    class: cls = ''
  }: { name: IconName; size?: number; class?: string } = $props();

  // The external-link arrow has always rendered at a heavier stroke.
  const strokeWidth = $derived(name === 'external' ? 2.5 : 2);
</script>

<svg
  class={cls}
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width={strokeWidth}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === 'camera'}
    <path
      d="M14.5 4l1.5 2h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3l1.5-2z"
    />
    <circle cx="12" cy="13" r="3.5" />
  {:else if name === 'warning'}
    <path
      d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
    />
  {:else}
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  {/if}
</svg>
