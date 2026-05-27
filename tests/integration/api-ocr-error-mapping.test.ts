import { describe, it, expect } from 'vitest';
import { postOcr, type OcrError } from '../../src/lib/client/api';

// `postOcr` packs the server's response into a thrown OcrError. The 400 path
// additionally parses the JSON body and surfaces `body.error` on
// `OcrError.serverError`, so the client toast can show the specific reason
// (e.g., "empty image", "multipart parse failed") instead of just the status.
//
// Reproduces an opaque 400 that an iOS Safari user hit during UAT — the toast
// previously said "OCR failed (400)" because 400 fell through to the generic
// fallback at +page.svelte. With `serverError` populated, the toast now reads
// "OCR rejected photo: multipart parse failed".

function stubFetch(response: Response) {
  return async () => response;
}

const blob = new Blob(['x'], { type: 'image/jpeg' });

describe('postOcr — error mapping', () => {
  it('400 with JSON error body populates OcrError.serverError', async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ error: 'multipart parse failed' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );

    try {
      await postOcr(blob, 'pump', 0, null, undefined, undefined, undefined, fetchStub);
      throw new Error('postOcr should have thrown');
    } catch (e) {
      const err = e as OcrError;
      expect(err.status).toBe(400);
      expect(err.serverError).toBe('multipart parse failed');
    }
  });

  it('400 with non-JSON body (e.g., proxy HTML page) leaves serverError undefined and does not crash', async () => {
    const fetchStub = stubFetch(
      new Response('<html>502 Bad Gateway</html>', {
        status: 400,
        headers: { 'content-type': 'text/html' }
      })
    );

    try {
      await postOcr(blob, 'pump', 0, null, undefined, undefined, undefined, fetchStub);
      throw new Error('postOcr should have thrown');
    } catch (e) {
      const err = e as OcrError;
      expect(err.status).toBe(400);
      expect(err.serverError).toBeUndefined();
    }
  });

  it('400 with JSON body lacking an `error` field leaves serverError undefined', async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ other: 'shape' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      })
    );

    try {
      await postOcr(blob, 'pump', 0, null, undefined, undefined, undefined, fetchStub);
      throw new Error('postOcr should have thrown');
    } catch (e) {
      const err = e as OcrError;
      expect(err.status).toBe(400);
      expect(err.serverError).toBeUndefined();
    }
  });

  it('429 still attaches retryAfter (sanity: 400 branch did not break existing mapping)', async () => {
    const fetchStub = stubFetch(
      new Response(JSON.stringify({ error: 'rate limit reached', retryAfter: 42 }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '42' }
      })
    );

    try {
      await postOcr(blob, 'pump', 0, null, undefined, undefined, undefined, fetchStub);
      throw new Error('postOcr should have thrown');
    } catch (e) {
      const err = e as OcrError;
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBe(42);
      expect(err.serverError).toBeUndefined();
    }
  });
});
