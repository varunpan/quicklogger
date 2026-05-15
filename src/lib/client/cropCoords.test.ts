import { describe, it, expect } from 'vitest';
import { displayToSource, sourceToDisplay } from './cropCoords';

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
