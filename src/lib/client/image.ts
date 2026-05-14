// Resize a user-supplied image (camera capture or library pick) to a
// server-friendly JPEG: long edge clamped to 1024 px, quality 0.8, EXIF
// stripped (Canvas re-encode drops metadata). Result lands at ~150–300 KB
// for an iPhone capture, vs ~3–4 MB raw.
//
// Honors EXIF orientation via `createImageBitmap({ imageOrientation: 'from-image' })`
// where available; older Safari falls back to HTMLCanvasElement where
// orientation may not be honored (~2% of iOS users, accepted trade-off).
//
// Optional `{ rotation }` — when set, applied as a single transform inside
// the same canvas pass (no double re-encode). Used by the preview screen
// after the user taps `[↺ 90°]` / `[↻ 90°]`.

const MAX_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export type Rotation = 0 | 90 | 180 | 270;

export interface ResizeOptions {
  rotation?: Rotation;
}

export async function resizeForOcr(
  file: Blob,
  opts: ResizeOptions = {}
): Promise<Blob> {
  const rotation = (opts.rotation ?? 0) as Rotation;

  // Preferred path — uses createImageBitmap (honors EXIF) + OffscreenCanvas.
  if (typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Some browsers reject the `imageOrientation` option — retry without it.
      bitmap = await createImageBitmap(file);
    }
    try {
      return await renderToJpegBlob(bitmap, rotation);
    } finally {
      bitmap.close();
    }
  }

  // Fallback — HTMLImageElement + HTMLCanvasElement. EXIF orientation may
  // not be honored on this path.
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await renderToJpegBlob(img, rotation);
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Dimensioned {
  width: number;
  height: number;
}

async function renderToJpegBlob(
  source: CanvasImageSource & Dimensioned,
  rotation: Rotation
): Promise<Blob> {
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(source.width, source.height));
  const baseW = Math.max(1, Math.round(source.width * scale));
  const baseH = Math.max(1, Math.round(source.height * scale));

  // Output canvas dimensions transpose for 90/270.
  const transpose = rotation === 90 || rotation === 270;
  const canvasW = transpose ? baseH : baseW;
  const canvasH = transpose ? baseW : baseH;

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(canvasW, canvasH);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
    applyRotation(ctx as unknown as CanvasRenderingContext2D, rotation, baseW, baseH);
    ctx.drawImage(source as CanvasImageSource, 0, 0, baseW, baseH);
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
  }

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  applyRotation(ctx, rotation, baseW, baseH);
  ctx.drawImage(source as CanvasImageSource, 0, 0, baseW, baseH);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

function applyRotation(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  rotation: Rotation,
  imgW: number,
  imgH: number
): void {
  // Translate to the rotated image's origin, then rotate, so a subsequent
  // drawImage(0, 0, imgW, imgH) lands inside the (possibly transposed) canvas.
  switch (rotation) {
    case 0:
      return;
    case 90:
      ctx.translate(imgH, 0);
      ctx.rotate(Math.PI / 2);
      return;
    case 180:
      ctx.translate(imgW, imgH);
      ctx.rotate(Math.PI);
      return;
    case 270:
      ctx.translate(0, imgW);
      ctx.rotate(-Math.PI / 2);
      return;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image decode failed'));
    img.src = src;
  });
}
