// @vitest-environment node
// Server route handler exercises Node-native fetch/FormData/File/Request
// (via SvelteKit's RequestEvent). jsdom installs its own File/FormData that
// undici's `request.formData()` refuses (USVString/File assertion). Opt out
// of jsdom for this file so the FormData round-trip uses undici end-to-end.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST, _resetForTests } from './+server';

const ollamaServer = setupServer();
beforeAll(() => ollamaServer.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => { ollamaServer.resetHandlers(); _resetForTests(); });
afterAll(() => ollamaServer.close());

const ORIGINAL = { ...process.env };
let tmpDir: string;

function setEnv(o: Record<string, string | undefined>) {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('OLLAMA_') || k.startsWith('OPENROUTER_') || k.startsWith('OCR_')) {
      delete process.env[k];
    }
  }
  process.env.LUBELOGGER_URL = 'http://lubelog';
  process.env.LUBELOGGER_API_KEY = 'k';
  process.env.OCR_BUDGET_PATH = join(tmpDir, 'budget.json');
  process.env.OCR_AUDIT_PATH = join(tmpDir, 'audit.jsonl');
  process.env.OCR_AUDIT_KEY_PATH = join(tmpDir, 'key.txt');
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ocr-route-'));
  setEnv({});
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  rmSync(tmpDir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

function makeRequest(form: FormData, ip = '127.0.0.1'): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://localhost/api/ocr', { method: 'POST', body: form }),
    getClientAddress: () => ip
  } as unknown as Parameters<typeof POST>[0];
}

describe('GET /api/ocr', () => {
  it('returns enabled=false (no modes) when no provider configured', async () => {
    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('returns enabled=true with pump+odometer modes when ollama is set', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://o' });
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.modes.sort()).toEqual(['odometer', 'pump']);
  });

  it('does not advertise receipt mode in v0.2.0', async () => {
    setEnv({ OPENROUTER_API_KEY: 'sk' });
    const res = await GET({} as Parameters<typeof GET>[0]);
    const body = await res.json();
    expect(body.modes).not.toContain('receipt');
  });
});

describe('POST /api/ocr', () => {
  it('503 when no provider is configured', async () => {
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'pump');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(503);
  });

  it('400 when mode is missing', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(400);
  });

  it('400 on unknown mode', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'banana');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(400);
  });

  it('501 on mode=receipt (reserved)', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'receipt');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(501);
  });

  it('415 on non-image bytes', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    const fd = new FormData();
    fd.set('image', new File([Buffer.from('plain text not an image')], 'p.txt', { type: 'text/plain' }));
    fd.set('mode', 'pump');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(415);
  });

  it('413 on image > 5 MiB', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    const big = Buffer.alloc(5 * 1024 * 1024 + 10, 0);
    big[0] = 0xff; big[1] = 0xd8; big[2] = 0xff; big[3] = 0xe0;
    const fd = new FormData();
    fd.set('image', new File([big], 'big.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'pump');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(413);
  });

  it('pump happy path returns discriminated result', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({
          message: { content: '{"volume":11.2,"volumeUnit":"gal","cost":42.18,"pricePerUnit":3.78}' }
        })
      )
    );
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'pump');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: 'pump', volume: 11.2, cost: 42.18 });
  });

  it('odometer happy path returns discriminated result', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({ message: { content: '{"odometer":87612}' } })
      )
    );
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'odometer');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ mode: 'odometer', odometer: 87612 });
  });

  it('429 with Retry-After after rate-limit cap', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434', OCR_RATE_LIMIT_PER_HOUR: '1' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({
          message: { content: '{"volume":11.2,"volumeUnit":"gal","cost":42.18,"pricePerUnit":3.78}' }
        })
      )
    );
    const fd1 = new FormData();
    fd1.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd1.set('mode', 'pump');
    expect((await POST(makeRequest(fd1))).status).toBe(200);

    const fd2 = new FormData();
    fd2.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd2.set('mode', 'pump');
    const r2 = await POST(makeRequest(fd2));
    expect(r2.status).toBe(429);
    expect(r2.headers.get('retry-after')).toMatch(/^\d+$/);
  });
});
