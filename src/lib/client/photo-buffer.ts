// Buffer a picked photo into memory and split it into two independent Files —
// one for the OCR resize/encode pipeline, one for EXIF date prefill.
//
// Why two Files and not one: the OCR pipeline encodes its File via
// `createImageBitmap` + canvas, while date prefill reads its File via
// `Blob.slice().arrayBuffer()`. When both consumers share a single File
// (or a single Blob backing store), WebKit (iOS *and* desktop Safari)
// leaves the OCR-encoded image Blob in a state where it reports a non-zero
// `size` but streams short when `fetch` serializes the multipart body. The
// server's `request.formData()` then hits EOF before the closing boundary
// and throws, surfacing as `400 multipart parse failed`. Giving each
// consumer its own File with a separate ArrayBuffer backing store keeps the
// OCR encode pristine.
//
// This is the isolation v0.2.3 *documented* ("EXIF prefill and OCR resize
// operate on independent in-memory copies") but never actually implemented —
// v0.2.3 made one buffered File and handed the same object to both paths.

export interface BufferedPhoto {
  /** Fresh in-memory File for the OCR resize/encode pipeline. */
  ocrFile: File;
  /** Independent in-memory File (separate ArrayBuffer) for EXIF prefill. */
  exifFile: File;
}

/**
 * Read a picked photo fully into memory and return two independent Files.
 *
 * Returns `null` if the pick reads as zero bytes (degenerate File — revoked
 * permission mid-pick, broken PHAsset reference). Throws only if
 * `arrayBuffer()` itself rejects; callers surface a toast in both cases.
 */
export async function bufferPickedPhoto(picked: Blob): Promise<BufferedPhoto | null> {
  const bytes = await picked.arrayBuffer();
  if (bytes.byteLength === 0) return null;
  const name = picked instanceof File && picked.name ? picked.name : 'capture.jpg';
  const type = picked.type || 'image/jpeg';
  // `bytes.slice(0)` forces a distinct ArrayBuffer for the EXIF copy so the
  // two Files never alias the same backing store, even if an engine lazily
  // shares storage when constructing a Blob from an ArrayBuffer.
  return {
    ocrFile: new File([bytes], name, { type }),
    exifFile: new File([bytes.slice(0)], name, { type })
  };
}
