import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resizeForOcr } from './image';

interface CanvasCall {
  width: number;
  height: number;
  drawImage: {
    sx: number; sy: number; sw: number; sh: number;
    dx: number; dy: number; dw: number; dh: number;
  } | null;
  drawImageCalls: number;
  transformCalls: Array<{ kind: 'translate' | 'rotate'; args: number[] }>;
}

let canvasCalls: CanvasCall[];

class FakeCtx {
  constructor(private readonly call: CanvasCall) {}
  translate(x: number, y: number) {
    this.call.transformCalls.push({ kind: 'translate', args: [x, y] });
  }
  rotate(rad: number) {
    this.call.transformCalls.push({ kind: 'rotate', args: [rad] });
  }
  // Accept both 5-arg and 9-arg forms; record source rect for both.
  drawImage(_img: unknown, ...args: number[]) {
    this.call.drawImageCalls += 1;
    if (args.length === 4) {
      this.call.drawImage = {
        sx: 0, sy: 0, sw: 0, sh: 0,
        dx: args[0], dy: args[1], dw: args[2], dh: args[3]
      };
    } else if (args.length === 8) {
      this.call.drawImage = {
        sx: args[0], sy: args[1], sw: args[2], sh: args[3],
        dx: args[4], dy: args[5], dw: args[6], dh: args[7]
      };
    } else {
      throw new Error(`unexpected drawImage arity: ${args.length}`);
    }
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private readonly call: CanvasCall;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.call = { width: w, height: h, drawImage: null, drawImageCalls: 0, transformCalls: [] };
    canvasCalls.push(this.call);
  }
  getContext(kind: string) {
    if (kind !== '2d') return null;
    return new FakeCtx(this.call);
  }
  async convertToBlob(_opts: { type: string; quality: number }) {
    return new Blob(['x'], { type: 'image/jpeg' });
  }
}

interface FakeBitmap {
  width: number;
  height: number;
  close(): void;
}

function fakeBitmap(width: number, height: number): FakeBitmap {
  return { width, height, close() {} };
}

beforeEach(() => {
  canvasCalls = [];
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => fakeBitmap(2000, 1000))
  );
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('resizeForOcr', () => {
  it('rotation 0 — canvas dimensions match scaled bitmap (no transpose)', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    const blob = await resizeForOcr(file, { rotation: 0 });
    expect(blob.type).toBe('image/jpeg');
    expect(canvasCalls).toHaveLength(1);
    // 2000×1000, long edge clamp to 1024 → scale = 0.512 → 1024×512
    expect(canvasCalls[0].width).toBe(1024);
    expect(canvasCalls[0].height).toBe(512);
  });

  it('rotation 90 — canvas dimensions transpose (height ↔ width)', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 90 });
    expect(canvasCalls).toHaveLength(1);
    // After 90° rotation, output is 512×1024 (was 1024×512 unrotated).
    expect(canvasCalls[0].width).toBe(512);
    expect(canvasCalls[0].height).toBe(1024);
  });

  it('rotation 180 — canvas dimensions match unrotated', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 180 });
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0].width).toBe(1024);
    expect(canvasCalls[0].height).toBe(512);
  });

  it('rotation 270 — canvas dimensions transpose (height ↔ width)', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 270 });
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0].width).toBe(512);
    expect(canvasCalls[0].height).toBe(1024);
  });

  it('omitted rotation defaults to 0 — same as explicit 0', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file);
    expect(canvasCalls[0].width).toBe(1024);
    expect(canvasCalls[0].height).toBe(512);
  });

  it('rotation 90 issues a translate+rotate transform before drawImage', async () => {
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 90 });
    const t = canvasCalls[0].transformCalls;
    // Single canvas pass: orient → rotate → resize → encode.
    // For 90°, expect translate(width, 0) + rotate(π/2), or equivalent
    // sequence that lands the rotated image in a 512×1024 canvas.
    expect(t.length).toBeGreaterThanOrEqual(2);
    expect(t.some((c) => c.kind === 'rotate')).toBe(true);
    expect(canvasCalls[0].drawImage).not.toBeNull();
  });

  it('crop centered: produces a canvas sized to the cropped region (no resize when under 1024 long edge)', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1500)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    // Cropped region = 1000×750. Long edge ≤ 1024 → no resize. Canvas = 1000×750.
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0].width).toBe(1000);
    expect(canvasCalls[0].height).toBe(750);
    expect(canvasCalls[0].drawImage).toEqual({
      sx: 500, sy: 375, sw: 1000, sh: 750,
      dx: 0, dy: 0, dw: 1000, dh: 750
    });
  });

  it('crop combined with rotation 90: canvas transposes around the cropped region', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1500)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 90, crop: { x: 0, y: 0, w: 1, h: 0.5 } });
    // Cropped region = 2000×750 (full width, top half). Long edge 2000 → scale 0.512
    // → 1024×384 base, then transpose for 90° → canvas 384×1024.
    expect(canvasCalls).toHaveLength(1);
    expect(canvasCalls[0].width).toBe(384);
    expect(canvasCalls[0].height).toBe(1024);
    expect(canvasCalls[0].drawImage).not.toBeNull();
    expect(canvasCalls[0].drawImage?.sx).toBe(0);
    expect(canvasCalls[0].drawImage?.sy).toBe(0);
    expect(canvasCalls[0].drawImage?.sw).toBe(2000);
    expect(canvasCalls[0].drawImage?.sh).toBe(750);
  });

  it('crop = null behaves identically to no crop key', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1000)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { crop: null });
    expect(canvasCalls[0].width).toBe(1024);
    expect(canvasCalls[0].height).toBe(512);
    // Full-image draw — source rect is the whole bitmap.
    expect(canvasCalls[0].drawImage?.sx).toBe(0);
    expect(canvasCalls[0].drawImage?.sy).toBe(0);
    expect(canvasCalls[0].drawImage?.sw).toBe(2000);
    expect(canvasCalls[0].drawImage?.sh).toBe(1000);
  });

  it('defensive: crop with x + w > 1 falls back to full image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1500)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { crop: { x: 0.6, y: 0.1, w: 0.5, h: 0.2 } });
    // Falls back to full → 2000×1500 → 1024×768.
    expect(canvasCalls[0].width).toBe(1024);
    expect(canvasCalls[0].height).toBe(768);
    expect(canvasCalls[0].drawImage?.sw).toBe(2000);
  });

  it('defensive: crop with zero width falls back to full image', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1500)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { crop: { x: 0.1, y: 0.1, w: 0, h: 0.5 } });
    expect(canvasCalls[0].drawImage?.sw).toBe(2000);
  });

  it('single canvas pass: drawImage called exactly once even with crop + rotation', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => fakeBitmap(2000, 1500)));
    const file = new File(['a'], 'a.jpg', { type: 'image/jpeg' });
    await resizeForOcr(file, { rotation: 270, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    expect(canvasCalls[0].drawImageCalls).toBe(1);
  });
});
