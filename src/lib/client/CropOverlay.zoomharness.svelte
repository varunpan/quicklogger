<script lang="ts">
  // Test-only harness: mounts CropOverlay with zoom/pan BOUND and a bind:this
  // ref, mirroring how OcrPreview drives zoom in production. Renders +/-/readout
  // and a host-Done that commits the inverse-transformed box. Lets the unit
  // tests exercise the button-driven zoom + commit-with-zoom paths.
  import { untrack } from 'svelte';
  import CropOverlay from './CropOverlay.svelte';
  import { viewportToBase } from './cropCoords';

  type PixelRect = { x: number; y: number; w: number; h: number };

  let {
    initial,
    oncommit
  }: { initial: PixelRect; oncommit: (rect: PixelRect) => void } = $props();

  let live = $state<PixelRect>(untrack(() => ({ ...initial })));
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let overlayRef: CropOverlay | undefined = $state();
</script>

<CropOverlay
  bind:this={overlayRef}
  imageDisplayRect={{ x: 0, y: 0, w: 400, h: 300 }}
  {initial}
  floorSourcePx={200}
  sourceSize={{ w: 2000, h: 1500 }}
  showOwnCancel={false}
  showOwnDone={false}
  showOwnReset={false}
  bind:liveRect={live}
  bind:liveZoom={zoom}
  bind:livePan={pan}
  oncommit={() => {}}
  oncancel={() => {}}
/>

<button type="button" data-action="zoom-in" onclick={() => overlayRef?.zoomIn()}>+</button>
<button type="button" data-action="zoom-out" onclick={() => overlayRef?.zoomOut()}>−</button>
<span data-testid="zoom">{zoom.toFixed(2)}</span>
<button type="button" data-action="host-done" onclick={() => oncommit(viewportToBase({ ...live }, zoom, pan))}>Done</button>
