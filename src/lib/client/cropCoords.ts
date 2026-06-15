import type { NormalizedRect, Rotation } from './image';

export interface PixelRect {
  x: number; y: number; w: number; h: number;
}

export interface Size {
  w: number; h: number;
}

// Convert a display-space pixel rect into the equivalent normalized rect in
// un-rotated source coordinates. `displaySize` is the actual rendered size
// of the image on screen (after CSS rotation). Used by OcrPreview when the
// CropOverlay commits, exactly once.
//
// Coordinate convention:
//   - Display-space (input): origin top-left, x grows right, y grows down,
//     measured in the rotated frame the user actually touched.
//   - Source-space (output): origin top-left of the un-rotated EXIF-oriented
//     image, all four components normalized into [0, 1].
export function displayToSource(
  rect: PixelRect,
  displaySize: Size,
  rotation: Rotation
): NormalizedRect {
  const { x, y, w, h } = rect;
  const dw = displaySize.w;
  const dh = displaySize.h;

  switch (rotation) {
    case 0:
      return {
        x: x / dw,
        y: y / dh,
        w: w / dw,
        h: h / dh
      };
    case 90:
      // 90° clockwise: display top-left = source top-right.
      // source width axis runs along display height; source height axis
      // runs along display width (inverted).
      return {
        x: y / dh,
        y: 1 - (x + w) / dw,
        w: h / dh,
        h: w / dw
      };
    case 180:
      return {
        x: 1 - (x + w) / dw,
        y: 1 - (y + h) / dh,
        w: w / dw,
        h: h / dh
      };
    case 270:
      return {
        x: 1 - (y + h) / dh,
        y: x / dw,
        w: h / dh,
        h: w / dw
      };
  }
}

// Inverse of displayToSource. Used by OcrPreview to draw the committed-crop
// shroud in preview mode, and to pre-load the overlay with the prior rect
// on re-entry.
export function sourceToDisplay(
  rect: NormalizedRect,
  displaySize: Size,
  rotation: Rotation
): PixelRect {
  const { x, y, w, h } = rect;
  const dw = displaySize.w;
  const dh = displaySize.h;

  switch (rotation) {
    case 0:
      return { x: x * dw, y: y * dh, w: w * dw, h: h * dh };
    case 90:
      // Inverse of the 90 branch in displayToSource.
      return {
        x: (1 - y - h) * dw,
        y: x * dh,
        w: h * dw,
        h: w * dh
      };
    case 180:
      return {
        x: (1 - x - w) * dw,
        y: (1 - y - h) * dh,
        w: w * dw,
        h: h * dh
      };
    case 270:
      return {
        x: y * dw,
        y: (1 - x - w) * dh,
        w: h * dw,
        h: w * dh
      };
  }
}

// --- Zoom/pan view transform (pinch-zoom crop, v0.3.0) -----------------------
//
// The crop box lives in SCREEN space and stays fixed; the photo zooms/pans
// behind it. The on-screen view transform is `screen = base·zoom + pan`
// (transform-origin top-left), where `base` is a point in the existing
// fit-rendered, rotation-aware display frame that displayToSource already
// consumes. zoom enters the crop math in exactly ONE place: viewportToBase at
// commit time. At zoom=1, pan={0,0} every helper below is the identity, so the
// no-zoom workflow is byte-for-byte unchanged.

// Max on-screen magnification. 5× on a 4032-px photo fit to a ~360-px viewport
// is ~2 source px per screen px — ample for digit selection. Tunable here only.
export const MAX_ZOOM = 5;

// Clamp magnification to [1, MAX_ZOOM]. Min 1 = fit (no zoom-out past the whole
// image; no letterbox). Non-finite input: NaN and -Infinity collapse to 1;
// +Infinity (runaway zoom-in) clamps to MAX_ZOOM.
export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return zoom > 0 ? MAX_ZOOM : 1;
  if (zoom < 1) return 1;
  if (zoom > MAX_ZOOM) return MAX_ZOOM;
  return zoom;
}

// Clamp pan so the zoomed image always covers the viewport (no empty gutter).
// With origin top-left the image spans [pan, pan + viewport·zoom]; to cover
// [0, viewport] we need viewport·(1 - zoom) ≤ pan ≤ 0. At zoom=1 this forces
// (0, 0). Non-finite components coerce to 0.
export function clampPan(
  pan: { x: number; y: number },
  zoom: number,
  viewport: Size
): { x: number; y: number } {
  const z = Math.max(1, Number.isFinite(zoom) ? zoom : 1);
  const minX = viewport.w * (1 - z);
  const minY = viewport.h * (1 - z);
  const px = Number.isFinite(pan.x) ? pan.x : 0;
  const py = Number.isFinite(pan.y) ? pan.y : 0;
  return {
    x: Math.min(0, Math.max(minX, px)),
    y: Math.min(0, Math.max(minY, py))
  };
}

// Invert the view transform: recover the base-display rect that a screen-space
// box covers. Identity at zoom=1, pan={0,0}. Composed before displayToSource at
// commit; pan does not affect w/h.
export function viewportToBase(
  box: PixelRect,
  zoom: number,
  pan: { x: number; y: number }
): PixelRect {
  return {
    x: (box.x - pan.x) / zoom,
    y: (box.y - pan.y) / zoom,
    w: box.w / zoom,
    h: box.h / zoom
  };
}
