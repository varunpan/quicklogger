import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import CropOverlay from './CropOverlay.svelte';

beforeEach(() => {
  // jsdom doesn't implement setPointerCapture / releasePointerCapture by
  // default — stub them so component handlers don't throw.
  (HTMLElement.prototype as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture =
    vi.fn();
  (HTMLElement.prototype as unknown as { releasePointerCapture: (id: number) => void }).releasePointerCapture =
    vi.fn();
});
afterEach(() => cleanup());

function makePointerEvent(type: string, x: number, y: number, pointerId = 1) {
  const ev = new Event(type, { bubbles: true }) as Event & {
    clientX: number; clientY: number; pointerId: number; pointerType: string;
  };
  ev.clientX = x;
  ev.clientY = y;
  ev.pointerId = pointerId;
  ev.pointerType = 'touch';
  return ev;
}

// Default mocked display rect — 400×300 image starting at viewport (0, 0).
// All getBoundingClientRect mocks below honor this size.
function mountWith(
  props: Partial<{
    imageDisplayRect: { x: number; y: number; w: number; h: number };
    initial: { x: number; y: number; w: number; h: number };
    floorSourcePx: number;
    sourceSize: { w: number; h: number };
    oncommit: (rect: { x: number; y: number; w: number; h: number }) => void;
    oncancel: () => void;
  }> = {}
) {
  const oncommit = (props.oncommit ?? vi.fn()) as Mock;
  const oncancel = (props.oncancel ?? vi.fn()) as Mock;
  const rendered = render(CropOverlay, {
    props: {
      imageDisplayRect: props.imageDisplayRect ?? { x: 0, y: 0, w: 400, h: 300 },
      initial: props.initial ?? { x: 40, y: 30, w: 320, h: 240 },
      floorSourcePx: props.floorSourcePx ?? 200,
      sourceSize: props.sourceSize ?? { w: 2000, h: 1500 },
      oncommit,
      oncancel
    }
  });
  return { ...rendered, oncommit, oncancel };
}

describe('CropOverlay', () => {
  it('renders 4 corner handles + 4 edge handles', () => {
    const { container } = mountWith();
    expect(container.querySelectorAll('[data-handle="corner"]').length).toBe(4);
    expect(container.querySelectorAll('[data-handle="edge"]').length).toBe(4);
  });

  it('renders the dimmed shroud and rule-of-thirds grid', () => {
    const { container } = mountWith();
    expect(container.querySelectorAll('[data-shroud]').length).toBe(4);
    expect(container.querySelectorAll('[data-grid-line]').length).toBe(4);
  });

  it('pointerdown on a corner handle + pointermove + pointerup commits a resized rect', async () => {
    const { container, oncommit } = mountWith();
    const tlCorner = container.querySelector('[data-handle="corner"][data-corner="tl"]') as HTMLElement;
    // Drag top-left corner from (40, 30) to (100, 80) → rect (100, 80, 260, 190).
    await fireEvent(tlCorner, makePointerEvent('pointerdown', 40, 30));
    await fireEvent(tlCorner, makePointerEvent('pointermove', 100, 80));
    const doneBtn = container.querySelector('[data-action="done"]') as HTMLElement;
    await fireEvent.click(doneBtn);
    expect(oncommit).toHaveBeenCalledTimes(1);
    const rect = oncommit.mock.calls[0][0];
    expect(rect.x).toBe(100);
    expect(rect.y).toBe(80);
    expect(rect.w).toBe(260);
    expect(rect.h).toBe(190);
  });

  it('pointerdown on interior + pointermove translates the rect (size preserved)', async () => {
    const { container, oncommit } = mountWith();
    const interior = container.querySelector('[data-handle="interior"]') as HTMLElement;
    // Drag from (200, 150) by (+30, +20).
    await fireEvent(interior, makePointerEvent('pointerdown', 200, 150));
    await fireEvent(interior, makePointerEvent('pointermove', 230, 170));
    const doneBtn = container.querySelector('[data-action="done"]') as HTMLElement;
    await fireEvent.click(doneBtn);
    const rect = oncommit.mock.calls[0][0];
    expect(rect.x).toBe(70);   // 40 + 30
    expect(rect.y).toBe(50);   // 30 + 20
    expect(rect.w).toBe(320);  // unchanged
    expect(rect.h).toBe(240);  // unchanged
  });

  it('clamps the rect so it stays inside imageDisplayRect (interior drag)', async () => {
    const { container, oncommit } = mountWith();
    const interior = container.querySelector('[data-handle="interior"]') as HTMLElement;
    // Drag far beyond the right edge — should clamp at x = 400 - 320 = 80.
    await fireEvent(interior, makePointerEvent('pointerdown', 200, 150));
    await fireEvent(interior, makePointerEvent('pointermove', 999, 150));
    const doneBtn = container.querySelector('[data-action="done"]') as HTMLElement;
    await fireEvent.click(doneBtn);
    const rect = oncommit.mock.calls[0][0];
    expect(rect.x).toBe(80);  // clamped — image extends 0..400, rect width 320
  });

  it('refuses to shrink below the 200 source-px floor on the shortest edge', async () => {
    // Display 400×300 = source 2000×1500 → scale 5. 200 source px = 40 display px.
    const { container, oncommit } = mountWith();
    const brCorner = container.querySelector('[data-handle="corner"][data-corner="br"]') as HTMLElement;
    // Try to drag bottom-right toward top-left, way past the floor.
    await fireEvent(brCorner, makePointerEvent('pointerdown', 360, 270));
    await fireEvent(brCorner, makePointerEvent('pointermove', 50, 40));
    const doneBtn = container.querySelector('[data-action="done"]') as HTMLElement;
    await fireEvent.click(doneBtn);
    const rect = oncommit.mock.calls[0][0];
    // Floor = 40 display px on each side; starting top-left was (40, 30), so
    // the bottom-right floor lands at (80, 70) → width 40, height 40.
    expect(rect.w).toBeGreaterThanOrEqual(40);
    expect(rect.h).toBeGreaterThanOrEqual(40);
  });

  it('Reset button resets the rect to the initial centered ~80% default', async () => {
    const { container, oncommit } = mountWith();
    const interior = container.querySelector('[data-handle="interior"]') as HTMLElement;
    // Move the rect first.
    await fireEvent(interior, makePointerEvent('pointerdown', 200, 150));
    await fireEvent(interior, makePointerEvent('pointermove', 220, 170));
    const resetBtn = container.querySelector('[data-action="reset"]') as HTMLElement;
    await fireEvent.click(resetBtn);
    const doneBtn = container.querySelector('[data-action="done"]') as HTMLElement;
    await fireEvent.click(doneBtn);
    const rect = oncommit.mock.calls[0][0];
    // Centered 80% of 400×300 → 320×240 starting at (40, 30).
    expect(rect.x).toBe(40);
    expect(rect.y).toBe(30);
    expect(rect.w).toBe(320);
    expect(rect.h).toBe(240);
  });

  it('Cancel button fires oncancel; oncommit not called', async () => {
    const { container, oncommit, oncancel } = mountWith();
    const cancelBtn = container.querySelector('[data-action="cancel"]') as HTMLElement;
    await fireEvent.click(cancelBtn);
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(oncommit).not.toHaveBeenCalled();
  });

  it('keeps every handle fully inside imageDisplayRect when the rect is flush against the image bounds', () => {
    // Rect fills the entire 400×300 image — every handle would straddle a
    // boundary if positions weren't clamped, ending up outside the overlay's
    // box where the host modal's overflow-hidden makes them unreachable.
    const { container } = mountWith({
      initial: { x: 0, y: 0, w: 400, h: 300 }
    });

    const imgW = 400;
    const imgH = 300;
    const CORNER = 14;
    const EDGE_LONG = 14;
    const EDGE_SHORT = 4;

    const px = (el: HTMLElement, key: 'left' | 'top') =>
      parseFloat(el.style[key]);

    for (const el of container.querySelectorAll<HTMLElement>('[data-handle="corner"]')) {
      const left = px(el, 'left');
      const top = px(el, 'top');
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(imgW - CORNER);
      expect(top).toBeLessThanOrEqual(imgH - CORNER);
    }

    for (const el of container.querySelectorAll<HTMLElement>('[data-handle="edge"]')) {
      const left = px(el, 'left');
      const top = px(el, 'top');
      const edge = el.getAttribute('data-edge');
      const isVertical = edge === 'l' || edge === 'r';
      const w = isVertical ? EDGE_SHORT : EDGE_LONG;
      const h = isVertical ? EDGE_LONG : EDGE_SHORT;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(left).toBeLessThanOrEqual(imgW - w);
      expect(top).toBeLessThanOrEqual(imgH - h);
    }
  });
});
