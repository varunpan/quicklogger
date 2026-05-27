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

  // Canvas used for the post-crop preview. Only mounts when previewMode ===
  // 'preview' && crop != null. We render the cropped+rotated bitmap onto it
  // so the preview literally shows what `resizeForOcr` will send on the wire.
  let previewCanvas: HTMLCanvasElement | undefined = $state();
  // Lazily-decoded ImageBitmap of the original file. Cached because both
  // canvas renders (preview after Done, plus re-renders on rotation change)
  // hit the same source bytes — decoding once per modal mount is enough.
  let bitmapCache: ImageBitmap | null = null;
  let bitmapPromise: Promise<ImageBitmap> | null = null;

  // Long-edge clamp for the preview canvas. Mirrors the constant inside
  // resizeForOcr so the preview is byte-shape-equivalent to the wire output
  // (modulo JPEG encoding) — what you see is literally what you send.
  const PREVIEW_MAX_LONG_EDGE = 1024;

  async function getBitmap(): Promise<ImageBitmap> {
    if (bitmapCache) return bitmapCache;
    if (!bitmapPromise) {
      bitmapPromise = createImageBitmap(file, { imageOrientation: 'from-image' })
        .catch(() => createImageBitmap(file));  // Safari fallback, same as image.ts
    }
    bitmapCache = await bitmapPromise;
    return bitmapCache;
  }

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
    bitmapCache?.close();
    bitmapCache = null;
    bitmapPromise = null;
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

  const modeLabel = $derived(mode === 'pump' ? 'Pump display' : 'Odometer');

  // Render the cropped+rotated region into the preview canvas when in
  // 'preview' mode with a committed crop. Re-runs whenever previewMode flips
  // to 'preview', the crop rect changes, or the rotation changes. The math
  // here mirrors resizeForOcr's renderToJpegBlob: same source rect derivation
  // from the normalized crop, same long-edge clamp, same transpose-for-90/270
  // rotation handling. The preview is literally a draft of the wire bytes.
  $effect(() => {
    const m = previewMode;
    const c = crop;
    const r = rotation;
    const canvas = previewCanvas;
    if (m !== 'preview' || !c || !canvas) return;

    let cancelled = false;
    (async () => {
      try {
        const bitmap = await getBitmap();
        if (cancelled) return;
        const sx = Math.round(c.x * bitmap.width);
        const sy = Math.round(c.y * bitmap.height);
        const sw = Math.round(c.w * bitmap.width);
        const sh = Math.round(c.h * bitmap.height);
        const scale = Math.min(1, PREVIEW_MAX_LONG_EDGE / Math.max(sw, sh));
        const baseW = Math.max(1, Math.round(sw * scale));
        const baseH = Math.max(1, Math.round(sh * scale));
        const transpose = r === 90 || r === 270;
        canvas.width = transpose ? baseH : baseW;
        canvas.height = transpose ? baseW : baseH;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(1, 0, 0, 1, 0, 0);  // reset between re-renders
        switch (r) {
          case 0:
            break;
          case 90:
            ctx.translate(baseH, 0);
            ctx.rotate(Math.PI / 2);
            break;
          case 180:
            ctx.translate(baseW, baseH);
            ctx.rotate(Math.PI);
            break;
          case 270:
            ctx.translate(0, baseW);
            ctx.rotate(-Math.PI / 2);
            break;
        }
        ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, baseW, baseH);
      } catch {
        // Swallow — preview just stays blank. The user can re-enter crop
        // mode (which re-renders the source <img>) and try again. Real
        // wire-encoding errors surface from resizeForOcr at Send time.
      }
    })();

    return () => {
      cancelled = true;
    };
  });

  // After a cropped → un-cropped transition (e.g. Reset → Done) the <img>
  // re-mounts, but a cached blob URL may resolve synchronously before the
  // load listener attaches. Manually invoke measureImg when imgEl appears
  // already-complete so CropOverlay positioning is correct on the next Crop
  // entry. The reactive read of imgEl re-triggers when it (re)mounts.
  $effect(() => {
    const el = imgEl;
    if (!el) return;
    if (el.complete && el.naturalWidth > 0) {
      // eslint-disable-next-line @typescript-eslint/no-unused-expressions
      previewMode;  // re-run when the template swaps img back in
      measureImg();
    }
  });
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
      {#if previewMode === 'preview' && crop}
        <!--
          Post-crop preview: render only the cropped+rotated region into a
          canvas. Replaces the prior shroud-outside-the-rect visualization,
          which was effectively invisible on dark photos. The canvas content
          is byte-shape-equivalent to what resizeForOcr will send.
        -->
        <canvas
          bind:this={previewCanvas}
          class="max-w-full max-h-full block object-contain"
          aria-label="Cropped preview"
        ></canvas>
      {:else}
        <!--
          Viewport-relative max sizes live directly on the <img>, not the
          wrapper. The previous `max-w-full max-h-full` on the img was
          chained off `inline-block` parents that have `height: auto`,
          which makes the img's `max-h: 100%` a circular reference —
          tall portrait photos rendered at their natural pixel height,
          overflowing the viewport and dragging the CropOverlay handles
          off-screen. Calc against the dynamic viewport gives the img a
          definite max regardless of wrapper sizing chains. 14rem covers
          the worst-case chrome (header + preview-mode footer + py-6
          padding) with a small safety margin; 3rem covers the side
          px-6 padding. The wrapper stays `inline-block` so it hugs the
          (now-clamped) image and CropOverlay's `absolute inset-0`
          continues to match the img's display rect exactly.
        -->
        <div class="relative inline-block">
          <img
            bind:this={imgEl}
            src={objectUrl}
            alt="Captured for OCR preview"
            class="max-w-[calc(100vw_-_3rem)] max-h-[calc(100dvh_-_14rem)] object-contain transition-transform duration-150 block"
            style="transform: rotate({rotation}deg)"
            onload={measureImg}
          />

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
