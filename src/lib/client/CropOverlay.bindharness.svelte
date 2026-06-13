<script lang="ts">
  // Test-only harness: mounts CropOverlay with `liveRect` BOUND, mirroring how
  // OcrPreview uses it in production (`bind:liveRect={cropLive}` + a host [Done]
  // that commits `cropLive`). Lets the unit tests exercise the bound path — the
  // internal-rect → `liveRect` mirror (#37) — which the standalone tests can't.
  import { untrack } from 'svelte';
  import CropOverlay from './CropOverlay.svelte';

  type PixelRect = { x: number; y: number; w: number; h: number };

  let {
    initial,
    oncommit
  }: { initial: PixelRect; oncommit: (rect: PixelRect) => void } = $props();

  // Host-owned live rect, seeded once (untrack mirrors OcrPreview's snapshot).
  let live = $state<PixelRect>(untrack(() => ({ ...initial })));
</script>

<CropOverlay
  imageDisplayRect={{ x: 0, y: 0, w: 400, h: 300 }}
  {initial}
  floorSourcePx={200}
  sourceSize={{ w: 2000, h: 1500 }}
  showOwnCancel={false}
  showOwnDone={false}
  showOwnReset={false}
  bind:liveRect={live}
  oncommit={() => {}}
  oncancel={() => {}}
/>

<!-- Host-rendered Done: commits the BOUND live rect, exactly like OcrPreview. -->
<button type="button" data-action="host-done" onclick={() => oncommit({ ...live })}>Done</button>
