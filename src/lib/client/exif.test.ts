import { describe, expect, it } from 'vitest';
import { readPhotoDate, interpretPhotoDate } from './exif';

// --- JPEG fixture builder ---------------------------------------------------
//
// Builds a minimal valid JPEG containing an EXIF APP1 segment whose SubIFD
// holds a single DateTimeOriginal tag. Keeps the JPEG body trivial (SOI +
// APP1 + EOI) — we never decode the image, only the EXIF block.
//
// Byte layout of the APP1 payload after "Exif\0\0":
//   TIFF header (8 bytes):
//     II (0x4949) or MM (0x4D4D)   — byte-order marker
//     magic 0x002A                 — TIFF magic
//     IFD0 offset (4 bytes)        — set to 8 (right after header)
//   IFD0:
//     entry count (2 bytes) = 1
//     entry: tag=0x8769 (ExifIFDPointer), type=4 (LONG), count=1,
//            value = byte offset to SubIFD from TIFF header start
//     next-IFD offset (4 bytes) = 0
//   SubIFD:
//     entry count (2 bytes) = 1
//     entry: tag=0x9003 (DateTimeOriginal), type=2 (ASCII), count=20,
//            value = byte offset to the ASCII string from TIFF header start
//     next-IFD offset (4 bytes) = 0
//   ASCII string: 20 bytes — 19 chars "YYYY:MM:DD HH:MM:SS" + NUL terminator

function buildExifJpeg(opts: {
  dateTimeOriginal?: string;
  byteOrder?: 'II' | 'MM';
  omitDateTimeOriginal?: boolean;
}): Uint8Array {
  const byteOrder = opts.byteOrder ?? 'II';
  const dto = opts.dateTimeOriginal ?? '2026:05:12 14:33:00';
  if (dto.length !== 19) throw new Error('DateTimeOriginal must be 19 chars');

  const tiff: number[] = [];
  const u16 = (v: number) => {
    if (byteOrder === 'II') tiff.push(v & 0xff, (v >> 8) & 0xff);
    else tiff.push((v >> 8) & 0xff, v & 0xff);
  };
  const u32 = (v: number) => {
    if (byteOrder === 'II')
      tiff.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
    else
      tiff.push((v >> 24) & 0xff, (v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
  };

  // TIFF header
  if (byteOrder === 'II') tiff.push(0x49, 0x49);
  else tiff.push(0x4d, 0x4d);
  u16(0x002a);
  u32(8); // IFD0 starts immediately after the 8-byte header

  if (opts.omitDateTimeOriginal) {
    // IFD0 with zero entries (no ExifIFDPointer at all)
    u16(0); // count
    u32(0); // next IFD
  } else {
    // IFD0: one entry -> ExifIFDPointer (tag 0x8769, LONG, count 1)
    u16(1); // entry count
    u16(0x8769); // tag
    u16(4); // type = LONG
    u32(1); // count
    // value: offset to SubIFD start. IFD0 is 2 + 12 + 4 = 18 bytes,
    // so SubIFD begins at offset 8 + 18 = 26.
    u32(26);
    u32(0); // next IFD

    // SubIFD: one entry -> DateTimeOriginal (tag 0x9003, ASCII, count 20)
    u16(1); // entry count
    u16(0x9003); // tag
    u16(2); // type = ASCII
    u32(20); // count
    // value: offset to ASCII string. SubIFD is 2 + 12 + 4 = 18 bytes,
    // so the string begins at offset 26 + 18 = 44.
    u32(44);
    u32(0); // next IFD

    // ASCII bytes
    for (let i = 0; i < 19; i++) tiff.push(dto.charCodeAt(i));
    tiff.push(0x00); // NUL terminator
  }

  // APP1 payload = "Exif\0\0" + TIFF
  const exifHeader = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
  const app1Payload = [...exifHeader, ...tiff];
  // APP1 length field includes itself (2 bytes) + payload bytes
  const app1Len = app1Payload.length + 2;
  const app1 = [
    0xff,
    0xe1,
    (app1Len >> 8) & 0xff,
    app1Len & 0xff,
    ...app1Payload
  ];

  // SOI + APP1 + EOI
  return new Uint8Array([0xff, 0xd8, ...app1, 0xff, 0xd9]);
}

function buildBlob(bytes: Uint8Array): Blob {
  // Cast through BlobPart[]: TS widens our Uint8Array to <ArrayBufferLike>
  // (which would admit SharedArrayBuffer) while Blob's lib.dom typings want
  // <ArrayBuffer>. Our bytes always come from a regular ArrayBuffer.
  return new Blob([bytes as BlobPart], { type: 'image/jpeg' });
}

// --- readPhotoDate tests ----------------------------------------------------

describe('readPhotoDate — JPEG', () => {
  it('returns a Date for canonical little-endian JPEG with DateTimeOriginal', async () => {
    const blob = buildBlob(buildExifJpeg({ dateTimeOriginal: '2026:05:12 14:33:00' }));
    const date = await readPhotoDate(blob);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(4); // May = 4 (0-indexed)
    expect(date!.getDate()).toBe(12);
  });

  it('returns a Date for big-endian (MM) JPEG with DateTimeOriginal', async () => {
    const blob = buildBlob(
      buildExifJpeg({ dateTimeOriginal: '2025:11:01 09:00:00', byteOrder: 'MM' })
    );
    const date = await readPhotoDate(blob);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2025);
    expect(date!.getMonth()).toBe(10); // November
    expect(date!.getDate()).toBe(1);
  });

  it('returns null when JPEG has EXIF block but no DateTimeOriginal tag', async () => {
    const blob = buildBlob(buildExifJpeg({ omitDateTimeOriginal: true }));
    const date = await readPhotoDate(blob);
    expect(date).toBeNull();
  });

  it('returns null for PNG bytes (not a recognized format)', async () => {
    // PNG magic bytes
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const date = await readPhotoDate(new Blob([png], { type: 'image/png' }));
    expect(date).toBeNull();
  });

  it('returns null for empty file', async () => {
    const date = await readPhotoDate(new Blob([], { type: 'image/jpeg' }));
    expect(date).toBeNull();
  });

  it('returns null for truncated JPEG (SOI only)', async () => {
    const date = await readPhotoDate(
      new Blob([new Uint8Array([0xff, 0xd8])], { type: 'image/jpeg' })
    );
    expect(date).toBeNull();
  });

  it('returns null for garbage bytes', async () => {
    const garbage = new Uint8Array(64);
    for (let i = 0; i < garbage.length; i++) garbage[i] = (i * 37) & 0xff;
    const date = await readPhotoDate(new Blob([garbage]));
    expect(date).toBeNull();
  });

  it('handles a malformed DateTimeOriginal string (returns null)', async () => {
    // 19 chars of garbage that won't parse as YYYY:MM:DD HH:MM:SS
    const blob = buildBlob(buildExifJpeg({ dateTimeOriginal: 'xxxx:xx:xx xx:xx:xx' }));
    const date = await readPhotoDate(blob);
    expect(date).toBeNull();
  });
});

describe('readPhotoDate — HEIC', () => {
  // ISO BMFF box builder: 4-byte big-endian size, 4-byte type, then payload.
  // Note: HEIC box sizes count themselves (the 8-byte header).
  function box(type: string, payload: Uint8Array): Uint8Array {
    const size = 8 + payload.length;
    const out = new Uint8Array(size);
    out[0] = (size >> 24) & 0xff;
    out[1] = (size >> 16) & 0xff;
    out[2] = (size >> 8) & 0xff;
    out[3] = size & 0xff;
    out[4] = type.charCodeAt(0);
    out[5] = type.charCodeAt(1);
    out[6] = type.charCodeAt(2);
    out[7] = type.charCodeAt(3);
    out.set(payload, 8);
    return out;
  }

  function concat(...parts: Uint8Array[]): Uint8Array {
    let len = 0;
    for (const p of parts) len += p.length;
    const out = new Uint8Array(len);
    let off = 0;
    for (const p of parts) {
      out.set(p, off);
      off += p.length;
    }
    return out;
  }

  function buildHeic(opts: {
    dateTimeOriginal?: string;
    omitExifEntry?: boolean;
  }): Uint8Array {
    const dto = opts.dateTimeOriginal ?? '2026:05:10 11:00:00';

    // Build the same TIFF block as the JPEG fixture (little-endian, with DateTimeOriginal)
    const tiffJpeg = buildExifJpeg({ dateTimeOriginal: dto });
    // Extract just the TIFF block from the APP1 payload
    // SOI(2) + APP1 marker(2) + length(2) + "Exif\0\0"(6) = 12
    const tiffStart = 12;
    // APP1 length includes itself + payload; recover payload end:
    const app1Len = (tiffJpeg[4] << 8) | tiffJpeg[5];
    const tiffEnd = 4 + app1Len; // marker(2) + length-included
    const tiff = tiffJpeg.slice(tiffStart, tiffEnd);

    // ftyp box: major brand "heic", minor 0, compat brand "mif1"
    const ftyp = box(
      'ftyp',
      new Uint8Array([
        0x68, 0x65, 0x69, 0x63, // major brand "heic"
        0x00, 0x00, 0x00, 0x00, // minor version
        0x6d, 0x69, 0x66, 0x31 // compat brand "mif1"
      ])
    );

    // Build a minimal meta box with: iinf (containing one infe named "Exif")
    // and iloc (giving the extent for that item).
    //
    // meta box is a "full box" — 1 byte version + 3 bytes flags before children.
    // iinf is a full box too: version, flags, entry_count(2), then infe entries.
    // infe (version 2): version, flags, item_ID(2), item_protection_index(2),
    //   item_type(4 chars: "Exif"), item_name(null-terminated UTF-8).
    // iloc (version 1): version, flags, offset_size/length_size(1 byte),
    //   base_offset_size/index_size(1 byte), item_count(2),
    //   per item: item_ID(2), construction_method(2),
    //             data_reference_index(2), base_offset(0 bytes per our sizes),
    //             extent_count(2), extents.
    //
    // We use construction_method=0 (file offset), offset_size=4, length_size=4,
    // base_offset_size=0. Per extent: extent_offset(4) + extent_length(4).
    //
    // The actual EXIF item payload sits in an mdat-like region we append after
    // meta. Per the spec the item payload begins with a 4-byte ItemDataLength
    // prefix that names the TIFF block size — readPhotoDate must skip it.

    const itemId = 1;

    // Compose the EXIF item payload: 4-byte big-endian length prefix + TIFF
    const exifItem = new Uint8Array(4 + tiff.length);
    // The HEIF spec says this 4-byte prefix is itself zero for ItemDataBox or
    // an "ItemDataLength" big-endian uint32 for raw-name items. Use a name
    // length of zero (most common in iOS HEIC) for simplicity.
    exifItem.set(tiff, 4);

    // infe entry: version 2 + flags(3) + item_ID(2) + protection(2) + "Exif"(4)
    //  + item_name "Exif\0"
    const infeBody = new Uint8Array(
      1 + 3 + 2 + 2 + 4 + 5 // version + flags + id + prot + type + name (Exif\0)
    );
    let p = 0;
    infeBody[p++] = 2; // version
    infeBody[p++] = 0;
    infeBody[p++] = 0;
    infeBody[p++] = 0; // flags
    infeBody[p++] = (itemId >> 8) & 0xff;
    infeBody[p++] = itemId & 0xff; // item_ID
    infeBody[p++] = 0;
    infeBody[p++] = 0; // protection index
    if (opts.omitExifEntry) {
      // emit a non-Exif type so the parser walks past it and finds nothing
      infeBody[p++] = 0x6a; // 'j'
      infeBody[p++] = 0x70; // 'p'
      infeBody[p++] = 0x65; // 'e'
      infeBody[p++] = 0x67; // 'g'
    } else {
      infeBody[p++] = 0x45; // 'E'
      infeBody[p++] = 0x78; // 'x'
      infeBody[p++] = 0x69; // 'i'
      infeBody[p++] = 0x66; // 'f'
    }
    infeBody[p++] = 0x45; // 'E' (item name "Exif\0")
    infeBody[p++] = 0x78;
    infeBody[p++] = 0x69;
    infeBody[p++] = 0x66;
    // eslint-disable-next-line no-useless-assignment -- final pointer write completes the byte stream; the unused post-increment keeps the symmetric byte-writer style readable.
    infeBody[p++] = 0x00;

    const infe = box('infe', infeBody);

    // iinf body: version(1) + flags(3) + entry_count(2) + infe...
    const iinfBody = concat(
      new Uint8Array([0, 0, 0, 0, 0, 1]), // version 0, flags 0, count 1
      infe
    );
    const iinf = box('iinf', iinfBody);

    // iloc body. We need the iloc's extent_offset to point to the byte offset
    // where the EXIF item payload sits in the file. We place that payload
    // immediately after the meta box, so:
    //   extent_offset = (length of everything before the mdat region)
    //
    // We must build the rest of the boxes first to know the length.
    //
    // We assemble iloc with a placeholder, measure, then patch the offset.

    // iloc body shape (v1):
    //   version(1) + flags(3) + (offset_size<<4 | length_size)(1)
    //     + (base_offset_size<<4 | reserved/index_size)(1)
    //     + item_count(2)
    //     per item: item_ID(2) + reserved/construction_method(2) +
    //       data_reference_index(2) + base_offset(0 bytes) +
    //       extent_count(2) + per extent: extent_offset(4) + extent_length(4)
    const ilocItemId = itemId;
    const ilocBody = new Uint8Array(
      1 + 3 + 1 + 1 + 2 + 2 + 2 + 2 + 2 + 4 + 4
    );
    let q = 0;
    ilocBody[q++] = 1; // version 1
    ilocBody[q++] = 0;
    ilocBody[q++] = 0;
    ilocBody[q++] = 0; // flags
    ilocBody[q++] = (4 << 4) | 4; // offset_size=4 | length_size=4
    ilocBody[q++] = (0 << 4) | 0; // base_offset_size=0 | reserved
    ilocBody[q++] = 0;
    ilocBody[q++] = 1; // item_count = 1
    ilocBody[q++] = (ilocItemId >> 8) & 0xff;
    ilocBody[q++] = ilocItemId & 0xff;
    ilocBody[q++] = 0;
    ilocBody[q++] = 0; // construction_method = 0 (file offset)
    ilocBody[q++] = 0;
    ilocBody[q++] = 0; // data_reference_index
    // base_offset is 0 bytes (skip)
    ilocBody[q++] = 0;
    ilocBody[q++] = 1; // extent_count = 1
    // extent_offset placeholder — patched after total length is known
    const extentOffsetPos = q;
    ilocBody[q++] = 0;
    ilocBody[q++] = 0;
    ilocBody[q++] = 0;
    ilocBody[q++] = 0;
    // extent_length = exifItem.length
    const extentLen = exifItem.length;
    ilocBody[q++] = (extentLen >> 24) & 0xff;
    ilocBody[q++] = (extentLen >> 16) & 0xff;
    ilocBody[q++] = (extentLen >> 8) & 0xff;
    // eslint-disable-next-line no-useless-assignment -- final pointer write completes the byte stream; the unused post-increment keeps the symmetric byte-writer style readable.
    ilocBody[q++] = extentLen & 0xff;

    const iloc = box('iloc', ilocBody);

    // meta body: version(1) + flags(3) + hdlr (skip — many parsers don't require it),
    //   then iinf + iloc. We omit hdlr to keep the fixture minimal; our parser
    //   doesn't validate it.
    const metaHeader = new Uint8Array([0, 0, 0, 0]); // version 0, flags 0
    const metaBody = concat(metaHeader, iinf, iloc);
    const meta = box('meta', metaBody);

    // Compute the extent_offset = ftyp.length + meta.length
    const extentOffset = ftyp.length + meta.length;
    // Patch the placeholder inside ilocBody — but ilocBody is already inside
    // meta. We rebuild meta with the patched ilocBody.
    ilocBody[extentOffsetPos] = (extentOffset >> 24) & 0xff;
    ilocBody[extentOffsetPos + 1] = (extentOffset >> 16) & 0xff;
    ilocBody[extentOffsetPos + 2] = (extentOffset >> 8) & 0xff;
    ilocBody[extentOffsetPos + 3] = extentOffset & 0xff;
    const iloc2 = box('iloc', ilocBody);
    const meta2 = box('meta', concat(metaHeader, iinf, iloc2));

    return concat(ftyp, meta2, exifItem);
  }

  it('returns a Date for canonical HEIC with DateTimeOriginal', async () => {
    const blob = new Blob([buildHeic({ dateTimeOriginal: '2026:05:08 16:20:00' }) as BlobPart], {
      type: 'image/heic'
    });
    const date = await readPhotoDate(blob);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    expect(date!.getMonth()).toBe(4);
    expect(date!.getDate()).toBe(8);
  });

  it('returns null when HEIC has no Exif infe entry', async () => {
    const blob = new Blob([buildHeic({ omitExifEntry: true }) as BlobPart], {
      type: 'image/heic'
    });
    const date = await readPhotoDate(blob);
    expect(date).toBeNull();
  });
});

describe('readPhotoDate — read cap', () => {
  it('only reads at most the first ~128 KB of the file', async () => {
    const validPrefix = buildExifJpeg({ dateTimeOriginal: '2026:05:12 14:33:00' });
    // Append 8 MB of zeros. The parser must not try to read the full thing.
    const huge = new Uint8Array(8 * 1024 * 1024);
    huge.set(validPrefix, 0);

    let _arrayBufferCallCount = 0;
    const originalSlice = Blob.prototype.slice;
    const blob = new Blob([huge], { type: 'image/jpeg' });
    const spied = new Proxy(blob, {
      get(target, prop, receiver) {
        if (prop === 'arrayBuffer') {
          return async () => {
            _arrayBufferCallCount += 1;
            return target.arrayBuffer.call(target);
          };
        }
        if (prop === 'slice') {
          return function (this: Blob, ...args: unknown[]) {
            // Track slice sizes — they must be <= 128 KB
            const start = (args[0] as number) ?? 0;
            const end = (args[1] as number) ?? target.size;
            expect(end - start).toBeLessThanOrEqual(128 * 1024);
            // Call original to return a real Blob (don't re-trigger the proxy)
            return originalSlice.call(target, start, end);
          };
        }
        return Reflect.get(target, prop, receiver);
      }
    });
    const date = await readPhotoDate(spied as Blob);
    expect(date).not.toBeNull();
    expect(date!.getFullYear()).toBe(2026);
    // Don't assert arrayBuffer count: parser may call slice().arrayBuffer()
    // once, which is what we want. The slice-size assertion above is the
    // real cap check.
  });
});

// --- interpretPhotoDate tests -----------------------------------------------

describe('interpretPhotoDate', () => {
  it('returns missing cue when photoDate is null', () => {
    expect(interpretPhotoDate(null, '2026-05-15')).toEqual({ cue: 'missing' });
  });

  it('returns no-op (cue null) when photoDate equals today', () => {
    // Build a Date that, formatted via local components, is "2026-05-15"
    const today = new Date(2026, 4, 15, 12, 0, 0); // May is month 4 (0-indexed)
    expect(interpretPhotoDate(today, '2026-05-15')).toEqual({ cue: null });
  });

  it('returns set cue + ISO date when photoDate is older than today', () => {
    const older = new Date(2026, 4, 12, 9, 0, 0);
    expect(interpretPhotoDate(older, '2026-05-15')).toEqual({
      cue: 'set',
      newIsoDate: '2026-05-12'
    });
  });

  it('returns set cue + ISO date when photoDate is in the future (defensive)', () => {
    const future = new Date(2026, 5, 1, 9, 0, 0); // June 1
    expect(interpretPhotoDate(future, '2026-05-15')).toEqual({
      cue: 'set',
      newIsoDate: '2026-06-01'
    });
  });

  it('formats using local-time components (does not UTC-shift late-evening picks)', () => {
    // 11:55 PM local time on 2026-05-15. If a buggy implementation used
    // toISOString().slice(0,10), it would emit "2026-05-16" in any TZ east
    // of UTC. We assert the local date.
    const lateEvening = new Date(2026, 4, 15, 23, 55, 0);
    // todayIso is a different date so we get a "set" branch
    expect(interpretPhotoDate(lateEvening, '2026-05-14')).toEqual({
      cue: 'set',
      newIsoDate: '2026-05-15'
    });
  });

  it('handles single-digit months and days with zero-padding', () => {
    const d = new Date(2026, 0, 3, 12, 0, 0); // January 3
    expect(interpretPhotoDate(d, '2026-05-15')).toEqual({
      cue: 'set',
      newIsoDate: '2026-01-03'
    });
  });
});
