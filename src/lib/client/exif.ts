/**
 * Read the photo's EXIF DateTimeOriginal tag.
 *
 * Returns null if the file is not a recognized image format, has no EXIF
 * block, has no DateTimeOriginal tag, or the parse fails for any reason.
 *
 * Reads at most the first ~128 KB of the file — enough for any phone's
 * EXIF block (JPEG APP1 marker or HEIC `meta` box + first Exif extent).
 */
export async function readPhotoDate(file: Blob): Promise<Date | null> {
  try {
    const slice = file.slice(0, MAX_READ_BYTES);
    const buf = await slice.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const format = sniffFormat(bytes);
    let tiff: Uint8Array | null = null;
    if (format === 'jpeg') tiff = findExifInJpeg(bytes);
    else if (format === 'heic') tiff = findExifInHeic(bytes);
    if (!tiff) return null;
    return readDateTimeOriginal(tiff);
  } catch {
    return null;
  }
}

export type PhotoDateCue = 'set' | 'missing' | null;

export interface InterpretResult {
  /** ISO YYYY-MM-DD to write to the form, present only when cue === 'set'. */
  newIsoDate?: string;
  /** Cue chip variant, or null for the fresh-camera no-op case. */
  cue: PhotoDateCue;
}

/**
 * Apply the photo-date-prefill state-machine rule:
 *   - photoDate === null      → cue 'missing', no date change
 *   - formatted(photoDate) === todayIso → cue null, no date change
 *   - else                    → cue 'set', newIsoDate = formatted(photoDate)
 *
 * `todayIso` MUST be the caller's current local-time YYYY-MM-DD (use the same
 * local-component formatting — see `formatLocalDate` below).
 */
export function interpretPhotoDate(
  photoDate: Date | null,
  todayIso: string
): InterpretResult {
  if (photoDate === null) return { cue: 'missing' };
  const iso = formatLocalDate(photoDate);
  if (iso === todayIso) return { cue: null };
  return { newIsoDate: iso, cue: 'set' };
}

/**
 * Format a Date as YYYY-MM-DD using local-time components. NOT
 * `toISOString().slice(0,10)` — that UTC-shifts late-evening Dates.
 */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${da}`;
}

// --- internals --------------------------------------------------------------

const MAX_READ_BYTES = 128 * 1024;

function sniffFormat(b: Uint8Array): 'jpeg' | 'heic' | 'unknown' {
  // JPEG: starts with FF D8 FF
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
    return 'jpeg';
  // HEIC: ISO BMFF with major brand at bytes 8..11. Major brand may be heic,
  // heix, mif1, msf1, hevc, hevx — accept the common iOS / Android set.
  if (b.length >= 12) {
    const isFtyp =
      b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // 'ftyp'
    if (isFtyp) {
      const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
      if (['heic', 'heix', 'mif1', 'msf1', 'hevc', 'hevx'].includes(brand))
        return 'heic';
    }
  }
  return 'unknown';
}

// Walk JPEG segment markers looking for the APP1 (FFE1) marker whose payload
// starts with "Exif\0\0". Return the TIFF block (the bytes after the 6-byte
// "Exif\0\0" prefix), or null.
function findExifInJpeg(b: Uint8Array): Uint8Array | null {
  // Skip SOI (FF D8)
  let i = 2;
  while (i + 4 <= b.length) {
    if (b[i] !== 0xff) return null; // malformed
    const marker = b[i + 1];
    i += 2;
    // Standalone markers (no length): D0..D7 (RSTn), D8 (SOI), D9 (EOI), 01
    if (marker === 0xd9 || marker === 0xd8 || marker === 0x01) return null;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (i + 2 > b.length) return null;
    const segLen = (b[i] << 8) | b[i + 1]; // includes the 2-byte length itself
    if (segLen < 2 || i + segLen > b.length) return null;
    if (marker === 0xe1) {
      // APP1. Payload starts at i+2 and is segLen-2 bytes long.
      const payloadStart = i + 2;
      const payloadEnd = i + segLen;
      if (
        payloadEnd - payloadStart >= 6 &&
        b[payloadStart] === 0x45 && // E
        b[payloadStart + 1] === 0x78 && // x
        b[payloadStart + 2] === 0x69 && // i
        b[payloadStart + 3] === 0x66 && // f
        b[payloadStart + 4] === 0x00 &&
        b[payloadStart + 5] === 0x00
      ) {
        return b.subarray(payloadStart + 6, payloadEnd);
      }
    }
    i += segLen;
  }
  return null;
}

// Walk ISO BMFF top-level boxes, find `meta`, then walk meta children to find
// `iinf` (item info — locate the Exif item_ID) and `iloc` (item location —
// look up its extent offset/length). Slice the EXIF item from the file bytes,
// drop the 4-byte name-length prefix per ISO 14496-12, return the TIFF block.
function findExifInHeic(b: Uint8Array): Uint8Array | null {
  const root = walkBoxes(b, 0, b.length);
  const meta = root.find((box) => box.type === 'meta');
  if (!meta) return null;
  // meta is a "full box" — skip 4 bytes (version + flags) before children.
  const metaChildren = walkBoxes(b, meta.bodyStart + 4, meta.bodyEnd);

  const iinf = metaChildren.find((box) => box.type === 'iinf');
  if (!iinf) return null;
  const exifItemId = findExifItemId(b, iinf.bodyStart, iinf.bodyEnd);
  if (exifItemId === null) return null;

  const iloc = metaChildren.find((box) => box.type === 'iloc');
  if (!iloc) return null;
  const extent = findExtentForItem(b, iloc.bodyStart, iloc.bodyEnd, exifItemId);
  if (!extent) return null;

  const { offset, length } = extent;
  if (offset + length > b.length) return null;
  const itemBytes = b.subarray(offset, offset + length);
  // Per HEIF: the Exif item payload starts with a 4-byte big-endian
  // ItemDataLength giving the length of the optional item identifier name
  // (which we don't need). Skip that 4-byte prefix to land at the TIFF block.
  if (itemBytes.length < 4) return null;
  return itemBytes.subarray(4);
}

interface BoxRef {
  type: string;
  bodyStart: number;
  bodyEnd: number;
}

function walkBoxes(b: Uint8Array, start: number, end: number): BoxRef[] {
  const out: BoxRef[] = [];
  let i = start;
  while (i + 8 <= end) {
    const size =
      (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const bodyStart = i + 8;
    let bodyEnd: number;
    if (size === 1) {
      // 64-bit size at i+8..i+16. We don't expect EXIF-relevant boxes to use
      // 64-bit lengths; bail.
      return out;
    } else if (size === 0) {
      // box extends to end of file
      bodyEnd = end;
    } else if (size < 8 || i + size > end) {
      return out; // malformed
    } else {
      bodyEnd = i + size;
    }
    out.push({ type, bodyStart, bodyEnd });
    if (size === 0) return out;
    i += size;
  }
  return out;
}

function findExifItemId(
  b: Uint8Array,
  start: number,
  end: number
): number | null {
  // iinf is a "full box": version(1) + flags(3) + entry_count.
  if (end - start < 4) return null;
  const version = b[start];
  let i = start + 4;
  // entry_count is 2 bytes in v0, 4 bytes in v1+.
  if (version === 0) {
    if (i + 2 > end) return null;
    i += 2;
  } else {
    if (i + 4 > end) return null;
    i += 4;
  }
  // Walk the infe sub-boxes.
  while (i + 8 <= end) {
    const size =
      (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (size < 8 || i + size > end) return null;
    if (type === 'infe') {
      const id = readInfeItemIdIfExif(b, i + 8, i + size);
      if (id !== null) return id;
    }
    i += size;
  }
  return null;
}

// Inside one infe box body, return the item_ID iff the item_type is "Exif".
function readInfeItemIdIfExif(
  b: Uint8Array,
  start: number,
  end: number
): number | null {
  if (end - start < 4) return null;
  const version = b[start];
  // version(1) + flags(3) consumed.
  let i = start + 4;
  // item_ID: 2 bytes in v0/v2, 4 bytes in v3.
  let itemId: number;
  if (version === 0 || version === 2) {
    if (i + 2 > end) return null;
    itemId = (b[i] << 8) | b[i + 1];
    i += 2;
  } else if (version === 3) {
    if (i + 4 > end) return null;
    itemId =
      (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
    i += 4;
  } else {
    return null;
  }
  // item_protection_index: 2 bytes
  if (i + 2 > end) return null;
  i += 2;
  // item_type: 4 ASCII bytes (v2+)
  if (version >= 2) {
    if (i + 4 > end) return null;
    const itemType = String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
    if (itemType !== 'Exif') return null;
    return itemId;
  }
  return null;
}

function findExtentForItem(
  b: Uint8Array,
  start: number,
  end: number,
  itemId: number
): { offset: number; length: number } | null {
  // iloc is a "full box": version(1) + flags(3) + size byte + size byte +
  // item_count + per-item entries.
  if (end - start < 8) return null;
  const version = b[start];
  let i = start + 4;
  const sizeByte1 = b[i++]; // (offset_size << 4) | length_size
  const sizeByte2 = b[i++]; // (base_offset_size << 4) | (index_size or reserved)
  const offsetSize = (sizeByte1 >> 4) & 0x0f;
  const lengthSize = sizeByte1 & 0x0f;
  const baseOffsetSize = (sizeByte2 >> 4) & 0x0f;
  const indexSize = sizeByte2 & 0x0f; // v1/v2 only
  // item_count: 2 bytes in v0/v1, 4 bytes in v2.
  let itemCount: number;
  if (version === 2) {
    if (i + 4 > end) return null;
    itemCount =
      (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
    i += 4;
  } else {
    if (i + 2 > end) return null;
    itemCount = (b[i] << 8) | b[i + 1];
    i += 2;
  }
  for (let it = 0; it < itemCount; it++) {
    // item_ID: 2 bytes in v0/v1, 4 bytes in v2.
    let id: number;
    if (version === 2) {
      if (i + 4 > end) return null;
      id = (b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3];
      i += 4;
    } else {
      if (i + 2 > end) return null;
      id = (b[i] << 8) | b[i + 1];
      i += 2;
    }
    // construction_method: 2 bytes in v1/v2 (4 reserved bits + 12 ignored,
    // but per spec only construction_method=0 is "file offset"). v0 has no
    // construction_method.
    if (version === 1 || version === 2) {
      if (i + 2 > end) return null;
      i += 2;
    }
    if (i + 2 > end) return null;
    i += 2; // data_reference_index
    // base_offset: baseOffsetSize bytes
    let baseOffset = 0;
    for (let k = 0; k < baseOffsetSize; k++) {
      if (i >= end) return null;
      baseOffset = baseOffset * 256 + b[i++];
    }
    if (i + 2 > end) return null;
    const extentCount = (b[i] << 8) | b[i + 1];
    i += 2;
    for (let e = 0; e < extentCount; e++) {
      // extent_index (v1/v2 with indexSize > 0)
      if ((version === 1 || version === 2) && indexSize > 0) {
        if (i + indexSize > end) return null;
        i += indexSize;
      }
      let extOffset = 0;
      for (let k = 0; k < offsetSize; k++) {
        if (i >= end) return null;
        extOffset = extOffset * 256 + b[i++];
      }
      let extLength = 0;
      for (let k = 0; k < lengthSize; k++) {
        if (i >= end) return null;
        extLength = extLength * 256 + b[i++];
      }
      if (id === itemId) {
        return { offset: baseOffset + extOffset, length: extLength };
      }
    }
  }
  return null;
}

// Parse a TIFF block. Read byte-order marker, walk IFD0 to find the
// ExifIFDPointer (0x8769), follow it to the SubIFD, find DateTimeOriginal
// (0x9003) — 19 ASCII chars "YYYY:MM:DD HH:MM:SS" — and return a Date in
// local time. Return null on any structural or parse failure.
function readDateTimeOriginal(tiff: Uint8Array): Date | null {
  if (tiff.length < 8) return null;
  const bo = tiff[0] === 0x49 && tiff[1] === 0x49 ? 'II' : tiff[0] === 0x4d && tiff[1] === 0x4d ? 'MM' : null;
  if (!bo) return null;
  const u16 = (off: number) =>
    bo === 'II' ? tiff[off] | (tiff[off + 1] << 8) : (tiff[off] << 8) | tiff[off + 1];
  const u32 = (off: number) =>
    bo === 'II'
      ? tiff[off] | (tiff[off + 1] << 8) | (tiff[off + 2] << 16) | (tiff[off + 3] << 24)
      : (tiff[off] << 24) | (tiff[off + 1] << 16) | (tiff[off + 2] << 8) | tiff[off + 3];

  if (u16(2) !== 0x002a) return null;
  const ifd0Offset = u32(4);
  if (ifd0Offset + 2 > tiff.length) return null;
  const exifIfdOffset = findTagValue(tiff, ifd0Offset, 0x8769, u16, u32);
  if (exifIfdOffset === null) return null;
  if (exifIfdOffset + 2 > tiff.length) return null;
  const dateOffset = findTagValue(tiff, exifIfdOffset, 0x9003, u16, u32);
  if (dateOffset === null) return null;
  // DateTimeOriginal is ASCII, count 20 (19 chars + NUL), so the value is
  // always offset-style. Read 19 bytes.
  if (dateOffset + 19 > tiff.length) return null;
  let s = '';
  for (let k = 0; k < 19; k++) s += String.fromCharCode(tiff[dateOffset + k]);
  // Format: "YYYY:MM:DD HH:MM:SS"
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, y, mo, da, h, mi, se] = m;
  const date = new Date(+y, +mo - 1, +da, +h, +mi, +se);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

// Walk an IFD looking for a single tag. Return its value:
//  - For LONG (type 4, count 1) tags, the value is interpreted as an offset
//    into the TIFF block (the IFD entry's value field IS the offset).
//  - For ASCII (type 2, count <= 4) the value field holds the inlined bytes,
//    but DateTimeOriginal is 20 bytes so it's always an offset — we don't
//    handle the inline case.
function findTagValue(
  tiff: Uint8Array,
  ifdOffset: number,
  tagToFind: number,
  u16: (off: number) => number,
  u32: (off: number) => number
): number | null {
  if (ifdOffset + 2 > tiff.length) return null;
  const count = u16(ifdOffset);
  let i = ifdOffset + 2;
  for (let e = 0; e < count; e++) {
    if (i + 12 > tiff.length) return null;
    const tag = u16(i);
    const type = u16(i + 2);
    const cnt = u32(i + 4);
    const valueField = u32(i + 8);
    if (tag === tagToFind) {
      if (tagToFind === 0x8769) {
        // ExifIFDPointer: type LONG (4), count 1, value IS the SubIFD offset.
        if (type === 4 && cnt === 1) return valueField;
        return null;
      }
      if (tagToFind === 0x9003) {
        // DateTimeOriginal: ASCII (type 2), count 20, value field is offset.
        if (type === 2 && cnt === 20) return valueField;
        return null;
      }
      return valueField;
    }
    i += 12;
  }
  return null;
}
