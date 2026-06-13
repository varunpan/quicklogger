<script lang="ts">
  import { untrack } from 'svelte';
  // Crop rectangle overlay. Renders absolutely-positioned handles, a dimmed
  // shroud, and a rule-of-thirds grid on top of the image area. Emits the
  // user's chosen rect (in display-space pixels relative to the image) when
  // [Done] is tapped; emits nothing on cancel. Refuses to shrink below
  // floorSourcePx on the shortest source-space edge — finger-sized display
  // floors are too small on high-res captures.

  type PixelRect = { x: number; y: number; w: number; h: number };
  type Size = { w: number; h: number };

  interface Props {
    // The image's actual rendered rect inside this overlay's parent (origin
    // 0,0; w/h match the rendered <img>).
    imageDisplayRect: PixelRect;
    // Source image dimensions (un-rotated). Used to compute the display-space
    // floor from the source-space floor.
    sourceSize: Size;
    // Initial rect (display-space). Centered ~80% default when entering crop
    // mode with no prior crop; the prior committed rect when re-entering.
    initial: PixelRect;
    // Minimum size on the shortest edge in source-space pixels.
    floorSourcePx: number;
    oncommit: (rect: PixelRect) => void;
    oncancel: () => void;
    // When false, the overlay omits the corresponding button in its own
    // action row; the host renders one (e.g. in the modal header / footer)
    // instead. Defaults all true so the component is testable standalone.
    showOwnCancel?: boolean;
    showOwnDone?: boolean;
    showOwnReset?: boolean;
    // Live, in-progress rect, mirrored out from the overlay's internal working
    // state — bind it so the host can drive its own [Done] against the latest
    // drag state. The overlay owns the rect, so host writes to this prop are
    // ignored; hand a new `initial` to reseed it.
    liveRect?: PixelRect;
  }

  let {
    imageDisplayRect,
    sourceSize,
    initial,
    floorSourcePx,
    oncommit,
    oncancel,
    showOwnCancel = true,
    showOwnDone = true,
    showOwnReset = true,
    // eslint-disable-next-line no-useless-assignment -- $bindable() is the unbound fallback; the mirror $effect writes `rect` out through this binding, which ESLint can't see.
    liveRect = $bindable()
  }: Props = $props();

  // Active drag state — null when not dragging.
  type DragMode =
    | { kind: 'corner'; corner: 'tl' | 'tr' | 'bl' | 'br'; startX: number; startY: number; startRect: PixelRect }
    | { kind: 'edge'; edge: 't' | 'b' | 'l' | 'r'; startX: number; startY: number; startRect: PixelRect }
    | { kind: 'interior'; startX: number; startY: number; startRect: PixelRect };

  let drag: DragMode | null = null;

  // Internal working rect — the overlay's source of truth while mounted. Kept
  // here, NOT in the bindable `liveRect` prop, because Svelte re-applies an
  // *unbound* bindable's fallback on every re-render: a host that leaves
  // `liveRect` unbound (or a standalone mount) would otherwise have an
  // in-progress drag wiped when an incidental `initial` change re-renders the
  // overlay (#37). `rect` survives re-renders; we mirror it out to `liveRect`
  // below so a binding host (OcrPreview) can drive its own [Done] against live
  // drag state. Seeded once from `initial` (untrack keeps the seed a one-time
  // read); the reseed $effect tracks deliberate `initial` changes.
  let rect = $state(untrack(() => ({ ...initial })));

  // Display-space floor — finger-sized 50×50 on a 4032×3024 capture renders
  // as 200×200 in source space, which is what we actually care about.
  const floorDisplayPx = $derived(
    Math.max(1, floorSourcePx * (imageDisplayRect.w / sourceSize.w))
  );

  function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
  }

  function clampToBounds(r: PixelRect): PixelRect {
    const minX = 0;
    const minY = 0;
    const maxX = imageDisplayRect.w - r.w;
    const maxY = imageDisplayRect.h - r.h;
    return {
      x: clamp(r.x, minX, maxX),
      y: clamp(r.y, minY, maxY),
      w: r.w,
      h: r.h
    };
  }

  function onPointerDownCorner(corner: 'tl' | 'tr' | 'bl' | 'br', ev: PointerEvent) {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    drag = { kind: 'corner', corner, startX: ev.clientX, startY: ev.clientY, startRect: { ...rect } };
  }
  function onPointerDownEdge(edge: 't' | 'b' | 'l' | 'r', ev: PointerEvent) {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    drag = { kind: 'edge', edge, startX: ev.clientX, startY: ev.clientY, startRect: { ...rect } };
  }
  function onPointerDownInterior(ev: PointerEvent) {
    (ev.target as Element).setPointerCapture?.(ev.pointerId);
    drag = { kind: 'interior', startX: ev.clientX, startY: ev.clientY, startRect: { ...rect } };
  }

  function onPointerMove(ev: PointerEvent) {
    if (!drag) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    const start = drag.startRect;

    if (drag.kind === 'interior') {
      rect = clampToBounds({ x: start.x + dx, y: start.y + dy, w: start.w, h: start.h });
      return;
    }

    if (drag.kind === 'corner') {
      let x1 = start.x;
      let y1 = start.y;
      let x2 = start.x + start.w;
      let y2 = start.y + start.h;
      switch (drag.corner) {
        case 'tl':
          x1 = clamp(start.x + dx, 0, x2 - floorDisplayPx);
          y1 = clamp(start.y + dy, 0, y2 - floorDisplayPx);
          break;
        case 'tr':
          x2 = clamp(start.x + start.w + dx, x1 + floorDisplayPx, imageDisplayRect.w);
          y1 = clamp(start.y + dy, 0, y2 - floorDisplayPx);
          break;
        case 'bl':
          x1 = clamp(start.x + dx, 0, x2 - floorDisplayPx);
          y2 = clamp(start.y + start.h + dy, y1 + floorDisplayPx, imageDisplayRect.h);
          break;
        case 'br':
          x2 = clamp(start.x + start.w + dx, x1 + floorDisplayPx, imageDisplayRect.w);
          y2 = clamp(start.y + start.h + dy, y1 + floorDisplayPx, imageDisplayRect.h);
          break;
      }
      rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      return;
    }

    if (drag.kind === 'edge') {
      let x1 = start.x;
      let y1 = start.y;
      let x2 = start.x + start.w;
      let y2 = start.y + start.h;
      switch (drag.edge) {
        case 't':
          y1 = clamp(start.y + dy, 0, y2 - floorDisplayPx);
          break;
        case 'b':
          y2 = clamp(start.y + start.h + dy, y1 + floorDisplayPx, imageDisplayRect.h);
          break;
        case 'l':
          x1 = clamp(start.x + dx, 0, x2 - floorDisplayPx);
          break;
        case 'r':
          x2 = clamp(start.x + start.w + dx, x1 + floorDisplayPx, imageDisplayRect.w);
          break;
      }
      rect = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    }
  }

  function onPointerUp(ev: PointerEvent) {
    if (drag) {
      (ev.target as Element).releasePointerCapture?.(ev.pointerId);
      drag = null;
    }
  }

  function reset() {
    rect = { ...initial };
  }

  function done() {
    oncommit({ ...rect });
  }

  function cancel() {
    oncancel();
  }

  // Mirror the internal working rect out to the (optional) `liveRect` binding
  // so a host can read live drag state without owning the working copy.
  $effect(() => {
    liveRect = rect;
  });

  // Re-seed the working rect when the host hands us a genuinely new `initial`
  // (entering crop mode with a prior committed crop, or after Reset). Read
  // `initial` first so it stays a tracked dependency, THEN bail if a drag is in
  // progress: a viewport resize mid-crop (mobile URL-bar show/hide, rotation)
  // flows through the host's imgRendered → cropInitial → `initial`, which would
  // otherwise wipe the crop the user is actively dragging (#37b). `drag` is
  // non-reactive, so reading it adds no dependency — the effect still re-runs
  // only when `initial` changes, and no-ops if that lands mid-drag. When the
  // drag ends there's no reseed, so the dragged rect stands.
  $effect(() => {
    const next = initial;
    if (drag) return;
    rect = { ...next };
  });
</script>

<div
  class="absolute inset-0"
  style="touch-action: none;"
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
  role="presentation"
>
  <!-- Dimmed shroud: 4 strips outside the rect -->
  <div
    data-shroud
    class="absolute bg-black/55"
    style="left: 0; top: 0; width: {imageDisplayRect.w}px; height: {rect.y}px;"
  ></div>
  <div
    data-shroud
    class="absolute bg-black/55"
    style="left: 0; top: {rect.y + rect.h}px; width: {imageDisplayRect.w}px; height: {imageDisplayRect.h - rect.y - rect.h}px;"
  ></div>
  <div
    data-shroud
    class="absolute bg-black/55"
    style="left: 0; top: {rect.y}px; width: {rect.x}px; height: {rect.h}px;"
  ></div>
  <div
    data-shroud
    class="absolute bg-black/55"
    style="left: {rect.x + rect.w}px; top: {rect.y}px; width: {imageDisplayRect.w - rect.x - rect.w}px; height: {rect.h}px;"
  ></div>

  <!-- Rect border + grid + interior drag zone -->
  <div
    data-handle="interior"
    class="absolute border border-white/95"
    style="left: {rect.x}px; top: {rect.y}px; width: {rect.w}px; height: {rect.h}px; box-sizing: border-box; cursor: move;"
    onpointerdown={onPointerDownInterior}
    role="presentation"
  >
    <div data-grid-line class="absolute bg-white/35" style="left: 0; top: {rect.h / 3}px; width: {rect.w}px; height: 1px;"></div>
    <div data-grid-line class="absolute bg-white/35" style="left: 0; top: {(rect.h * 2) / 3}px; width: {rect.w}px; height: 1px;"></div>
    <div data-grid-line class="absolute bg-white/35" style="left: {rect.w / 3}px; top: 0; width: 1px; height: {rect.h}px;"></div>
    <div data-grid-line class="absolute bg-white/35" style="left: {(rect.w * 2) / 3}px; top: 0; width: 1px; height: {rect.h}px;"></div>
  </div>

  <!-- Corner handles. Each handle's visual position is clamped to stay
       fully inside imageDisplayRect, so the rect can be pushed flush
       against any image edge without losing access to the handle on
       that side. Clamping affects rendering only; drag-state math
       (rect, onPointerMove) is unchanged. -->
  <button
    type="button"
    data-handle="corner"
    data-corner="tl"
    aria-label="Top-left handle"
    class="absolute bg-white border border-zinc-900 rounded-sm"
    style="left: {clamp(rect.x - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y - 7, 0, imageDisplayRect.h - 14)}px; width: 14px; height: 14px;"
    onpointerdown={(ev) => onPointerDownCorner('tl', ev)}
  ></button>
  <button
    type="button"
    data-handle="corner"
    data-corner="tr"
    aria-label="Top-right handle"
    class="absolute bg-white border border-zinc-900 rounded-sm"
    style="left: {clamp(rect.x + rect.w - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y - 7, 0, imageDisplayRect.h - 14)}px; width: 14px; height: 14px;"
    onpointerdown={(ev) => onPointerDownCorner('tr', ev)}
  ></button>
  <button
    type="button"
    data-handle="corner"
    data-corner="bl"
    aria-label="Bottom-left handle"
    class="absolute bg-white border border-zinc-900 rounded-sm"
    style="left: {clamp(rect.x - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y + rect.h - 7, 0, imageDisplayRect.h - 14)}px; width: 14px; height: 14px;"
    onpointerdown={(ev) => onPointerDownCorner('bl', ev)}
  ></button>
  <button
    type="button"
    data-handle="corner"
    data-corner="br"
    aria-label="Bottom-right handle"
    class="absolute bg-white border border-zinc-900 rounded-sm"
    style="left: {clamp(rect.x + rect.w - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y + rect.h - 7, 0, imageDisplayRect.h - 14)}px; width: 14px; height: 14px;"
    onpointerdown={(ev) => onPointerDownCorner('br', ev)}
  ></button>

  <!-- Edge handles -->
  <button
    type="button"
    data-handle="edge"
    data-edge="t"
    aria-label="Top edge"
    class="absolute bg-white rounded-sm"
    style="left: {clamp(rect.x + rect.w / 2 - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y - 2, 0, imageDisplayRect.h - 4)}px; width: 14px; height: 4px;"
    onpointerdown={(ev) => onPointerDownEdge('t', ev)}
  ></button>
  <button
    type="button"
    data-handle="edge"
    data-edge="b"
    aria-label="Bottom edge"
    class="absolute bg-white rounded-sm"
    style="left: {clamp(rect.x + rect.w / 2 - 7, 0, imageDisplayRect.w - 14)}px; top: {clamp(rect.y + rect.h - 2, 0, imageDisplayRect.h - 4)}px; width: 14px; height: 4px;"
    onpointerdown={(ev) => onPointerDownEdge('b', ev)}
  ></button>
  <button
    type="button"
    data-handle="edge"
    data-edge="l"
    aria-label="Left edge"
    class="absolute bg-white rounded-sm"
    style="left: {clamp(rect.x - 2, 0, imageDisplayRect.w - 4)}px; top: {clamp(rect.y + rect.h / 2 - 7, 0, imageDisplayRect.h - 14)}px; width: 4px; height: 14px;"
    onpointerdown={(ev) => onPointerDownEdge('l', ev)}
  ></button>
  <button
    type="button"
    data-handle="edge"
    data-edge="r"
    aria-label="Right edge"
    class="absolute bg-white rounded-sm"
    style="left: {clamp(rect.x + rect.w - 2, 0, imageDisplayRect.w - 4)}px; top: {clamp(rect.y + rect.h / 2 - 7, 0, imageDisplayRect.h - 14)}px; width: 4px; height: 14px;"
    onpointerdown={(ev) => onPointerDownEdge('r', ev)}
  ></button>
</div>

<!-- Action row hosted by the overlay so the test can find Reset/Done/Cancel.
     Buttons are conditionally rendered so the host can lift them into the
     modal header / footer when wiring up Task 4. -->
<div class="absolute left-0 right-0 bottom-0 px-4 pb-4 pt-2 flex items-center justify-between gap-2 pointer-events-auto">
  {#if showOwnCancel}
    <button
      type="button"
      data-action="cancel"
      class="flex-1 inline-flex items-center justify-center text-zinc-300 bg-zinc-800 rounded-xl px-3 py-3 text-sm font-semibold"
      onclick={cancel}
    >
      Cancel
    </button>
  {/if}
  {#if showOwnReset}
    <button
      type="button"
      data-action="reset"
      class="flex-1 inline-flex items-center justify-center text-zinc-300 bg-zinc-800 rounded-xl px-3 py-3 text-sm font-semibold"
      onclick={reset}
    >
      Reset
    </button>
  {/if}
  {#if showOwnDone}
    <button
      type="button"
      data-action="done"
      class="flex-1 inline-flex items-center justify-center text-white bg-blue-600 rounded-xl px-3 py-3 text-sm font-semibold"
      onclick={done}
    >
      Done
    </button>
  {/if}
</div>
