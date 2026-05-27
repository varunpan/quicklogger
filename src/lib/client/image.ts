// Resize a user-supplied image (camera capture or library pick) to a
// server-friendly JPEG: long edge clamped to 1024 px, quality 0.8, EXIF
// stripped (Canvas re-encode drops metadata). Result lands at ~150–300 KB
// for an iPhone capture, vs ~3–4 MB raw.
//
// Honors EXIF orientation via `createImageBitmap({ imageOrientation: 'from-image' })`
// where available; older Safari falls back to HTMLCanvasElement where
// orientation may not be honored (~2% of iOS users, accepted trade-off).
//
// Optional `{ rotation, crop }` — both applied as a single canvas pass.
// `crop` is in normalized [0..1] un-rotated source coords; the 1024 px clamp
// applies to the cropped region, so the cost reduction comes from fewer
// source pixels feeding the same long-edge ceiling.

const MAX_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export type Rotation = 0 | 90 | 180 | 270;

export interface NormalizedRect {
  x: number;  // 0..1, relative to un-rotated image width
  y: number;  // 0..1, relative to un-rotated image height
  w: number;  // 0..1
  h: number;  // 0..1
}

export interface ResizeOptions {
  rotation?: Rotation;
  crop?: NormalizedRect | null;  // null and undefined behave identically
}

export async function resizeForOcr(
  file: Blob,
  opts: ResizeOptions = {}
): Promise<Blob> {
  const rotation = (opts.rotation ?? 0) as Rotation;
  const crop = sanitizeCrop(opts.crop);

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
      return await renderToJpegBlob(bitmap, rotation, crop);
    } finally {
      bitmap.close();
    }
  }

  // Fallback — HTMLImageElement + HTMLCanvasElement. EXIF orientation may
  // not be honored on this path.
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    return await renderToJpegBlob(img, rotation, crop);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Defensive parse — any invalid rect collapses to `null` (= full image).
// Same posture as the existing rotation defensive parse.
function sanitizeCrop(c: NormalizedRect | null | undefined): NormalizedRect | null {
  if (!c) return null;
  const { x, y, w, h } = c;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h)) return null;
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return null;
  if (x + w > 1 || y + h > 1) return null;
  return { x, y, w, h };
}

interface Dimensioned {
  width: number;
  height: number;
}

interface RenderDims {
  sx: number; sy: number; sw: number; sh: number;
  baseW: number; baseH: number;
  canvasW: number; canvasH: number;
}

function computeRenderDims(
  source: Dimensioned,
  rotation: Rotation,
  crop: NormalizedRect | null
): RenderDims {
  // Source rect: full image when crop is null, else the cropped region.
  const sx = crop ? Math.round(crop.x * source.width) : 0;
  const sy = crop ? Math.round(crop.y * source.height) : 0;
  const sw = crop ? Math.round(crop.w * source.width) : source.width;
  const sh = crop ? Math.round(crop.h * source.height) : source.height;

  // Destination size derives from the (possibly cropped) source rect.
  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(sw, sh));
  const baseW = Math.max(1, Math.round(sw * scale));
  const baseH = Math.max(1, Math.round(sh * scale));

  // Output canvas dimensions transpose for 90/270.
  const transpose = rotation === 90 || rotation === 270;
  const canvasW = transpose ? baseH : baseW;
  const canvasH = transpose ? baseW : baseH;

  return { sx, sy, sw, sh, baseW, baseH, canvasW, canvasH };
}

async function renderViaOffscreenCanvas(
  source: CanvasImageSource & Dimensioned,
  rotation: Rotation,
  d: RenderDims
): Promise<Blob> {
  const canvas = new OffscreenCanvas(d.canvasW, d.canvasH);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
  applyRotation(ctx as unknown as CanvasRenderingContext2D, rotation, d.baseW, d.baseH);
  ctx.drawImage(source as CanvasImageSource, d.sx, d.sy, d.sw, d.sh, 0, 0, d.baseW, d.baseH);
  return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
}

async function renderViaHtmlCanvas(
  source: CanvasImageSource & Dimensioned,
  rotation: Rotation,
  d: RenderDims
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = d.canvasW;
  canvas.height = d.canvasH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  applyRotation(ctx, rotation, d.baseW, d.baseH);
  ctx.drawImage(source as CanvasImageSource, d.sx, d.sy, d.sw, d.sh, 0, 0, d.baseW, d.baseH);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('toBlob returned null'))),
      'image/jpeg',
      JPEG_QUALITY
    );
  });
}

async function renderToJpegBlob(
  source: CanvasImageSource & Dimensioned,
  rotation: Rotation,
  crop: NormalizedRect | null
): Promise<Blob> {
  const d = computeRenderDims(source, rotation, crop);

  if (typeof OffscreenCanvas !== 'undefined') {
    const blob = await renderViaOffscreenCanvas(source, rotation, d);
    if (blob.size > 0) return blob;
    // iOS Safari's OffscreenCanvas.convertToBlob intermittently returns a
    // zero-byte Blob (WebKit bug class affecting 16.4+). Falling through to
    // HTMLCanvasElement.toBlob uses a separate decode/encode chain that
    // iOS Safari handles reliably. Diagnostic warn so the failure mode is
    // visible in the server log via /api/log forwarding.
    console.warn('OffscreenCanvas.convertToBlob returned 0 bytes, falling back to HTMLCanvasElement', {
      sourceW: source.width,
      sourceH: source.height,
      crop,
      rotation,
      canvasW: d.canvasW,
      canvasH: d.canvasH
    });
  }

  const fallback = await renderViaHtmlCanvas(source, rotation, d);
  if (fallback.size === 0) {
    throw new Error('image encode produced 0 bytes on both OffscreenCanvas and HTMLCanvasElement');
  }
  return fallback;
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
