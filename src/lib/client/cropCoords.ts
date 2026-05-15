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
