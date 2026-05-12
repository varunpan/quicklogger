import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OcrAudit, hashIp, hashImage, resolveAuditHmacKey, type AuditRecord } from './ocrAudit';

const TEST_KEY = Buffer.from('secret-key-for-testing-only-bytes', 'utf-8');

function pumpRecord(extra: Partial<AuditRecord> = {}): AuditRecord {
  return {
    mode: 'pump',
    ipHash: 'sha256:abc',
    imgHash: 'sha256:def',
    imgBytes: 100,
    imageType: 'jpeg',
    provider: 'ollama',
    model: 'qwen2.5vl:3b',
    fellbackTo: null,
    latencyMs: 1234,
    costCents: 0,
    parsed: { mode: 'pump', volume: 11.2, volumeUnit: 'gal', cost: 42.18, pricePerUnit: 3.78 },
    ok: true,
    ...extra
  };
}

describe('OcrAudit', () => {
  let dir: string;
  let path: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ocr-audit-'));
    path = join(dir, 'ocr-audit.jsonl');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T14:02:11.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  it('appends one JSONL line per record (pump + odometer)', async () => {
    const audit = new OcrAudit({ path, maxBytes: 1_048_576 });
    await audit.append(pumpRecord());
    await audit.append(pumpRecord({
      mode: 'odometer',
      parsed: { mode: 'odometer', odometer: 87600 },
      ok: false,
      error: { code: 'TIMEOUT', message: 'upstream timed out' },
      provider: 'openrouter',
      model: 'google/gemini-2.5-flash-lite',
      fellbackTo: 'ollama',
      costCents: 0.006,
      latencyMs: 9999,
      imgHash: 'sha256:ghi'
    }));
    const lines = readFileSync(path, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const row0 = JSON.parse(lines[0]);
    const row1 = JSON.parse(lines[1]);
    expect(row0).toMatchObject({ ok: true, mode: 'pump', provider: 'ollama' });
    expect(row1).toMatchObject({ ok: false, mode: 'odometer', error: { code: 'TIMEOUT' } });
    expect(typeof row0.ts).toBe('string');
  });

  it('truncates the file when the next append would exceed maxBytes', async () => {
    const audit = new OcrAudit({ path, maxBytes: 200 });
    for (let i = 0; i < 10; i++) await audit.append(pumpRecord());
    expect(statSync(path).size).toBeLessThanOrEqual(400);
  });
});

describe('hashIp / hashImage', () => {
  it('hashIp is stable for the same (ip, key) pair', () => {
    const a = hashIp('1.2.3.4', TEST_KEY);
    const b = hashIp('1.2.3.4', TEST_KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{16}$/);
  });

  it('hashIp differs for different IPs', () => {
    expect(hashIp('1.2.3.4', TEST_KEY)).not.toBe(hashIp('5.6.7.8', TEST_KEY));
  });

  it('hashImage produces a SHA-256 prefixed digest', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
    const h = hashImage(buf);
    expect(h).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});

describe('resolveAuditHmacKey', () => {
  let dir: string;
  let keyPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ocr-key-'));
    keyPath = join(dir, 'ocr-audit-key.txt');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns the env-provided key when set', () => {
    const k = resolveAuditHmacKey({ ocrAuditHmacKey: 'explicit-key', ocrAuditKeyPath: keyPath });
    expect(k.toString('utf-8')).toBe('explicit-key');
    expect(existsSync(keyPath)).toBe(false);
  });

  it('reads an existing file when no env override', () => {
    const seed = Buffer.from('persisted-key');
    writeFileSync(keyPath, seed);
    const k = resolveAuditHmacKey({ ocrAuditHmacKey: undefined, ocrAuditKeyPath: keyPath });
    expect(k.equals(seed)).toBe(true);
  });

  it('generates and persists 32 bytes when nothing exists', () => {
    const k = resolveAuditHmacKey({ ocrAuditHmacKey: undefined, ocrAuditKeyPath: keyPath });
    expect(k.length).toBe(32);
    const onDisk = readFileSync(keyPath);
    expect(onDisk.equals(k)).toBe(true);
    // 0600 perms — owner read/write only
    const mode = statSync(keyPath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('is idempotent across calls', () => {
    const a = resolveAuditHmacKey({ ocrAuditHmacKey: undefined, ocrAuditKeyPath: keyPath });
    const b = resolveAuditHmacKey({ ocrAuditHmacKey: undefined, ocrAuditKeyPath: keyPath });
    expect(a.equals(b)).toBe(true);
  });
});
