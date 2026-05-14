import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resizeForOcr } from './image';

interface CanvasCall {
  width: number;
  height: number;
  drawImage: { dx: number; dy: number; dw: number; dh: number } | null;
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
  drawImage(_img: unknown, dx: number, dy: number, dw: number, dh: number) {
    this.call.drawImage = { dx, dy, dw, dh };
  }
}

class FakeOffscreenCanvas {
  width: number;
  height: number;
  private readonly call: CanvasCall;
  constructor(w: number, h: number) {
    this.width = w;
    this.height = h;
    this.call = { width: w, height: h, drawImage: null, transformCalls: [] };
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
});
