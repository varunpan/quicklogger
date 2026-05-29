import { describe, it, expect } from 'vitest';
import { bufferPickedPhoto } from './photo-buffer';

// NOTE: the production failure (a short-streamed multipart → server
// `400 multipart parse failed`) is a real-WebKit Blob/`fetch` behavior that
// neither jsdom nor headless WebKit reproduces. These tests therefore pin the
// *structural invariant* the fix establishes — two genuinely independent
// Files — which is what the v0.2.3 regression violated (it shared one File
// between the OCR encode and the EXIF read). They would have caught that
// regression; they cannot exercise the WebKit byte-corruption itself.

function pickedFile(bytes: number[], name = 'p.jpg', type = 'image/jpeg'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('bufferPickedPhoto', () => {
  it('returns two distinct File instances with identical bytes', async () => {
    const buf = await bufferPickedPhoto(pickedFile([0xff, 0xd8, 0xff, 1, 2, 3, 4]));
    expect(buf).not.toBeNull();
    const { ocrFile, exifFile } = buf!;
    expect(ocrFile).not.toBe(exifFile); // the v0.2.3 bug shared one File here
    const a = new Uint8Array(await ocrFile.arrayBuffer());
    const b = new Uint8Array(await exifFile.arrayBuffer());
    expect([...a]).toEqual([0xff, 0xd8, 0xff, 1, 2, 3, 4]);
    expect([...b]).toEqual([...a]);
  });

  it('fully reading the EXIF copy leaves the OCR copy intact', async () => {
    const { ocrFile, exifFile } = (await bufferPickedPhoto(pickedFile([9, 8, 7, 6, 5])))!;
    await exifFile.arrayBuffer(); // consume the EXIF copy first
    const a = new Uint8Array(await ocrFile.arrayBuffer());
    expect([...a]).toEqual([9, 8, 7, 6, 5]);
  });

  it('preserves name and type, defaulting when the pick lacks them', async () => {
    const named = (await bufferPickedPhoto(pickedFile([1], 'capture-123.jpg', 'image/jpeg')))!;
    expect(named.ocrFile.name).toBe('capture-123.jpg');
    expect(named.exifFile.name).toBe('capture-123.jpg');
    expect(named.ocrFile.type).toBe('image/jpeg');

    const bare = (await bufferPickedPhoto(new Blob([new Uint8Array([1, 2])], { type: '' })))!;
    expect(bare.ocrFile.name).toBe('capture.jpg');
    expect(bare.ocrFile.type).toBe('image/jpeg');
  });

  it('returns null for a zero-byte pick', async () => {
    expect(await bufferPickedPhoto(new Blob([], { type: 'image/jpeg' }))).toBeNull();
  });
});
