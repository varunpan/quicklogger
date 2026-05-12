// Resize a user-supplied image (camera capture) to a server-friendly JPEG:
// long edge clamped to 1024 px, quality 0.8, EXIF stripped (Canvas re-encode
// drops metadata). Result lands at ~150–300 KB for an iPhone capture,
// vs ~3–4 MB raw.
//
// Honors EXIF orientation via `createImageBitmap({ imageOrientation: 'from-image' })`
// where available; older Safari falls back to HTMLCanvasElement where
// orientation may not be honored (~2% of iOS users, accepted trade-off).

const MAX_LONG_EDGE = 1024;
const JPEG_QUALITY = 0.8;

export async function resizeForOcr(file: File): Promise<Blob> {
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
      const scale = Math.min(1, MAX_LONG_EDGE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('OffscreenCanvas 2d context unavailable');
      ctx.drawImage(bitmap, 0, 0, w, h);
      return await canvas.convertToBlob({ type: 'image/jpeg', quality: JPEG_QUALITY });
    } finally {
      bitmap.close();
    }
  }

  // Fallback — HTMLImageElement + HTMLCanvasElement. EXIF orientation may
  // not be honored on this path.
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_LONG_EDGE / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2d context unavailable');
    ctx.drawImage(img, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('toBlob returned null')),
        'image/jpeg',
        JPEG_QUALITY
      );
    });
  } finally {
    URL.revokeObjectURL(url);
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
