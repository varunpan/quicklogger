// @vitest-environment node
// Server route handler exercises Node-native fetch/FormData/File/Request
// (via SvelteKit's RequestEvent). jsdom installs its own File/FormData that
// undici's `request.formData()` refuses (USVString/File assertion). Opt out
// of jsdom for this file so the FormData round-trip uses undici end-to-end.
import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST, _resetForTests } from './+server';
import { _resetChainMemoForTests } from '$lib/server/ocr';

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
  _resetChainMemoForTests();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  rmSync(tmpDir, { recursive: true, force: true });
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

const noopLogger = {
  debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
  child() { return this; }
} as unknown as import('$lib/server/logger').Logger;

function makeRequest(form: FormData, ip = '127.0.0.1'): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://localhost/api/ocr', { method: 'POST', body: form }),
    getClientAddress: () => ip,
    locals: { logger: noopLogger, requestId: 't' }
  } as unknown as Parameters<typeof POST>[0];
}

function makeGetEvent(): Parameters<typeof GET>[0] {
  return {
    locals: { logger: noopLogger, requestId: 't' }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/ocr', () => {
  it('returns enabled=false (no modes) when no provider configured', async () => {
    const res = await GET(makeGetEvent());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ enabled: false });
  });

  it('returns enabled=true with pump+odometer modes when ollama is set', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://o' });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.modes.sort()).toEqual(['odometer', 'pump']);
  });

  it('returns chainTimeoutMs alongside enabled=true (1-slot chain)', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://o' });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.chainTimeoutMs).toBe(60_000);
  });

  it('returns chainTimeoutMs as the sum across configured slots', async () => {
    setEnv({
      OLLAMA_VISION_URL: 'http://o',
      OPENROUTER_API_KEY: 'sk',
      OLLAMA_CLOUD_API_KEY: 'sk-c'
    });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.chainTimeoutMs).toBe(60_000 + 30_000 + 30_000);
  });

  it('returns enabled=true with chainTimeoutMs when only OLLAMA_CLOUD_API_KEY is set', async () => {
    setEnv({ OLLAMA_CLOUD_API_KEY: 'sk-cloud' });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.modes.sort()).toEqual(['odometer', 'pump']);
    expect(body.chainTimeoutMs).toBe(30_000);
  });

  it('returns enabled=true when only OPENAI_COMPATIBLE_* are all set', async () => {
    setEnv({
      OPENAI_COMPATIBLE_URL: 'https://api.groq.com/openai/v1/chat/completions',
      OPENAI_COMPATIBLE_API_KEY: 'gsk-test',
      OPENAI_COMPATIBLE_MODEL: 'llama-3.2-90b-vision-preview'
    });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.enabled).toBe(true);
    expect(body.chainTimeoutMs).toBe(30_000);
  });

  it('returns enabled=false when OPENAI_COMPATIBLE_URL/KEY/MODEL are partially set', async () => {
    setEnv({
      OPENAI_COMPATIBLE_URL: 'https://api.groq.com/openai/v1/chat/completions',
      OPENAI_COMPATIBLE_API_KEY: 'gsk-test'
      // OPENAI_COMPATIBLE_MODEL deliberately missing
    });
    const res = await GET(makeGetEvent());
    const body = await res.json();
    expect(body.enabled).toBe(false);
  });

  it('routes selectProvider logs through locals.logger (not console)', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://o', OLLAMA_CLOUD_API_KEY: 'sk-c' });
    const infos: Array<{ msg: string; ctx?: Record<string, unknown> }> = [];
    const capturing = {
      ...noopLogger,
      info: (msg: string, ctx?: Record<string, unknown>) => infos.push({ msg, ctx })
    } as unknown as import('$lib/server/logger').Logger;
    const event = {
      locals: { logger: capturing, requestId: 't' }
    } as unknown as Parameters<typeof GET>[0];
    await GET(event);
    const chain = infos.find((m) => m.msg === 'ocr chain effective');
    expect(chain).toBeDefined();
    expect(chain?.ctx?.providers).toEqual(['ollama-local', 'ollama-cloud']);
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

  it('records cropApplied=true and cropRect when all four crop fields are valid', async () => {
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
    fd.set('cropX', '0.1');
    fd.set('cropY', '0.2');
    fd.set('cropW', '0.6');
    fd.set('cropH', '0.4');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    // Audit row reflects the crop fields.
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.cropApplied).toBe(true);
    expect(row.cropRect).toEqual({ x: 0.1, y: 0.2, w: 0.6, h: 0.4 });
  });

  it('records cropApplied=false when only three crop fields are present', async () => {
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
    fd.set('cropX', '0.1');
    fd.set('cropY', '0.2');
    fd.set('cropW', '0.6');
    // cropH missing
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.cropApplied).toBe(false);
    expect(row.cropRect).toBeNull();
  });

  it('records cropApplied=false when crop fields are out of range (x + w > 1)', async () => {
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
    fd.set('cropX', '0.8');
    fd.set('cropY', '0.1');
    fd.set('cropW', '0.5');  // 0.8 + 0.5 = 1.3 — invalid
    fd.set('cropH', '0.2');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.cropApplied).toBe(false);
  });

  it('records cropApplied=false on old-shape request (no crop fields at all)', async () => {
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
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.cropApplied).toBe(false);
    expect(row.cropRect).toBeNull();
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

  it('records lastOdometerMi in the audit row when a positive number is sent', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({ message: { content: '{"odometer":111120}' } })
      )
    );
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'odometer');
    fd.set('lastOdometerMi', '111074');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.lastOdometerMi).toBe(111074);
  });

  it('omits lastOdometerMi from the audit row on a garbage value', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({ message: { content: '{"odometer":87432}' } })
      )
    );
    for (const bad of ['', 'banana', 'NaN', 'Infinity', '0', '-100']) {
      const fd = new FormData();
      fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
      fd.set('mode', 'odometer');
      fd.set('lastOdometerMi', bad);
      const res = await POST(makeRequest(fd));
      expect(res.status).toBe(200);
      const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
      const row = JSON.parse(auditLine);
      expect(row.lastOdometerMi).toBeUndefined();
    }
  });

  it('omits lastOdometerMi from the audit row when not sent (old-shape request)', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({ message: { content: '{"odometer":87432}' } })
      )
    );
    const fd = new FormData();
    fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
    fd.set('mode', 'odometer');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.lastOdometerMi).toBeUndefined();
  });

  it('records lastPricePerUnit in the audit row when a positive number is sent', async () => {
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
    fd.set('lastPricePerUnit', '3.679');
    const res = await POST(makeRequest(fd));
    expect(res.status).toBe(200);
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.lastPricePerUnit).toBe(3.679);
  });

  it('omits lastPricePerUnit from the audit row on a garbage value', async () => {
    setEnv({ OLLAMA_VISION_URL: 'http://ollama:11434' });
    ollamaServer.use(
      http.post('http://ollama:11434/api/chat', () =>
        HttpResponse.json({
          message: { content: '{"volume":11.2,"volumeUnit":"gal","cost":42.18,"pricePerUnit":3.78}' }
        })
      )
    );
    for (const bad of ['', 'banana', 'NaN', 'Infinity', '0', '-2.5']) {
      const fd = new FormData();
      fd.set('image', new File([JPEG], 'p.jpg', { type: 'image/jpeg' }));
      fd.set('mode', 'pump');
      fd.set('lastPricePerUnit', bad);
      const res = await POST(makeRequest(fd));
      expect(res.status).toBe(200);
      const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
      const row = JSON.parse(auditLine);
      expect(row.lastPricePerUnit).toBeUndefined();
    }
  });

  it('omits lastPricePerUnit from the audit row when not sent (old-shape request)', async () => {
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
    const auditLine = readFileSync(process.env.OCR_AUDIT_PATH!, 'utf-8').trim().split('\n').pop()!;
    const row = JSON.parse(auditLine);
    expect(row.lastPricePerUnit).toBeUndefined();
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
