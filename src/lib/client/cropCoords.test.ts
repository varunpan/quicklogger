import { describe, it, expect } from 'vitest';
import { displayToSource, sourceToDisplay, viewportToBase, clampZoom, clampPan, MAX_ZOOM } from './cropCoords';

describe('displayToSource', () => {
  it('rotation 0 is the identity', () => {
    // Display 800×600 image, user drew (200, 150)–(600, 450) → normalized (.25, .25, .5, .5).
    const out = displayToSource(
      { x: 200, y: 150, w: 400, h: 300 },
      { w: 800, h: 600 },
      0
    );
    expect(out).toEqual({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 });
  });

  it('rotation 90: rotates display rect back to source orientation', () => {
    // Display 600×800 (after 90° rotation of an 800×600 source).
    // User drew top-left quadrant of the rotated display.
    const out = displayToSource(
      { x: 0, y: 0, w: 300, h: 400 },
      { w: 600, h: 800 },
      90
    );
    // 90° clockwise display means source-top-right becomes display-top-left.
    // Display (x,y,w,h) in 600×800 maps back to source (0..1) as:
    //   source.x = display.y / display.h
    //   source.y = 1 - (display.x + display.w) / display.w
    //   source.w = display.h_norm
    //   source.h = display.w_norm
    expect(out.x).toBeCloseTo(0, 5);
    expect(out.y).toBeCloseTo(0.5, 5);
    expect(out.w).toBeCloseTo(0.5, 5);
    expect(out.h).toBeCloseTo(0.5, 5);
  });

  it('rotation 180: rect mirrors both axes', () => {
    const out = displayToSource(
      { x: 100, y: 100, w: 200, h: 100 },
      { w: 400, h: 300 },
      180
    );
    // Source x = 1 - (display.x + display.w) / display.w = 1 - 300/400 = 0.25
    // Source y = 1 - (display.y + display.h) / display.h = 1 - 200/300 = 1/3
    expect(out.x).toBeCloseTo(0.25, 5);
    expect(out.y).toBeCloseTo(0.3333333, 5);
    expect(out.w).toBeCloseTo(0.5, 5);
    expect(out.h).toBeCloseTo(0.3333333, 5);
  });

  it('rotation 270: dual of 90', () => {
    const out = displayToSource(
      { x: 0, y: 0, w: 300, h: 400 },
      { w: 600, h: 800 },
      270
    );
    // 270° (= -90°). Source mapping:
    //   source.x = 1 - (display.y + display.h) / display.h
    //   source.y = display.x / display.w
    //   source.w = display.h / display.h
    //   source.h = display.w / display.w
    expect(out.x).toBeCloseTo(0.5, 5);
    expect(out.y).toBeCloseTo(0, 5);
    expect(out.w).toBeCloseTo(0.5, 5);
    expect(out.h).toBeCloseTo(0.5, 5);
  });

  it('round-trip displayToSource → sourceToDisplay returns the original rect (rot 0)', () => {
    const display = { x: 50, y: 25, w: 200, h: 100 };
    const size = { w: 400, h: 300 };
    const norm = displayToSource(display, size, 0);
    const back = sourceToDisplay(norm, size, 0);
    expect(back.x).toBeCloseTo(50, 5);
    expect(back.y).toBeCloseTo(25, 5);
    expect(back.w).toBeCloseTo(200, 5);
    expect(back.h).toBeCloseTo(100, 5);
  });

  it('round-trip at rotation 90', () => {
    const display = { x: 30, y: 40, w: 150, h: 200 };
    const size = { w: 600, h: 800 };
    const norm = displayToSource(display, size, 90);
    const back = sourceToDisplay(norm, size, 90);
    expect(back.x).toBeCloseTo(30, 5);
    expect(back.y).toBeCloseTo(40, 5);
    expect(back.w).toBeCloseTo(150, 5);
    expect(back.h).toBeCloseTo(200, 5);
  });

  it('output stays inside [0, 1] for any rect that fits inside the display', () => {
    const out = displayToSource(
      { x: 0, y: 0, w: 800, h: 600 },
      { w: 800, h: 600 },
      0
    );
    expect(out).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe('viewportToBase', () => {
  it('is the identity at zoom=1, pan={0,0}', () => {
    const box = { x: 40, y: 30, w: 320, h: 240 };
    expect(viewportToBase(box, 1, { x: 0, y: 0 })).toEqual(box);
  });

  it('inverts a zoom=2, non-zero pan transform', () => {
    // screen = base·2 + pan, pan = (-100, -75).
    // box (40, 30, 320, 240) → base ((40+100)/2, (30+75)/2, 160, 120).
    const base = viewportToBase({ x: 40, y: 30, w: 320, h: 240 }, 2, { x: -100, y: -75 });
    expect(base.x).toBeCloseTo(70, 5);
    expect(base.y).toBeCloseTo(52.5, 5);
    expect(base.w).toBeCloseTo(160, 5);
    expect(base.h).toBeCloseTo(120, 5);
  });

  it('round-trips through displayToSource for every rotation', () => {
    // A zoomed/panned screen box, inverse-transformed to base, then mapped to
    // source, must equal mapping the un-zoomed base box directly. zoom enters
    // ONLY at viewportToBase; displayToSource is unchanged.
    const display = { w: 600, h: 800 };
    const baseBox = { x: 30, y: 40, w: 150, h: 200 };
    const zoom = 2.5;
    const pan = { x: -123, y: -77 };
    // Forward: place baseBox into screen space.
    const screenBox = {
      x: baseBox.x * zoom + pan.x,
      y: baseBox.y * zoom + pan.y,
      w: baseBox.w * zoom,
      h: baseBox.h * zoom
    };
    for (const rot of [0, 90, 180, 270] as const) {
      const viaZoom = displayToSource(viewportToBase(screenBox, zoom, pan), display, rot);
      const direct = displayToSource(baseBox, display, rot);
      expect(viaZoom.x).toBeCloseTo(direct.x, 5);
      expect(viaZoom.y).toBeCloseTo(direct.y, 5);
      expect(viaZoom.w).toBeCloseTo(direct.w, 5);
      expect(viaZoom.h).toBeCloseTo(direct.h, 5);
    }
  });
});

describe('clampZoom', () => {
  it('clamps to [1, MAX_ZOOM]', () => {
    expect(clampZoom(0.5)).toBe(1);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(3)).toBe(3);
    expect(clampZoom(MAX_ZOOM + 2)).toBe(MAX_ZOOM);
  });

  it('coerces non-finite to 1', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(MAX_ZOOM);
  });
});

describe('clampPan', () => {
  const vp = { w: 400, h: 300 };

  it('locks pan to (0,0) at zoom=1', () => {
    expect(clampPan({ x: 50, y: -40 }, 1, vp)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -999, y: 999 }, 1, vp)).toEqual({ x: 0, y: 0 });
  });

  it('keeps the image covering the viewport at zoom=2 (pan in [vp·(1-zoom), 0])', () => {
    // At zoom 2 the image is 800×600; pan.x ∈ [-400, 0], pan.y ∈ [-300, 0].
    expect(clampPan({ x: 100, y: 100 }, 2, vp)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -1000, y: -1000 }, 2, vp)).toEqual({ x: -400, y: -300 });
    expect(clampPan({ x: -150, y: -120 }, 2, vp)).toEqual({ x: -150, y: -120 });
  });

  it('coerces non-finite pan components to 0 before clamping', () => {
    expect(clampPan({ x: Number.NaN, y: -50 }, 2, vp)).toEqual({ x: 0, y: -50 });
  });
});
