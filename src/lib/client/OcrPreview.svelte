<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Rotation, NormalizedRect } from './image';
  import type { OcrMode } from '$lib/shared/types';
  import CropOverlay from './CropOverlay.svelte';
  import { displayToSource, sourceToDisplay } from './cropCoords';

  interface Props {
    file: File;
    mode: OcrMode;
    onsubmit: (payload: { rotation: Rotation; crop: NormalizedRect | null }) => void;
    oncancel: () => void;
    onretake: () => void;
  }

  let { file, mode, onsubmit, oncancel, onretake }: Props = $props();

  let rotation: Rotation = $state(0);
  let crop: NormalizedRect | null = $state(null);
  let objectUrl: string = $state('');

  type PreviewMode = 'preview' | 'crop';
  let previewMode: PreviewMode = $state('preview');

  // Bound to the on-screen <img> so we can measure its rendered rect for
  // CropOverlay. Updated reactively as the image loads / window resizes.
  let imgEl: HTMLImageElement | undefined = $state();
  let imgRendered: { w: number; h: number } = $state({ w: 0, h: 0 });
  // Intrinsic image size in un-rotated source pixels. Set on load.
  let sourceSize: { w: number; h: number } = $state({ w: 0, h: 0 });

  // Live, in-progress rect from CropOverlay — host drives its own [Done] /
  // [Reset] action buttons against this bound state.
  let cropLive: { x: number; y: number; w: number; h: number } = $state({
    x: 0,
    y: 0,
    w: 0,
    h: 0
  });

  function measureImg() {
    if (!imgEl) return;
    // Use the bounding-box dimensions of the rendered image (after CSS
    // rotation those are already swapped). `naturalWidth/Height` give the
    // un-rotated intrinsic size for sourceSize.
    const r = imgEl.getBoundingClientRect();
    imgRendered = { w: r.width, h: r.height };
    if (imgEl.naturalWidth && imgEl.naturalHeight) {
      sourceSize = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
    }
  }

  onMount(() => {
    objectUrl = URL.createObjectURL(file);
    const onResize = () => measureImg();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  });

  // Re-measure on rotation change. CSS transform: rotate swaps the
  // axis-aligned bounding box returned by getBoundingClientRect, so
  // imgRendered must be refreshed or CropOverlay handles and the
  // committed-crop shroud land on pre-rotation coords. queueMicrotask
  // defers the read until after the reactive style commit.
  $effect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    rotation; // explicit dependency — Svelte 5 tracks reads inside $effect
    if (!imgEl) return;
    queueMicrotask(measureImg);
  });

  onDestroy(() => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  });

  function rotateRight() {
    rotation = ((rotation + 90) % 360) as Rotation;
  }
  function rotateLeft() {
    rotation = ((rotation + 270) % 360) as Rotation;
  }

  // Default rect inside the rendered image — centered 80%. Display-space
  // pixels relative to the image's rendered rect (0..imgRendered.w / .h).
  function defaultDisplayRect(): { x: number; y: number; w: number; h: number } {
    const w = imgRendered.w * 0.8;
    const h = imgRendered.h * 0.8;
    return {
      x: (imgRendered.w - w) / 2,
      y: (imgRendered.h - h) / 2,
      w,
      h
    };
  }

  // The initial rect handed to CropOverlay when entering crop mode. If a
  // prior crop exists, convert it back to display-space; otherwise use the
  // 80% centered default. Reads `crop` ($state) — only changes when the
  // host writes `crop`, never mid-drag. Stable while the overlay is mounted.
  const cropInitial = $derived.by(() => {
    if (crop) {
      return sourceToDisplay(crop, imgRendered, rotation);
    }
    return defaultDisplayRect();
  });

  function enterCropMode() {
    previewMode = 'crop';
  }

  function commitCrop(rect: { x: number; y: number; w: number; h: number }) {
    // If the live rect is the centered 80% default, treat as "no crop
    // committed" to honor the Reset→Done semantics from the spec (Reset
    // snaps to the default; Done commits whatever's live).
    const def = defaultDisplayRect();
    const isDefault =
      Math.abs(rect.x - def.x) < 1 &&
      Math.abs(rect.y - def.y) < 1 &&
      Math.abs(rect.w - def.w) < 1 &&
      Math.abs(rect.h - def.h) < 1;
    if (isDefault) {
      crop = null;
    } else {
      crop = displayToSource(rect, imgRendered, rotation);
    }
    previewMode = 'preview';
  }

  function cancelCrop() {
    // Discard in-progress edit, restore prior crop value (or null).
    previewMode = 'preview';
  }

  function resetCropOverlay() {
    // Snap the live rect back to the default 80% centered rect; the
    // commitCrop default-detection then maps Done → crop=null.
    crop = null;
    cropLive = defaultDisplayRect();
  }

  function send() {
    onsubmit({ rotation, crop });
  }

  function handleKeyDown(ev: KeyboardEvent) {
    if (ev.key === 'Escape') {
      if (previewMode === 'crop') cancelCrop();
      else oncancel();
    }
  }

  // Display-space rect for rendering the committed-crop shroud in preview
  // mode. Null when no crop is set or measurements aren't ready yet.
  const committedShroud = $derived.by(() => {
    if (!crop) return null;
    if (imgRendered.w === 0 || imgRendered.h === 0) return null;
    return sourceToDisplay(crop, imgRendered, rotation);
  });

  const modeLabel = $derived(mode === 'pump' ? 'Pump display' : 'Odometer');
</script>

<svelte:window onkeydown={handleKeyDown} />

<div
  class="fixed inset-0 z-50 bg-zinc-950 flex flex-col"
  role="dialog"
  aria-modal="true"
  aria-label="Photo preview"
>
  <header class="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
    {#if previewMode === 'preview'}
      <button
        type="button"
        class="flex items-center gap-1.5 text-zinc-300 -ml-1"
        aria-label="Cancel"
        onclick={oncancel}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
        <span class="text-sm font-semibold">Cancel</span>
      </button>
      <div class="text-sm font-semibold text-zinc-300 flex items-center gap-2">
        <span>Preview · <span class="text-zinc-500">{modeLabel}</span></span>
        {#if crop}
          <span class="text-[10px] uppercase tracking-wider font-semibold text-blue-300 bg-blue-500/15 border border-blue-500/30 rounded px-1.5 py-0.5">Cropped</span>
        {/if}
      </div>
    {:else}
      <button
        type="button"
        class="flex items-center gap-1.5 text-zinc-300 -ml-1"
        aria-label="Cancel crop"
        onclick={cancelCrop}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18" />
          <line x1="6" y1="18" x2="18" y2="6" />
        </svg>
        <span class="text-sm font-semibold">Cancel crop</span>
      </button>
      <div class="text-sm font-semibold text-zinc-300">
        Crop · <span class="text-zinc-500">{modeLabel}</span>
      </div>
    {/if}
  </header>

  <div class="flex-1 flex items-center justify-center bg-zinc-950 px-6 py-6 overflow-hidden">
    {#if objectUrl}
      <div class="relative inline-block">
        <img
          bind:this={imgEl}
          src={objectUrl}
          alt="Captured for OCR preview"
          class="max-w-full max-h-full object-contain transition-transform duration-150 block"
          style="transform: rotate({rotation}deg)"
          onload={measureImg}
        />

        {#if previewMode === 'preview' && committedShroud}
          <!-- Dimmed-outside frame visualizing the committed crop. -->
          <div data-shroud-committed class="absolute pointer-events-none bg-black/60" style="left: 0; top: 0; width: {imgRendered.w}px; height: {committedShroud.y}px;"></div>
          <div data-shroud-committed class="absolute pointer-events-none bg-black/60" style="left: 0; top: {committedShroud.y + committedShroud.h}px; width: {imgRendered.w}px; height: {imgRendered.h - committedShroud.y - committedShroud.h}px;"></div>
          <div data-shroud-committed class="absolute pointer-events-none bg-black/60" style="left: 0; top: {committedShroud.y}px; width: {committedShroud.x}px; height: {committedShroud.h}px;"></div>
          <div data-shroud-committed class="absolute pointer-events-none bg-black/60" style="left: {committedShroud.x + committedShroud.w}px; top: {committedShroud.y}px; width: {imgRendered.w - committedShroud.x - committedShroud.w}px; height: {committedShroud.h}px;"></div>
          <div class="absolute pointer-events-none border border-white/50" style="left: {committedShroud.x}px; top: {committedShroud.y}px; width: {committedShroud.w}px; height: {committedShroud.h}px; box-sizing: border-box;"></div>
        {/if}

        {#if previewMode === 'crop' && imgRendered.w > 0 && sourceSize.w > 0}
          <CropOverlay
            imageDisplayRect={{ x: 0, y: 0, w: imgRendered.w, h: imgRendered.h }}
            sourceSize={sourceSize}
            initial={cropInitial}
            floorSourcePx={200}
            showOwnCancel={false}
            showOwnDone={false}
            showOwnReset={false}
            bind:liveRect={cropLive}
            oncommit={commitCrop}
            oncancel={cancelCrop}
          />
        {/if}
      </div>
    {/if}
  </div>

  {#if previewMode === 'preview'}
    <div class="px-4 pb-2">
      <div class="flex items-center justify-between gap-1.5">
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center gap-1 text-zinc-300 bg-zinc-800 rounded-xl px-2 py-2.5 text-xs font-semibold"
          aria-label="Rotate left 90 degrees"
          onclick={rotateLeft}
        >
          <span aria-hidden="true">↺</span>
          <span>Rotate</span>
        </button>
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center text-zinc-300 bg-zinc-800 rounded-xl px-2 py-2.5 text-xs font-semibold"
          onclick={onretake}
        >
          Retake
        </button>
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center gap-1 {crop ? 'text-blue-300 ring-1 ring-blue-500/40 bg-zinc-800' : 'text-zinc-300 bg-zinc-800'} rounded-xl px-2 py-2.5 text-xs font-semibold"
          aria-label="Crop image"
          onclick={enterCropMode}
        >
          <span>Crop</span>
        </button>
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center gap-1 text-zinc-300 bg-zinc-800 rounded-xl px-2 py-2.5 text-xs font-semibold"
          aria-label="Rotate right 90 degrees"
          onclick={rotateRight}
        >
          <span>Rotate</span>
          <span aria-hidden="true">↻</span>
        </button>
      </div>
    </div>

    <div class="px-4 pt-2 pb-4">
      <button
        type="button"
        class="bg-blue-600 text-white rounded-xl py-4 text-base font-semibold w-full"
        onclick={send}
      >
        Send for OCR
      </button>
    </div>
  {:else}
    <div class="px-4 pb-4 pt-2">
      <div class="flex items-center justify-between gap-2">
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center text-zinc-300 bg-zinc-800 rounded-xl px-3 py-3 text-sm font-semibold"
          onclick={resetCropOverlay}
        >
          Reset
        </button>
        <button
          type="button"
          class="flex-1 inline-flex items-center justify-center text-white bg-blue-600 rounded-xl px-3 py-3 text-sm font-semibold"
          onclick={() => commitCrop(cropLive)}
        >
          Done
        </button>
      </div>
    </div>
  {/if}
</div>
