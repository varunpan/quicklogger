import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/svelte';
import { fireEvent } from '@testing-library/dom';
import OcrPreview from './OcrPreview.svelte';

const createObjectURL = vi.fn((_b: Blob) => 'blob:fake-url');
const revokeObjectURL = vi.fn((_u: string) => undefined);

beforeEach(() => {
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL,
    revokeObjectURL
  });
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeFile(): File {
  return new File(['fake-jpeg-bytes'], 'capture.jpg', { type: 'image/jpeg' });
}

describe('OcrPreview', () => {
  it('renders the mode label in the header', () => {
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel: vi.fn(), onretake: vi.fn() }
    });
    expect(screen.getByText(/Preview/i)).toBeInTheDocument();
    expect(screen.getByText(/Pump display/i)).toBeInTheDocument();
  });

  it('renders the image with the object URL as src', () => {
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'odometer', onsubmit: vi.fn(), oncancel: vi.fn(), onretake: vi.fn() }
    });
    const img = screen.getByAltText(/Captured/i) as HTMLImageElement;
    expect(img.src).toContain('blob:fake-url');
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('rotation cycles 0 → 90 → 180 → 270 → 0 on right-rotate taps', async () => {
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel: vi.fn(), onretake: vi.fn() }
    });
    const img = screen.getByAltText(/Captured/i) as HTMLImageElement;
    const rotateRight = screen.getByRole('button', { name: /Rotate right/i });
    expect(img.style.transform).toBe('rotate(0deg)');
    await fireEvent.click(rotateRight);
    expect(img.style.transform).toBe('rotate(90deg)');
    await fireEvent.click(rotateRight);
    expect(img.style.transform).toBe('rotate(180deg)');
    await fireEvent.click(rotateRight);
    expect(img.style.transform).toBe('rotate(270deg)');
    await fireEvent.click(rotateRight);
    expect(img.style.transform).toBe('rotate(0deg)');
  });

  it('rotation cycles backwards on left-rotate taps', async () => {
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel: vi.fn(), onretake: vi.fn() }
    });
    const img = screen.getByAltText(/Captured/i) as HTMLImageElement;
    const rotateLeft = screen.getByRole('button', { name: /Rotate left/i });
    await fireEvent.click(rotateLeft);
    expect(img.style.transform).toBe('rotate(270deg)');
    await fireEvent.click(rotateLeft);
    expect(img.style.transform).toBe('rotate(180deg)');
  });

  it('Send for OCR fires onsubmit with the current rotation', async () => {
    const onsubmit = vi.fn();
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit, oncancel: vi.fn(), onretake: vi.fn() }
    });
    await fireEvent.click(screen.getByRole('button', { name: /Rotate right/i }));
    await fireEvent.click(screen.getByRole('button', { name: /Send for OCR/i }));
    expect(onsubmit).toHaveBeenCalledTimes(1);
    expect(onsubmit).toHaveBeenCalledWith({ rotation: 90 });
  });

  it('Cancel fires oncancel; OCR not invoked', async () => {
    const onsubmit = vi.fn();
    const oncancel = vi.fn();
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit, oncancel, onretake: vi.fn() }
    });
    await fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
    expect(oncancel).toHaveBeenCalledTimes(1);
    expect(onsubmit).not.toHaveBeenCalled();
  });

  it('Retake fires onretake', async () => {
    const onretake = vi.fn();
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel: vi.fn(), onretake }
    });
    await fireEvent.click(screen.getByRole('button', { name: /^Retake$/i }));
    expect(onretake).toHaveBeenCalledTimes(1);
  });

  it('ESC key fires oncancel', async () => {
    const oncancel = vi.fn();
    const file = makeFile();
    render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel, onretake: vi.fn() }
    });
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(oncancel).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL on unmount', () => {
    const file = makeFile();
    const { unmount } = render(OcrPreview, {
      props: { file, mode: 'pump', onsubmit: vi.fn(), oncancel: vi.fn(), onretake: vi.fn() }
    });
    expect(revokeObjectURL).not.toHaveBeenCalled();
    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:fake-url');
  });
});
